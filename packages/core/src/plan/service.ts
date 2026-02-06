import { ModelRequest, Config, ProviderError, extractJsonObject, logger } from '@orchestrator/shared';
import { ProviderAdapter, AdapterContext, parsePlanFromText } from '@orchestrator/adapters';
import {
  RepoScanner,
  SearchService,
  SnippetExtractor,
  SimpleContextPacker,
  ContextSignal,
  Snippet,
  SearchMatch,
} from '@orchestrator/repo';
import { EventBus } from '../registry';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { filterInjectionPhrases, wrapUntrustedContent } from '../security/guards';
import {
  PLAN_JSON_SCHEMA_VERSION,
  PLAN_REVIEW_SCHEMA_VERSION,
  type PlanJson,
  type PlanNode,
  type PlanExecutionStep,
  type PlanReviewResult,
} from './types';

function stripPlanListPrefix(step: string): string {
  let result = step.trim();
  // Bullets / checkboxes
  result = result.replace(/^[-*]\s*(?:\[[xX ]\]\s*)?/, '');
  // Numbered lists, including hierarchical numbering like 1.1. or 2.3)
  result = result.replace(/^\d+(?:\.\d+)*[.)]?\s+/, '');
  return result.trim();
}

function looksActionable(step: string): boolean {
  const trimmed = step.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('set up ')) return true;
  if (lower.startsWith('wire up ')) return true;

  const firstWord = lower.split(/\s+/, 1)[0] ?? '';
  const imperativeVerbs = new Set([
    'add',
    'audit',
    'build',
    'bump',
    'check',
    'configure',
    'create',
    'disable',
    'document',
    'enable',
    'ensure',
    'extract',
    'fix',
    'harden',
    'implement',
    'improve',
    'install',
    'integrate',
    'investigate',
    'limit',
    'migrate',
    'move',
    'parse',
    'refactor',
    'remove',
    'replace',
    'review',
    'run',
    'sanitize',
    'set',
    'setup',
    'support',
    'test',
    'update',
    'validate',
    'verify',
    'wire',
  ]);
  return imperativeVerbs.has(firstWord);
}

function normalizePlanSteps(rawSteps: string[]): string[] {
  const trimmedSteps = rawSteps.map((step) => String(step).trim()).filter(Boolean);
  const hasHierarchicalNumbering = trimmedSteps.some((step) => /^\d+\.\d+/.test(step));

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const original of trimmedSteps) {
    const content = stripPlanListPrefix(original);
    if (!content) continue;

    // If the model returns section headers as separate numbered steps (e.g. "1. CODE QUALITY FIXES"),
    // drop them when it also returns hierarchical substeps (e.g. "1.1. ...").
    if (hasHierarchicalNumbering) {
      const isLevel1Numbered = /^\d+[.)]\s+/.test(original) && !/^\d+\.\d+/.test(original);
      if (isLevel1Numbered && !looksActionable(content)) {
        continue;
      }
    } else {
      // Non-hierarchical plans: only drop obvious non-actionable headers.
      const lettersOnly = content.replace(/[^A-Za-z]/g, '');
      const isAllCaps = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
      const isObviousHeader = content.endsWith(':') || isAllCaps;
      if (isObviousHeader && !looksActionable(content)) {
        continue;
      }
    }

    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(content);
  }

  return normalized;
}

export interface PlanGenerationOptions {
  /**
   * Maximum nesting depth for plan expansion. Depth 1 is the initial outline.
   * When > 1, each outline step is expanded into substeps recursively.
   */
  maxDepth?: number;
  /**
   * Maximum number of substeps generated per expanded step.
   */
  maxSubstepsPerStep?: number;
  /**
   * Maximum total number of plan nodes (outline + all expanded substeps).
   * Acts as a safety valve to prevent runaway expansion.
   */
  maxTotalSteps?: number;
  /**
   * If enabled, run a review pass over the outline steps.
   */
  reviewPlan?: boolean;
  /**
   * If enabled (and review returns revisedSteps), apply the revised outline
   * before any expansions.
   */
  applyReview?: boolean;
}

export interface PlanPromptContext {
  /**
   * Returns the current "so far" context stack, already rendered as plain text.
   * This is treated as untrusted content (it may contain user-provided strings).
   */
  getContextStackText?: () => Promise<string> | string;
}

