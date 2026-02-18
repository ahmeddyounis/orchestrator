import type { ProviderAdapter } from '@orchestrator/adapters';
import type { AdapterContext } from '@orchestrator/adapters';
import { PatchApplier } from '@orchestrator/repo';
import { Config, ModelRequest, extractJsonObject, updateManifest } from '@orchestrator/shared';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { extractUnifiedDiff } from './diff_extractor';

const reviewSchema = z.object({
  verdict: z.enum(['approve', 'revise']),
  summary: z.string(),
  issues: z.array(z.string()).default([]),
  requiredChanges: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
  suggestedTests: z.array(z.string()).default([]),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type PatchReview = z.infer<typeof reviewSchema>;

export interface PatchReviewLoopLabel {
  kind: 'step' | 'repair';
  index: number;
  slug: string;
}

export interface PatchReviewLoopInput {
  goal: string;
  step: string;
  stepId?: string;
  ancestors: string[];
  fusedContextText: string;
  initialPatch: string;
  providers: { executor: ProviderAdapter; reviewer: ProviderAdapter };
  adapterCtx: AdapterContext;
  repoRoot: string;
  artifactsRoot: string;
  manifestPath: string;
  config: Config;
  dryRunApplyOptions?: {
    maxFilesChanged?: number;
    maxLinesTouched?: number;
    allowBinary?: boolean;
  };
  label: PatchReviewLoopLabel;
}

export interface PatchReviewLoopOutput {
  patch: string;
  approved: boolean;
  roundsRun: number;
  review?: PatchReview;
}

function safeSlug(input: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return 'step';
  return trimmed.slice(0, 40).replace(/[^a-z0-9]/gi, '_');
}

function buildContextStackHint(config: Config): string {
  const rawPath = config.contextStack?.path || '.orchestrator/context_stack.jsonl';
  return `If you need more run context/history and you have filesystem access, read "${rawPath}" (JSONL; one frame per line; newest frames are at the bottom).\nFrame keys: ts, runId?, kind, title, summary, details?, artifacts?.`;
}

function buildPatchHint(patchPath: string): string {
  return `If the patch below appears truncated and you have filesystem access, read the full patch at "${patchPath}".`;
}

function buildPlanContextLines(args: {
  goal: string;
  step: string;
  stepId?: string;
  ancestors: string[];
}): string[] {
  return [
    `OVERALL GOAL: ${args.goal}`,
    `CURRENT LEAF STEP: ${args.step}`,
    ...(args.stepId ? [`STEP ID: ${args.stepId}`] : []),
    ...(args.ancestors.length
      ? [`ANCESTORS (outer → inner):`, ...args.ancestors.map((a) => `- ${a}`)]
      : []),
  ];
}

function excerptText(text: string, maxChars: number): string {
  const normalized = (text ?? '').trim();
  if (!normalized) return '';
  if (maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n...[TRUNCATED]`;
}

function contextExcerptMaxCharsForPatch(patchText: string): number {
  const len = (patchText ?? '').length;
  if (len >= 20_000) return 0;
  if (len >= 12_000) return 500;
  return 2000;
}

async function bestEffortUpdateManifest(
  manifestPath: string,
  artifactPaths: string[],
): Promise<void> {
  if (artifactPaths.length === 0) return;
  try {
    await updateManifest(manifestPath, (manifest) => {
      manifest.verificationPaths = [...(manifest.verificationPaths ?? []), ...artifactPaths];
    });
  } catch {
    // Non-fatal.
  }
}

function buildReviewerRequest(args: {
  goal: string;
  step: string;
  stepId?: string;
  ancestors: string[];
  fusedContextText: string;
  contextExcerptMaxChars: number;
  contextStackHint: string;
  patchHint: string;
  patch: string;
}): ModelRequest {
  const systemPrompt = `You are an expert software engineer acting as a rigorous code reviewer.
Your job is to review a proposed unified diff for the current LEAF plan step.

Return ONLY JSON matching this schema:
{
  "verdict": "approve" | "revise",
  "summary": string,
  "issues": string[],
  "requiredChanges": string[],
  "suggestions": string[],
  "riskFlags": string[],
  "suggestedTests": string[],
  "confidence": "low" | "medium" | "high"
}

Rules:
- This is NOT a planning task. Do NOT request reordering, combining, or splitting plan steps; do NOT defer work to “another step”.
- Forbidden examples (do NOT write these): "combine Step 1 and Step 2", "reorder so X happens first", "apply both steps together".
- If you believe the patch would break the repo unless additional work is done, translate that into concrete code changes required in THIS patch (e.g., backwards-compatible APIs, updating call sites), not plan advice.
- If changes are required before applying, verdict MUST be "revise" and requiredChanges must be specific and actionable.
- If the patch exceeds the step scope, verdict MUST be "revise" and requiredChanges must specify what to remove/split.
- Prefer citing file paths from the diff when describing issues.
- Do not include any non-JSON output.`;

  const planContextLines = buildPlanContextLines(args);

  const contextExcerpt = excerptText(args.fusedContextText, args.contextExcerptMaxChars);

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${planContextLines.join('\n')}\n\n${args.contextStackHint}\n${args.patchHint}${contextExcerpt ? `\n\nCONTEXT (excerpt):\n${contextExcerpt}` : ''}`,
      },
      { role: 'user', content: `PROPOSED PATCH (unified diff):\n${args.patch}` },
    ],
    jsonMode: true,
    temperature: 0.1,
  };
}

