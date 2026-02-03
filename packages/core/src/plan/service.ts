import { ModelRequest, Config, ProviderError } from '@orchestrator/shared';
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

export class PlanService {
  constructor(private eventBus: EventBus) {}

  async generatePlan(
    goal: string,
    providers: { planner: ProviderAdapter },
    ctx: AdapterContext,
    artifactsDir: string,
    repoRoot: string,
    config?: Config,
  ): Promise<string[]> {
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
      console.error('Context generation failed:', err);
      // But maybe we should write an error report?
    }

    const systemPrompt = `You are an expert software architecture planner.
Your goal is to break down a high-level user goal into a sequence of clear, actionable steps.
Return ONLY a JSON object with a "steps" property containing an array of strings.

Critical formatting rules:
- Do NOT include section headers/categories as steps.
- Do NOT prefix steps with numbering/bullets (no "1.", "1.1.", "-", etc).
- Each step must be a single, concise, actionable instruction (imperative voice).`;

    let userPrompt = `Goal: ${goal}`;

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

    const response = await providers.planner.generate(request, ctx);

    if (!response.text) {
      throw new ProviderError('Planner provider returned empty response');
    }

    const rawText = response.text;
    await fs.writeFile(path.join(artifactsDir, 'plan_raw.txt'), rawText);

    let planSteps: string[] = [];

    // Attempt 1: Parse JSON (robust to preamble/trailing text)
    const coerceSteps = (parsed: unknown): string[] => {
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).steps)) {
        return (parsed as any).steps.map(String);
      }
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
        planSteps = tryParseJson(fencedJsonMatch[1].trim());
      } catch {
        // ignore and fall through
      }
    }

    if (planSteps.length === 0) {
      // Basic cleanup for markdown code blocks if the model includes them despite jsonMode
      const cleanedText = rawTrimmed.replace(/```json\n|\n```/g, '').trim();

      // Try parsing whole string first.
      try {
        planSteps = tryParseJson(cleanedText);
      } catch {
        // ignore and fall through
      }

      // Try extracting the first JSON object or array from the text.
      if (planSteps.length === 0) {
        const firstBrace = cleanedText.indexOf('{');
        const lastBrace = cleanedText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            planSteps = tryParseJson(cleanedText.slice(firstBrace, lastBrace + 1));
          } catch {
            // ignore
          }
        }
      }
      if (planSteps.length === 0) {
        const firstBracket = cleanedText.indexOf('[');
        const lastBracket = cleanedText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          try {
            planSteps = tryParseJson(cleanedText.slice(firstBracket, lastBracket + 1));
          } catch {
            // ignore
          }
        }
      }
    }

    // Attempt 2: Parse text (bullets/numbers)
    if (planSteps.length === 0) {
      const parsedPlan = parsePlanFromText(rawText);
      if (parsedPlan && parsedPlan.steps.length > 0) {
        planSteps = parsedPlan.steps;
      }
    }

    // Attempt 3: Fallback
    if (planSteps.length === 0) {
      // We couldn't extract steps, so we leave it empty.
      // The CLI will handle warning the user.
      // Alternatively, we could treat the whole text as one step if it's short?
      // For now, empty array implies unstructured output that couldn't be parsed.
    }

    planSteps = normalizePlanSteps(planSteps);

    // Write plan.json even if empty steps, as per spec "plan.json (may contain empty steps but valid JSON)"
    await fs.writeFile(
      path.join(artifactsDir, 'plan.json'),
      JSON.stringify({ steps: planSteps }, null, 2),
    );

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