export class PlanService {
  constructor(private eventBus: EventBus) {}

  async generatePlan(
    goal: string,
    providers: { planner: ProviderAdapter; reviewer?: ProviderAdapter },
    ctx: AdapterContext,
    artifactsDir: string,
    repoRoot: string,
    config?: Config,
    options?: PlanGenerationOptions,
    promptContext?: PlanPromptContext,
  ): Promise<string[]> {
    const adapterCtx: AdapterContext = { ...ctx, repoRoot };

    await this.eventBus.emit({
      type: 'PlanRequested',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { goal },
    });

    // 1. Build Context
    const queries = [goal];
    let contextPack;
    let candidates: Snippet[] = [];

    try {
      // 1a. Scan Repo
      const scanner = new RepoScanner();
      const scanStart = Date.now();
      const snapshot = await scanner.scan(repoRoot, {
        excludes: config?.context?.exclude,
      });
      await this.eventBus.emit({
        type: 'RepoScan',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        payload: {
          fileCount: snapshot.files.length,
          durationMs: Date.now() - scanStart,
        },
      });

      // 1b. Derive File Matches (Naive heuristic)
      const goalKeywords = goal
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const fileMatches: SearchMatch[] = [];

      for (const file of snapshot.files) {
        const fileName = path.basename(file.path).toLowerCase();
        // Check if filename contains a keyword
        for (const keyword of goalKeywords) {
          if (fileName.includes(keyword)) {
            fileMatches.push({
              path: file.path,
              line: 1,
              column: 1,
              matchText: 'FILENAME_MATCH',
              lineText: '',
              score: 100, // High priority for filename matches
            });
            break;
          }
        }
      }

      // 1c. Search Content
      const searchService = new SearchService(config?.context?.rgPath);
      const searchStart = Date.now();
      const searchResults = await searchService.search({
        query: goal,
        cwd: repoRoot,
        maxMatchesPerFile: 5,
      });

      await this.eventBus.emit({
        type: 'RepoSearch',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        payload: {
          query: goal,
          matches: searchResults.matches.length,
          durationMs: Date.now() - searchStart,
        },
      });

      const allMatches = [...fileMatches, ...searchResults.matches];

      // 1d. Extract Snippets
      const extractor = new SnippetExtractor();
      candidates = await extractor.extractSnippets(allMatches, {
        cwd: repoRoot,
      });

      // 1e. Pack Context
      const packer = new SimpleContextPacker();
      const signals: ContextSignal[] = [];
      const options = {
        tokenBudget: config?.context?.tokenBudget || 10000,
      };

      contextPack = packer.pack(goal, signals, candidates, options);

      await this.eventBus.emit({
        type: 'ContextBuilt',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        payload: {
          fileCount: contextPack.items.length,
          tokenEstimate: contextPack.estimatedTokens,
        },
      });

      // Write Context Artifacts
      const excludedCount = candidates.length - contextPack.items.length;
      const provenance = {
        goal,
        queries,
        pack: contextPack,
        stats: {
          candidatesFound: candidates.length,
          itemsSelected: contextPack.items.length,
          itemsExcluded: excludedCount,
        },
      };

      await fs.writeFile(
        path.join(artifactsDir, 'context_pack.json'),
        JSON.stringify(provenance, null, 2),
      );

      // Human readable report
      let readableReport = `Goal: ${goal}\n`;
      readableReport += `Queries: ${queries.join(', ')}\n`;
      readableReport += `Stats: ${candidates.length} candidates, ${contextPack.items.length} selected, ${excludedCount} excluded\n`;
      readableReport += `Estimated Tokens: ${contextPack.estimatedTokens}\n\n`;
      readableReport += `--- Selected Context ---\n`;

      for (const item of contextPack.items) {
        readableReport += `File: ${item.path} (${item.startLine}-${item.endLine})\n`;
        readableReport += `Reason: ${item.reason} (Score: ${item.score.toFixed(2)})\n`;
        readableReport += `---\n${item.content}\n---\n\n`;
      }

      await fs.writeFile(path.join(artifactsDir, 'context_pack.txt'), readableReport);
    } catch (err) {
      // Don't fail planning if context fails, just log it
      logger.error('Context generation failed', { error: err });
    }

    const systemPromptBase = `You are an expert software architecture planner.
Your goal is to break down a high-level user goal into a sequence of clear, actionable implementation steps.
Return ONLY a JSON object with a "steps" property containing an array of strings.

Quality bar:
- Steps must be specific enough that an engineer can implement each one without needing extra context.
- Prefer concrete targets when possible (file/module/component names, API names, selectors, config keys).
- Avoid vague steps like "handle edge cases" unless you name the edge cases and what to change.
- Avoid pronouns ("it/this/that"); each step should be self-contained.

Critical formatting rules:
- Do NOT include section headers/categories as steps.
- Do NOT prefix steps with numbering/bullets (no "1.", "1.1.", "-", etc).
- Each step must be a single, concise, actionable instruction (imperative voice).`;

    const getSafeContextStack = async (): Promise<string> => {
      const raw = await promptContext?.getContextStackText?.();
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return '';
      const filtered = filterInjectionPhrases(text);
      return filtered === text ? filtered : wrapUntrustedContent(filtered);
    };

    const contextStackText = await getSafeContextStack();
    const contextStackHint =
      contextStackText && contextStackText.includes('...[TRUNCATED]')
        ? `NOTE: The context stack excerpt above is truncated.\nYou can read more from ".orchestrator/context_stack.jsonl" (JSONL; one frame per line; newest frames are at the bottom).\nFrame keys: ts, runId?, kind, title, summary, details?, artifacts?.\nIf file access isn't available, request more frames to be included.\n`
        : '';
    const systemPrompt = systemPromptBase;

    let userPrompt = `${contextStackText ? `SO FAR (CONTEXT STACK):\n${contextStackText}\n\n${contextStackHint ? `${contextStackHint}\n` : ''}` : ''}Goal: ${goal}`;

    // Inject context if available
    if (contextPack && contextPack.items.length > 0) {
      userPrompt += `\n\nContext:\n`;
      for (const item of contextPack.items) {
        userPrompt += `File: ${item.path}\n\`\`\`\n${item.content}\n\`\`\`\n`;
      }
    }

    const request: ModelRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
    };

