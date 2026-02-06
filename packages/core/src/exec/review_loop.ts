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

function renderHistory(history: PatchReview[]): string {
  if (history.length === 0) return '';
  const lines: string[] = [];
  lines.push('REVIEW HISTORY (oldest → newest):');
  history.forEach((r, i) => {
    const parts: string[] = [`Round ${i + 1}: verdict=${r.verdict}`, `confidence=${r.confidence}`];
    if (r.summary) parts.push(`summary=${r.summary}`);
    lines.push(`- ${parts.join(' | ')}`);
    if (r.requiredChanges?.length) {
      lines.push(`  requiredChanges: ${r.requiredChanges.slice(0, 6).join('; ')}${r.requiredChanges.length > 6 ? ' …' : ''}`);
    }
    if (r.issues?.length) {
      lines.push(`  issues: ${r.issues.slice(0, 6).join('; ')}${r.issues.length > 6 ? ' …' : ''}`);
    }
    if (r.riskFlags?.length) {
      lines.push(`  riskFlags: ${r.riskFlags.slice(0, 6).join('; ')}${r.riskFlags.length > 6 ? ' …' : ''}`);
    }
  });
  return lines.join('\n');
}

async function bestEffortUpdateManifest(manifestPath: string, artifactPaths: string[]): Promise<void> {
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
  patch: string;
  historyText: string;
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
- If changes are required before applying, verdict MUST be "revise" and requiredChanges must be specific and actionable.
- If the patch exceeds the step scope, verdict MUST be "revise" and requiredChanges must specify what to remove/split.
- Prefer citing file paths from the diff when describing issues.
- Do not include any non-JSON output.`;

  const planContextLines = [
    `OVERALL GOAL: ${args.goal}`,
    `CURRENT LEAF STEP: ${args.step}`,
    ...(args.stepId ? [`STEP ID: ${args.stepId}`] : []),
    ...(args.ancestors.length ? [`ANCESTORS (outer → inner):`, ...args.ancestors.map((a) => `- ${a}`)] : []),
  ];

  const userPrompt = `${planContextLines.join('\n')}

${args.historyText ? `${args.historyText}\n\n` : ''}CONTEXT:
${args.fusedContextText}

PROPOSED PATCH (unified diff):
${args.patch}`;

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    jsonMode: true,
    temperature: 0.1,
  };
}

function buildExecutorRequest(args: {
  goal: string;
  step: string;
  stepId?: string;
  ancestors: string[];
  fusedContextText: string;
  patch: string;
  review: PatchReview;
  historyText: string;
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
`;

  const userPrompt = `${args.historyText ? `${args.historyText}\n\n` : ''}CONTEXT:
${args.fusedContextText}

CURRENT PATCH:
${args.patch}

REVIEW FEEDBACK (JSON):
${JSON.stringify(args.review, null, 2)}

Revise the patch accordingly.`;

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
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

export async function runPatchReviewLoop(input: PatchReviewLoopInput): Promise<PatchReviewLoopOutput> {
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
  const history: PatchReview[] = [];
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

    // 1) Review
    const reviewReq = buildReviewerRequest({
      goal: input.goal,
      step: input.step,
      stepId: input.stepId,
      ancestors: input.ancestors,
      fusedContextText: input.fusedContextText,
      patch,
      historyText: renderHistory(history),
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
    history.push(review);

    const reviewJsonPath = path.join(roundDir, 'review.json');
    await fs.writeFile(reviewJsonPath, JSON.stringify(review, null, 2));
    artifactPaths.push(reviewJsonPath);

    if (review.verdict === 'approve') {
      approved = true;
      break;
    }

    // 2) Revise
    const execReq = buildExecutorRequest({
      goal: input.goal,
      step: input.step,
      stepId: input.stepId,
      ancestors: input.ancestors,
      fusedContextText: input.fusedContextText,
      patch,
      review,
      historyText: renderHistory(history),
    });

    const execResp = await input.providers.executor.generate(execReq, input.adapterCtx);
    const execRaw = execResp.text ?? '';
    const execRawPath = path.join(roundDir, 'executor_raw.txt');
    await fs.writeFile(execRawPath, execRaw);
    artifactPaths.push(execRawPath);

    const revised = extractUnifiedDiff(execRaw);
    if (!revised || revised.trim().length === 0) {
      const errPath = path.join(roundDir, 'executor_diff_extract_error.txt');
      await fs.writeFile(errPath, 'Failed to extract a revised unified diff from executor output.');
      artifactPaths.push(errPath);
      break;
    }

    const dryRun = await bestEffortDryRunApply(
      input.repoRoot,
      revised,
      input.config,
      input.dryRunApplyOptions,
    );
    if (!dryRun.ok) {
      const errPath = path.join(roundDir, 'executor_diff_dry_run_error.txt');
      await fs.writeFile(errPath, dryRun.message);
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