function containsDiffMarkers(text: string): { hasBegin: boolean; hasEnd: boolean } {
  const normalized = (text ?? '').toLowerCase();
  const hasBegin = normalized.includes('begin_diff') || normalized.includes('<begin_diff>');
  const hasEnd =
    normalized.includes('end_diff') ||
    normalized.includes('<end_diff>') ||
    normalized.includes('</end_diff>');
  return { hasBegin, hasEnd };
}

function buildExecutorRequest(args: {
  goal: string;
  step: string;
  stepId?: string;
  ancestors: string[];
  fusedContextText: string;
  contextExcerptMaxChars: number;
  contextStackHint: string;
  patchHint: string;
  patch: string;
  review: PatchReview;
  retryNote?: string;
}): ModelRequest {
  const systemPrompt = `You are an expert software engineer.
You will revise a proposed patch based on reviewer feedback.

OVERALL GOAL:
"${args.goal}"

PLAN CONTEXT:
${args.stepId ? `- Step ID: ${args.stepId}\n` : ''}${args.ancestors.length > 0 ? `- Ancestors (outer → inner):\n${args.ancestors.map((a) => `  - ${a}`).join('\n')}\n` : ''}- Current leaf step: "${args.step}"

INSTRUCTIONS:
1. Produce a single unified diff that applies cleanly to the current code.
2. Implement the reviewer's REQUIRED CHANGES.
3. Keep scope aligned to THIS LEAF STEP ONLY (do not try to complete the whole ancestor plan in one patch).
4. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
5. The diff must be valid for \`git apply\`: every file MUST have a \`diff --git\` header and \`---\`/\`+++\` headers before any \`@@\` hunks.
6. IMPORTANT: Ensure the output includes the END_DIFF marker; do not truncate the diff.
`;

  const planContextLines = buildPlanContextLines(args);
  const contextExcerpt = excerptText(args.fusedContextText, args.contextExcerptMaxChars);

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${planContextLines.join('\n')}\n\n${args.contextStackHint}\n${args.patchHint}${args.retryNote ? `\n\nPREVIOUS ATTEMPT ISSUE:\n${args.retryNote}` : ''}${contextExcerpt ? `\n\nCONTEXT (excerpt):\n${contextExcerpt}` : ''}\n\nREVIEW FEEDBACK (JSON):\n${JSON.stringify(args.review, null, 2)}`,
      },
      { role: 'user', content: `CURRENT PATCH:\n${args.patch}\n\nRevise the patch accordingly.` },
    ],
    maxTokens: 4096,
  };
}

async function bestEffortDryRunApply(
  repoRoot: string,
  patchText: string,
  config: Config,
  dryRunApplyOptions?: {
    maxFilesChanged?: number;
    maxLinesTouched?: number;
    allowBinary?: boolean;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const applier = new PatchApplier();
  const patchTextWithNewline = patchText.endsWith('\n') ? patchText : patchText + '\n';
  const result = await applier.applyUnifiedDiff(repoRoot, patchTextWithNewline, {
    dryRun: true,
    maxFilesChanged: dryRunApplyOptions?.maxFilesChanged ?? config.patch?.maxFilesChanged,
    maxLinesTouched: dryRunApplyOptions?.maxLinesTouched ?? config.patch?.maxLinesChanged,
    allowBinary: dryRunApplyOptions?.allowBinary ?? config.patch?.allowBinary,
  });
  if (result.applied) return { ok: true };
  return { ok: false, message: result.error?.message || 'Patch failed dry-run apply' };
}

export async function runPatchReviewLoop(
  input: PatchReviewLoopInput,
): Promise<PatchReviewLoopOutput> {
  const reviewLoopCfg = input.config.execution?.reviewLoop;
  const enabled = reviewLoopCfg?.enabled ?? false;
  if (!enabled) {
    return { patch: input.initialPatch, approved: false, roundsRun: 0 };
  }

  const maxReviews = reviewLoopCfg?.maxReviews ?? 2;
  if (!Number.isFinite(maxReviews) || maxReviews < 1) {
    return { patch: input.initialPatch, approved: false, roundsRun: 0 };
  }

  const loopRoot = path.join(
    input.artifactsRoot,
    'review_loop',
    `${input.label.kind}_${input.label.index}_${safeSlug(input.label.slug)}`,
  );
  await fs.mkdir(loopRoot, { recursive: true });

  let patch = input.initialPatch;
  const artifactPaths: string[] = [];

  let approved = false;
  let lastReview: PatchReview | undefined;
  let roundsRun = 0;

  for (let round = 1; round <= maxReviews; round++) {
    roundsRun = round;
    const roundDir = path.join(loopRoot, `round_${round}`);
    await fs.mkdir(roundDir, { recursive: true });

    const inputPatchPath = path.join(roundDir, 'input.patch');
    await fs.writeFile(inputPatchPath, patch);
    artifactPaths.push(inputPatchPath);

    const contextStackHint = buildContextStackHint(input.config);
    const patchHint = buildPatchHint(inputPatchPath);

    // 1) Review
    const reviewReq = buildReviewerRequest({
      goal: input.goal,
      step: input.step,
      stepId: input.stepId,
      ancestors: input.ancestors,
      fusedContextText: input.fusedContextText,
      contextExcerptMaxChars: contextExcerptMaxCharsForPatch(patch),
      contextStackHint,
      patchHint,
      patch,
    });

    const reviewResp = await input.providers.reviewer.generate(reviewReq, input.adapterCtx);
    const reviewRaw = (reviewResp.text ?? '').trim();
    const reviewRawPath = path.join(roundDir, 'review_raw.txt');
    await fs.writeFile(reviewRawPath, reviewRaw);
    artifactPaths.push(reviewRawPath);

    let review: PatchReview;
    try {
      const parsed = extractJsonObject(reviewRaw, 'patch_review');
      review = reviewSchema.parse(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errPath = path.join(roundDir, 'review_parse_error.txt');
      await fs.writeFile(errPath, msg);
      artifactPaths.push(errPath);
      break; // Best-effort: fall back to the last patch.
    }

    lastReview = review;

    const reviewJsonPath = path.join(roundDir, 'review.json');
    await fs.writeFile(reviewJsonPath, JSON.stringify(review, null, 2));
    artifactPaths.push(reviewJsonPath);

    if (review.verdict === 'approve') {
      approved = true;
      break;
    }

    // 2) Revise
    const maxExecutorAttempts = 2;
    let revised: string | null = null;
    let lastExecError = '';

    for (let attempt = 1; attempt <= maxExecutorAttempts; attempt++) {
      const execReq = buildExecutorRequest({
        goal: input.goal,
        step: input.step,
        stepId: input.stepId,
        ancestors: input.ancestors,
        fusedContextText: input.fusedContextText,
        contextExcerptMaxChars: attempt === 1 ? contextExcerptMaxCharsForPatch(patch) : 0,
        contextStackHint,
        patchHint,
        patch,
        review,
        ...(attempt > 1 && lastExecError ? { retryNote: lastExecError } : {}),
      });

      const execResp = await input.providers.executor.generate(execReq, input.adapterCtx);
      const execRaw = execResp.text ?? '';
      const execRawPath = path.join(roundDir, `executor_attempt_${attempt}_raw.txt`);
      await fs.writeFile(execRawPath, execRaw);
      artifactPaths.push(execRawPath);

      const markers = containsDiffMarkers(execRaw);
      if (!markers.hasBegin || !markers.hasEnd) {
        lastExecError =
          'Executor output must include BEGIN_DIFF and END_DIFF markers (output may have been truncated).';
        continue;
      }

      const extracted = extractUnifiedDiff(execRaw);
      if (!extracted || extracted.trim().length === 0) {
        lastExecError = 'Failed to extract a revised unified diff from executor output.';
        continue;
      }

      const dryRun = await bestEffortDryRunApply(
        input.repoRoot,
        extracted,
        input.config,
        input.dryRunApplyOptions,
      );
      if (!dryRun.ok) {
        lastExecError = dryRun.message;
        continue;
      }

      revised = extracted;
      break;
    }

    if (!revised) {
      const errPath = path.join(roundDir, 'executor_diff_extract_error.txt');
      await fs.writeFile(
        errPath,
        lastExecError || 'Failed to extract a revised unified diff from executor output.',
      );
      artifactPaths.push(errPath);
      break;
    }

    const revisedPath = path.join(roundDir, 'revised.patch');
    await fs.writeFile(revisedPath, revised);
    artifactPaths.push(revisedPath);

    patch = revised;
  }

  await bestEffortUpdateManifest(input.manifestPath, artifactPaths);

  return {
    patch,
    approved,
    roundsRun,
    ...(lastReview ? { review: lastReview } : {}),
  };
}