    const response = await providers.planner.generate(request, adapterCtx);

    if (!response.text) {
      throw new ProviderError('Planner provider returned empty response');
    }

    const rawText = response.text;
    await fs.writeFile(path.join(artifactsDir, 'plan_raw.txt'), rawText);

    let outlineSteps: string[] = [];

    // Attempt 1: Parse JSON (robust to preamble/trailing text)
    const hasStepsArray = (value: unknown): value is { steps: unknown[] } => {
      if (!value || typeof value !== 'object') return false;
      const record = value as Record<string, unknown>;
      return Array.isArray(record.steps);
    };

    const coerceSteps = (parsed: unknown): string[] => {
      if (hasStepsArray(parsed)) return parsed.steps.map(String);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
      return [];
    };

    const tryParseJson = (candidate: string): string[] => {
      const parsed = JSON.parse(candidate);
      return coerceSteps(parsed);
    };

    const rawTrimmed = rawText.trim();

    // Prefer JSON inside fenced blocks if present.
    const fencedJsonMatch = rawTrimmed.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fencedJsonMatch) {
      try {
        outlineSteps = tryParseJson(fencedJsonMatch[1].trim());
      } catch {
        // ignore and fall through
      }
    }

    if (outlineSteps.length === 0) {
      // Basic cleanup for markdown code blocks if the model includes them despite jsonMode
      const cleanedText = rawTrimmed.replace(/```json\n|\n```/g, '').trim();

      // Try parsing whole string first.
      try {
        outlineSteps = tryParseJson(cleanedText);
      } catch {
        // ignore and fall through
      }

      // Try extracting the first JSON object or array from the text.
      if (outlineSteps.length === 0) {
        const firstBrace = cleanedText.indexOf('{');
        const lastBrace = cleanedText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            outlineSteps = tryParseJson(cleanedText.slice(firstBrace, lastBrace + 1));
          } catch {
            // ignore
          }
        }
      }
      if (outlineSteps.length === 0) {
        const firstBracket = cleanedText.indexOf('[');
        const lastBracket = cleanedText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          try {
            outlineSteps = tryParseJson(cleanedText.slice(firstBracket, lastBracket + 1));
          } catch {
            // ignore
          }
        }
      }
    }

    // Attempt 2: Parse text (bullets/numbers)
    if (outlineSteps.length === 0) {
      const parsedPlan = parsePlanFromText(rawText);
      if (parsedPlan && parsedPlan.steps.length > 0) {
        outlineSteps = parsedPlan.steps;
      }
    }

    // Attempt 3: Fallback
    if (outlineSteps.length === 0) {
      // We couldn't extract steps, so we leave it empty.
      // The CLI will handle warning the user.
      // Alternatively, we could treat the whole text as one step if it's short?
      // For now, empty array implies unstructured output that couldn't be parsed.
    }

    outlineSteps = normalizePlanSteps(outlineSteps);

    const configMaxDepth = config?.planning?.maxDepth;
    const configMaxSubsteps = config?.planning?.maxSubstepsPerStep;
    const configMaxTotalSteps = config?.planning?.maxTotalSteps;
    const configReviewEnabled = config?.planning?.review?.enabled;
    const configApplyReview = config?.planning?.review?.apply;

    const maxDepthRaw = options?.maxDepth ?? configMaxDepth ?? 1;
    const maxDepth = Number.isFinite(maxDepthRaw) ? Math.floor(maxDepthRaw) : 1;

    const maxSubstepsRaw = options?.maxSubstepsPerStep ?? configMaxSubsteps ?? 6;
    const maxSubstepsPerStep = Number.isFinite(maxSubstepsRaw)
      ? Math.max(1, Math.floor(maxSubstepsRaw))
      : 6;

    const maxTotalRaw = options?.maxTotalSteps ?? configMaxTotalSteps ?? 200;
    const maxTotalSteps = Number.isFinite(maxTotalRaw) ? Math.max(1, Math.floor(maxTotalRaw)) : 200;

    const reviewEnabled = options?.reviewPlan ?? configReviewEnabled ?? false;
    const applyReview = options?.applyReview ?? configApplyReview ?? false;

    const reviewer = providers.reviewer ?? providers.planner;

    const reviewSchema = z.object({
      verdict: z.enum(['approve', 'revise']),
      summary: z.string(),
      issues: z.array(z.string()).default([]),
      suggestions: z.array(z.string()).default([]),
      revisedSteps: z.array(z.string()).optional(),
    });

    let reviewResult: PlanReviewResult | undefined;
    if (reviewEnabled && outlineSteps.length > 0) {
      const reviewSystemPromptBase = `You are an expert software planning reviewer.
Your job is to review a proposed plan against the goal for correctness, completeness, and ordering.

Return ONLY JSON matching this schema:
{
  "verdict": "approve" | "revise",
  "summary": string,
  "issues": string[],
  "suggestions": string[],
  "revisedSteps"?: string[]
}

Rules:
- Do NOT include numbering/bullets in revisedSteps.
- If the plan is missing critical steps or has poor ordering, set verdict to "revise" and include revisedSteps as a COMPLETE replacement outline.
- If the plan is good, set verdict to "approve" and omit revisedSteps.`;

      const reviewStack = await getSafeContextStack();
      const reviewStackHint =
        reviewStack && reviewStack.includes('...[TRUNCATED]')
          ? `NOTE: The context stack excerpt above is truncated.\nYou can read more from ".orchestrator/context_stack.jsonl" (JSONL; one frame per line; newest frames are at the bottom).\nFrame keys: ts, runId?, kind, title, summary, details?, artifacts?.\nIf file access isn't available, request more frames to be included.\n`
          : '';

      const reviewSystemPrompt = reviewSystemPromptBase;
      const reviewUserPrompt = `${reviewStack ? `SO FAR (CONTEXT STACK):\n${reviewStack}\n\n${reviewStackHint ? `${reviewStackHint}\n` : ''}` : ''}Goal: ${goal}\n\nProposed plan steps:\n${outlineSteps
        .map((s) => `- ${s}`)
        .join('\n')}`;

      const reviewReq: ModelRequest = {
        messages: [
          { role: 'system', content: reviewSystemPrompt },
          { role: 'user', content: reviewUserPrompt },
        ],
        jsonMode: true,
      };

      const reviewResp = await reviewer.generate(reviewReq, adapterCtx);
      const reviewRaw = (reviewResp.text ?? '').trim();
      await fs.writeFile(path.join(artifactsDir, 'plan_review_raw.txt'), reviewRaw);

      try {
        const parsed = extractJsonObject(reviewRaw, 'plan_review');
        const validated = reviewSchema.parse(parsed);
        reviewResult = {
          schemaVersion: PLAN_REVIEW_SCHEMA_VERSION,
          verdict: validated.verdict,
          summary: validated.summary,
          issues: validated.issues ?? [],
          suggestions: validated.suggestions ?? [],
          revisedSteps: validated.revisedSteps?.map(String),
        };
        await fs.writeFile(
          path.join(artifactsDir, 'plan_review.json'),
          JSON.stringify(reviewResult, null, 2),
        );

        if (applyReview && reviewResult.verdict === 'revise' && reviewResult.revisedSteps?.length) {
          outlineSteps = normalizePlanSteps(reviewResult.revisedSteps);
        }
      } catch (err) {
        // Non-fatal: review is optional.
        const msg = err instanceof Error ? err.message : String(err);
        await fs.writeFile(
          path.join(artifactsDir, 'plan_review_error.txt'),
          `Failed to parse plan review output.\n${msg}\n`,
        );
      }
    }

    const makeNode = (id: string, step: string): PlanNode => ({ id, step });

    const tree: PlanNode[] = outlineSteps.map((step, idx) => makeNode(String(idx + 1), step));

    const parseStepsFromModelText = (text: string): string[] => {
      let parsedSteps: string[] = [];
      const raw = String(text ?? '').trim();
      if (!raw) return [];

      // Prefer JSON inside fenced blocks if present.
      const fencedJsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
      const candidates: string[] = [];
      if (fencedJsonMatch) candidates.push(fencedJsonMatch[1].trim());

      const cleaned = raw.replace(/```json\n|\n```/g, '').trim();
      candidates.push(cleaned);

      const hasStepsArray = (value: unknown): value is { steps: unknown[] } => {
        if (!value || typeof value !== 'object') return false;
        const record = value as Record<string, unknown>;
        return Array.isArray(record.steps);
      };
      const coerceSteps = (value: unknown): string[] => {
        if (hasStepsArray(value)) return value.steps.map(String);
        if (Array.isArray(value)) return value.map(String);
        return [];
      };

      const tryParse = (candidate: string): string[] => {
        const parsed = JSON.parse(candidate);
        return coerceSteps(parsed);
      };

      for (const candidate of candidates) {
        if (!candidate) continue;
        try {
          parsedSteps = tryParse(candidate);
          if (parsedSteps.length > 0) break;
        } catch {
          // ignore
        }
      }

      if (parsedSteps.length === 0) {
        // Try extracting first JSON object/array from the text.
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsedSteps = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
          } catch {
            // ignore
          }
        }
      }
      if (parsedSteps.length === 0) {
        const firstBracket = cleaned.indexOf('[');
        const lastBracket = cleaned.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          try {
            parsedSteps = tryParse(cleaned.slice(firstBracket, lastBracket + 1));
          } catch {
            // ignore
          }
        }
      }

      if (parsedSteps.length === 0) {
        const parsedPlan = parsePlanFromText(raw);
        if (parsedPlan?.steps?.length) parsedSteps = parsedPlan.steps;
      }

      return normalizePlanSteps(parsedSteps).slice(0, maxSubstepsPerStep);
    };

    const expandSystemPromptBase = `You are an expert software architecture planner.
Your goal is to break down a single plan step into smaller, sequential, actionable substeps.
Return ONLY a JSON object with a "steps" property containing an array of strings.

Quality bar:
- Substeps must retain the parent intent (do not lose key nouns from the ancestor chain).
- Each substep must be self-contained (avoid pronouns like "it/this/that").
- Prefer concrete targets when possible (file/module/component names, API names, config keys).
- If you cannot name a target, write the substep so it is still actionable (e.g., "Locate X by searching for Y, then update Z").
- Do not add generic meta-steps like "understand the codebase" or "review requirements".

Critical formatting rules:
- Do NOT include section headers/categories as steps.
- Do NOT prefix steps with numbering/bullets (no "1.", "1.1.", "-", etc).
- Each step must be a single, concise, actionable instruction (imperative voice).
- Return at most ${maxSubstepsPerStep} steps.
- If the step is already atomic, return {"steps": []}.`;

    const safeIdForFilename = (id: string): string => id.replace(/[^a-zA-Z0-9_.-]/g, '_');

    let totalNodes = tree.length;
    const expandNode = async (node: PlanNode, depth: number, ancestors: string[]): Promise<void> => {
      if (depth >= maxDepth) return;
      if (totalNodes >= maxTotalSteps) return;

      const expandStack = await getSafeContextStack();
      const expandStackHint =
        expandStack && expandStack.includes('...[TRUNCATED]')
          ? `NOTE: The context stack excerpt above is truncated.\nYou can read more from ".orchestrator/context_stack.jsonl" (JSONL; one frame per line; newest frames are at the bottom).\nFrame keys: ts, runId?, kind, title, summary, details?, artifacts?.\nIf file access isn't available, request more frames to be included.\n`
          : '';
      const expandSystemPrompt = expandSystemPromptBase;

      const expandUserPrompt = `${expandStack ? `SO FAR (CONTEXT STACK):\n${expandStack}\n\n${expandStackHint ? `${expandStackHint}\n` : ''}` : ''}Overall Goal: ${goal}
Current Step: ${node.step}
Ancestor Steps: ${ancestors.length > 0 ? ancestors.join(' > ') : '(none)'}
Target Depth: ${depth + 1} of ${maxDepth}

Provide a short list of substeps to accomplish ONLY the current step.`;

      const req: ModelRequest = {
        messages: [
          { role: 'system', content: expandSystemPrompt },
          { role: 'user', content: expandUserPrompt },
        ],
        jsonMode: true,
      };

      const idSafe = safeIdForFilename(node.id);
      let substeps: string[] = [];
      try {
        const resp = await providers.planner.generate(req, adapterCtx);
        const raw = (resp.text ?? '').trim();
        await fs.writeFile(path.join(artifactsDir, `plan_expand_${idSafe}_raw.txt`), raw);

        substeps = parseStepsFromModelText(raw);
        await fs.writeFile(
          path.join(artifactsDir, `plan_expand_${idSafe}.json`),
          JSON.stringify({ steps: substeps }, null, 2),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await fs.writeFile(
          path.join(artifactsDir, `plan_expand_${idSafe}_error.txt`),
          `Failed to expand plan step ${node.id}.\n${msg}\n`,
        );
        return;
      }

      if (substeps.length === 0) return;

      const children: PlanNode[] = [];
      for (let i = 0; i < substeps.length; i++) {
        if (totalNodes >= maxTotalSteps) break;
        children.push(makeNode(`${node.id}.${i + 1}`, substeps[i]));
        totalNodes++;
      }
      if (children.length === 0) return;

      node.children = children;

      for (const child of children) {
        await expandNode(child, depth + 1, [...ancestors, node.step]);
        if (totalNodes >= maxTotalSteps) break;
      }
    };

    if (maxDepth > 1 && tree.length > 0) {
      for (const node of tree) {
        await expandNode(node, 1, []);
        if (totalNodes >= maxTotalSteps) break;
      }
    }

    const execution: PlanExecutionStep[] = [];
    const walk = (node: PlanNode, ancestors: string[]): void => {
      if (node.children && node.children.length > 0) {
        const nextAncestors = [...ancestors, node.step];
        for (const child of node.children) {
          walk(child, nextAncestors);
        }
        return;
      }
      execution.push({ id: node.id, step: node.step, ancestors });
    };
    for (const node of tree) walk(node, []);

    const planSteps = execution.map((e) => e.step);

    const planJson: PlanJson = {
      schemaVersion: PLAN_JSON_SCHEMA_VERSION,
      goal,
      generatedAt: new Date().toISOString(),
      maxDepth,
      steps: planSteps,
      outline: outlineSteps,
      tree,
      execution,
      review: reviewResult,
    };

    // Write plan.json even if empty steps, as per spec "plan.json (may contain empty steps but valid JSON)"
    await fs.writeFile(path.join(artifactsDir, 'plan.json'), JSON.stringify(planJson, null, 2));

    await this.eventBus.emit({
      type: 'PlanCreated',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { planSteps },
    });

    return planSteps;
  }
}
