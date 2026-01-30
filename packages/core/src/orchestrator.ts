import {
  Config,
  OrchestratorEvent,
  createRunDir,
  writeManifest,
  JsonlLogger,
  ToolPolicy,
} from '@orchestrator/shared';
import {
  GitService,
  RepoScanner,
  SearchService,
  PatchApplier,
  SimpleContextPacker,
  SnippetExtractor,
} from '@orchestrator/repo';
import { ProviderRegistry, EventBus } from './registry';
import { PatchStore } from './exec/patch_store';
import { PlanService } from './plan/service';
import { ExecutionService } from './exec/service';
import { UserInterface } from '@orchestrator/exec';
import { VerificationRunner } from './verify/runner';
import { VerificationProfile } from './verify/types';
import { MemoryWriter } from './memory';
import type { RepoState, RunSummary } from './memory/types';
import type { VerificationReport } from './verify/types';
import path from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import { createHash } from 'crypto';
import { CostTracker } from './cost/tracker';
import { DEFAULT_BUDGET } from './config/budget';
import { ConfigLoader } from './config/loader';

export interface OrchestratorOptions {
  config: Config;
  git: GitService;
  registry: ProviderRegistry;
  repoRoot: string;
  costTracker?: CostTracker;
  toolPolicy?: ToolPolicy;
  ui?: UserInterface;
}

export interface RunResult {
  status: 'success' | 'failure';
  runId: string;
  summary?: string;
  filesChanged?: string[];
  patchPaths?: string[];
  stopReason?:
    | 'success'
    | 'budget_exceeded'
    | 'repeated_failure'
    | 'invalid_output'
    | 'error'
    | 'non_improving';
  recommendations?: string;
  memory?: Config['memory'];
  verification?: {
    enabled: boolean;
    passed: boolean;
    summary?: string;
    failedChecks?: string[];
    reportPaths?: string[];
  };
  lastFailureSignature?: string;
}

export interface RunOptions {
  thinkLevel: 'L0' | 'L1' | 'L2';
  runId?: string;
}

export class Orchestrator {
  private config: Config;
  private git: GitService;
  private registry: ProviderRegistry;
  private repoRoot: string;
  private costTracker?: CostTracker;
  private toolPolicy?: ToolPolicy;
  private ui?: UserInterface;
  private suppressEpisodicMemoryWrite = false;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.git = options.git;
    this.registry = options.registry;
    this.repoRoot = options.repoRoot;
    this.costTracker = options.costTracker;
    this.toolPolicy = options.toolPolicy;
    this.ui = options.ui;
  }

  async run(goal: string, options: RunOptions): Promise<RunResult> {
    const runId = options.runId || Date.now().toString();
    if (options.thinkLevel === 'L0') {
      return this.runL0(goal, runId);
    } else if (options.thinkLevel === 'L2') {
      return this.runL2(goal, runId);
    } else {
      return this.runL1(goal, runId);
    }
  }

  private shouldWriteEpisodicMemory(): boolean {
    const mem = this.config.memory;
    return !!(
      mem?.enabled &&
      mem?.writePolicy?.enabled &&
      mem?.writePolicy?.storeEpisodes
    );
  }

  private resolveMemoryDbPath(): string | undefined {
    const p = this.config.memory?.storage?.path;
    if (!p) return undefined;
    return path.isAbsolute(p) ? p : path.join(this.repoRoot, p);
  }

  private toArtifactRelPath(p: string): string {
    if (!path.isAbsolute(p)) return p;
    const prefix = this.repoRoot.endsWith(path.sep) ? this.repoRoot : this.repoRoot + path.sep;
    if (!p.startsWith(prefix)) return p;
    return path.relative(this.repoRoot, p);
  }

  private collectArtifactPaths(
    runId: string,
    artifactsRoot: string,
    patchPaths: string[] = [],
    extraPaths: string[] = [],
  ): string[] {
    const absPaths: string[] = [];
    const add = (p?: string) => {
      if (!p) return;
      absPaths.push(p);
    };

    add(path.join(artifactsRoot, 'trace.jsonl'));
    add(path.join(artifactsRoot, 'summary.json'));
    add(path.join(artifactsRoot, 'manifest.json'));
    add(path.join(artifactsRoot, 'effective-config.json'));

    for (const p of patchPaths) add(p);
    for (const p of extraPaths) add(p);

    // Include any key run outputs and reports, plus patch/log artifacts.
    const root = artifactsRoot;
    const patchesDir = path.join(root, 'patches');
    const toolLogsDir = path.join(root, 'tool_logs');

    const addDirFiles = (dir: string, filter?: (name: string) => boolean) => {
      if (!fsSync.existsSync(dir)) return;
      for (const name of fsSync.readdirSync(dir)) {
        if (filter && !filter(name)) continue;
        const full = path.join(dir, name);
        try {
          if (fsSync.statSync(full).isFile()) add(full);
        } catch {
          /* ignore */
        }
      }
    };

    addDirFiles(patchesDir, (n) => n.endsWith('.patch'));
    addDirFiles(toolLogsDir);

    addDirFiles(root, (n) =>
      n === 'executor_output.txt' ||
      /^step_.*_output\.txt$/.test(n) ||
      /^repair_iter_\d+_output\.txt$/.test(n) ||
      /^verification_report_.*\.json$/.test(n) ||
      /^verification_summary_.*\.txt$/.test(n) ||
      /^failure_summary_iter_\d+\.(json|txt)$/.test(n) ||
      /^context_pack_.*\.(json|txt)$/.test(n),
    );

    // De-dupe + relativize.
    return [...new Set(absPaths.map((p) => this.toArtifactRelPath(p)))];
  }

  private async writeEpisodicMemory(
    args: {
      runId: string;
      goal: string;
      status: 'success' | 'failure';
      stopReason: string;
      artifactsRoot: string;
      patchPaths?: string[];
      extraArtifactPaths?: string[];
      verificationReport?: VerificationReport;
    },
    eventBus?: EventBus,
  ): Promise<void> {
    if (this.suppressEpisodicMemoryWrite || !this.shouldWriteEpisodicMemory()) return;

    let gitSha = '';
    try {
      gitSha = await this.git.getHeadSha();
    } catch {
      gitSha = 'unknown';
    }

    const repoState: RepoState = {
      gitSha,
      repoId: this.repoRoot,
      memoryDbPath: this.resolveMemoryDbPath(),
      artifactPaths: this.collectArtifactPaths(
        args.runId,
        args.artifactsRoot,
        args.patchPaths ?? [],
        args.extraArtifactPaths ?? [],
      ),
    };

    const runSummary: RunSummary = {
      runId: args.runId,
      goal: args.goal,
      status: args.status,
      stopReason: args.stopReason,
    };

    try {
      const writer = new MemoryWriter(eventBus, args.runId);
      await writer.extractEpisodic(runSummary, repoState, args.verificationReport);
    } catch {
      // Non-fatal: don't fail the run if memory persistence fails.
    }
  }

  async runL0(goal: string, runId: string): Promise<RunResult> {
    // 1. Setup Artifacts
    const artifacts = await createRunDir(this.repoRoot, runId);
    ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
    const logger = new JsonlLogger(artifacts.trace);

    const emitEvent = async (e: OrchestratorEvent) => {
      await logger.log(e);
    };

    await emitEvent({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { taskId: runId, goal },
    });

    // Initialize manifest
    await writeManifest(artifacts.manifest, {
      runId,
      startedAt: new Date().toISOString(),
      command: `run ${goal}`,
      repoRoot: this.repoRoot,
      artifactsDir: artifacts.root,
      tracePath: artifacts.trace,
      summaryPath: artifacts.summary,
      effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
      patchPaths: [],
      toolLogPaths: [],
    });

    // 2. Build Minimal Context
    const scanner = new RepoScanner();
    const searchService = new SearchService();

    // Wire up search events to logger
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchService.on('RepoSearchStarted', (_e) => {
      /* log if needed */
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchService.on('RepoSearchFinished', (_e) => {
      /* log if needed */
    });

    // Scan repo structure
    const snapshot = await scanner.scan(this.repoRoot);
    const fileList = snapshot.files.map((f) => f.path).join('\n');

    // Search for keywords (simple tokenization of goal)
    const keywords = goal
      .split(' ')
      .filter((w) => w.length > 3)
      .slice(0, 5);
    let searchResults = '';

    if (keywords.length > 0) {
      const terms = keywords.slice(0, 3);
      if (terms.length > 0) {
        const regex = `(${terms.join('|')})`;
        try {
          const results = await searchService.search({
            query: regex,
            cwd: this.repoRoot,
            maxMatchesPerFile: 3,
          });

          searchResults = results.matches
            .map((m) => `${m.path}:${m.line} ${m.matchText.trim()}`)
            .join('\n');
        } catch {
          searchResults = '(Search failed)';
        }
      }
    }

    const context = `
REPOSITORY STRUCTURE:
${fileList}

SEARCH RESULTS (for keywords: ${keywords.join(', ')}):
${searchResults || '(No matches)'}
`;

    // 3. Prompt Executor
    const executor = this.registry.getAdapter(this.config.defaults?.executor || 'openai');

    if (!executor) {
      throw new Error('No executor provider configured');
    }

    const systemPrompt = `
You are an expert software engineer.
Your task is to implement the following goal: "${goal}"

CONTEXT:
${context}

INSTRUCTIONS:
1. Analyze the context and the goal.
2. Produce a unified diff that implements the changes.
3. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
4. Do not include any explanations outside the markers.

Example Output:
BEGIN_DIFF
diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-old
+new
END_DIFF
`;

    const response = await executor.generate(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Implement the goal.' },
        ],
      },
      { runId, logger },
    );

    const outputText = response.text;

    if (outputText) {
      await fs.writeFile(path.join(artifacts.root, 'executor_output.txt'), outputText);
    }

    // 4. Parse Diff
    const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);

    if (!diffMatch || !diffMatch[1].trim()) {
      const msg = 'Failed to extract diff from executor output';
      await emitEvent({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status: 'failure', summary: msg },
      });

      const result: RunResult = {
        status: 'failure',
        runId,
        summary: msg,
        memory: this.config.memory,
        verification: {
          enabled: false,
          passed: false,
          summary: 'Not run',
        },
      };

      await fs.writeFile(artifacts.summary, JSON.stringify(result, null, 2));

      // Write manifest before returning
      await writeManifest(artifacts.manifest, {
        runId,
        startedAt: new Date().toISOString(),
        command: `run ${goal}`,
        repoRoot: this.repoRoot,
        artifactsDir: artifacts.root,
        tracePath: artifacts.trace,
        summaryPath: artifacts.summary,
        effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
        patchPaths: [],
        toolLogPaths: [],
      });

      await this.writeEpisodicMemory(
        {
          runId,
          goal,
          status: 'failure',
          stopReason: 'invalid_output',
          artifactsRoot: artifacts.root,
        },
        { emit: emitEvent },
      );

      return { status: 'failure', runId, summary: msg };
    }

    const rawDiffContent = diffMatch[1];
    // Remove completely empty leading/trailing lines (no characters at all)
    // but preserve lines with spaces (which are valid diff context for blank lines)
    const lines = rawDiffContent.split('\n');
    const firstContentIdx = lines.findIndex((l) => l !== '');
    let lastContentIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] !== '') {
        lastContentIdx = i;
        break;
      }
    }
    const diffContent = firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');

    // 5. Apply Patch
    const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
    const patchPath = await patchStore.saveSelected(0, diffContent);
    await patchStore.saveFinalDiff(diffContent);

    await emitEvent({
      type: 'PatchProposed',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: {
        diffPreview: diffContent,
        filePaths: [],
      },
    });

    const applier = new PatchApplier();
    const patchTextWithNewline = diffContent.endsWith('\n') ? diffContent : diffContent + '\n';
    const result = await applier.applyUnifiedDiff(this.repoRoot, patchTextWithNewline, {
      maxFilesChanged: this.config.patch?.maxFilesChanged,
      maxLinesTouched: this.config.patch?.maxLinesChanged,
      allowBinary: this.config.patch?.allowBinary,
    });

    let runResult: RunResult;

    if (result.applied) {
      await emitEvent({
        type: 'PatchApplied',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          description: 'L0 Auto-applied patch',
          filesChanged: result.filesChanged,
          success: true,
        },
      });

      await emitEvent({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          status: 'success',
          summary: 'Patch applied successfully',
        },
      });

      runResult = {
        status: 'success',
        runId,
        summary: 'Patch applied successfully',
        filesChanged: result.filesChanged,
        patchPaths: [patchPath],
        memory: this.config.memory,
        verification: {
          enabled: false,
          passed: false,
          summary: 'Not run',
        },
      };
    } else {
      const msg = result.error?.message || 'Unknown error';
      await emitEvent({
        type: 'PatchApplyFailed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          error: msg,
          details: result.error?.details,
        },
      });

      await emitEvent({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status: 'failure', summary: 'Patch application failed' },
      });

      runResult = {
        status: 'failure',
        runId,
        summary: `Patch application failed: ${msg}`,
        patchPaths: [patchPath],
        memory: this.config.memory,
        verification: {
          enabled: false,
          passed: false,
          summary: 'Not run',
        },
      };
    }

    await fs.writeFile(artifacts.summary, JSON.stringify(runResult, null, 2));

    // Write manifest
    await writeManifest(artifacts.manifest, {
      runId,
      startedAt: new Date().toISOString(),
      command: `run ${goal}`,
      repoRoot: this.repoRoot,
      artifactsDir: artifacts.root,
      tracePath: artifacts.trace,
      summaryPath: artifacts.summary,
      effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
      patchPaths: [patchPath],
      toolLogPaths: [],
    });

    await this.writeEpisodicMemory(
      {
        runId,
        goal,
        status: runResult.status,
        stopReason: runResult.status === 'success' ? 'success' : 'error',
        artifactsRoot: artifacts.root,
        patchPaths: runResult.patchPaths,
      },
      { emit: emitEvent },
    );

    return runResult;
  }

  async runL1(goal: string, runId: string): Promise<RunResult> {
    const artifacts = await createRunDir(this.repoRoot, runId);
    ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
    const logger = new JsonlLogger(artifacts.trace);

    const eventBus: EventBus = {
      emit: async (e) => await logger.log(e),
    };

    await eventBus.emit({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { taskId: runId, goal },
    });

    // Initialize manifest
    await writeManifest(artifacts.manifest, {
      runId,
      startedAt: new Date().toISOString(),
      command: `run ${goal}`,
      repoRoot: this.repoRoot,
      artifactsDir: artifacts.root,
      tracePath: artifacts.trace,
      summaryPath: artifacts.summary,
      effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
      patchPaths: [],
      contextPaths: [],
      toolLogPaths: [],
    });

    const plannerId = this.config.defaults?.planner || 'openai';
    const executorId = this.config.defaults?.executor || 'openai';
    const reviewerId = this.config.defaults?.reviewer || 'openai';

    const providers = await this.registry.resolveRoleProviders(
      { plannerId, executorId, reviewerId },
      { eventBus, runId },
    );

    const planService = new PlanService(eventBus);

    const context = {
      runId,
      config: this.config,
      logger,
    };

    const steps = await planService.generatePlan(
      goal,
      { planner: providers.planner },
      context,
      artifacts.root,
      this.repoRoot,
      this.config,
    );

    if (steps.length === 0) {
      const msg = 'Planning failed to produce any steps.';
      await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status: 'failure', summary: msg },
      });

      const result: RunResult = {
        status: 'failure',
        runId,
        summary: msg,
        memory: this.config.memory,
        verification: {
          enabled: false,
          passed: false,
          summary: 'Not run',
        },
      };
      await fs.writeFile(artifacts.summary, JSON.stringify(result, null, 2));

      await this.writeEpisodicMemory(
        {
          runId,
          goal,
          status: 'failure',
          stopReason: 'error',
          artifactsRoot: artifacts.root,
        },
        eventBus,
      );

      return result;
    }

    const executionService = new ExecutionService(
      eventBus,
      this.git,
      new PatchApplier(),
      runId,
      this.repoRoot,
      this.config,
    );

    // Budget & Loop State
    const startTime = Date.now();
    const budget = { ...DEFAULT_BUDGET, ...this.config.budget };

    let stepsCompleted = 0;
    const patchPaths: string[] = [];
    const contextPaths: string[] = [];
    const touchedFiles = new Set<string>();

    let consecutiveInvalidDiffs = 0;
    let consecutiveApplyFailures = 0;
    let lastApplyErrorHash = '';

    const finish = async (
      status: 'success' | 'failure',
      stopReason: RunResult['stopReason'] | undefined,
      summary: string,
    ): Promise<RunResult> => {
      if (stopReason) {
        await eventBus.emit({
          type: 'RunStopped',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { reason: stopReason, details: summary },
        });
      }

      await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status, summary },
      });

      await writeManifest(artifacts.manifest, {
        runId,
        startedAt: new Date().toISOString(),
        command: `run ${goal}`,
        repoRoot: this.repoRoot,
        artifactsDir: artifacts.root,
        tracePath: artifacts.trace,
        summaryPath: artifacts.summary,
        effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
        patchPaths,
        contextPaths,
        toolLogPaths: [],
      });

      const result: RunResult = {
        status,
        runId,
        summary,
        filesChanged: Array.from(touchedFiles),
        patchPaths,
        stopReason,
        memory: this.config.memory,
        verification: {
          enabled: false,
          passed: false,
          summary: 'Not run',
        },
      };

      await fs.writeFile(artifacts.summary, JSON.stringify(result, null, 2));

      await writeManifest(artifacts.manifest, {
        runId,
        startedAt: new Date().toISOString(),
        command: `run ${goal}`,
        repoRoot: this.repoRoot,
        artifactsDir: artifacts.root,
        tracePath: artifacts.trace,
        summaryPath: artifacts.summary,
        effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
        patchPaths,
        contextPaths,
        toolLogPaths: [],
      });

      await this.writeEpisodicMemory(
        {
          runId,
          goal,
          status,
          stopReason: stopReason ?? 'success',
          artifactsRoot: artifacts.root,
          patchPaths,
          extraArtifactPaths: contextPaths,
        },
        eventBus,
      );

      return result;
    };

    for (const step of steps) {
      // 1. Budget Checks
      const elapsed = Date.now() - startTime;
      if (budget.time !== undefined && elapsed > budget.time) {
        return finish('failure', 'budget_exceeded', `Time budget exceeded (${budget.time}ms)`);
      }
      if (budget.iter !== undefined && stepsCompleted >= budget.iter) {
        return finish('failure', 'budget_exceeded', `Iteration budget exceeded (${budget.iter})`);
      }
      if (budget.cost !== undefined && this.costTracker) {
        const summary = this.costTracker.getSummary();
        if (summary.total.estimatedCostUsd && summary.total.estimatedCostUsd > budget.cost) {
          return finish('failure', 'budget_exceeded', `Cost budget exceeded ($${budget.cost})`);
        }
      }

      await eventBus.emit({
        type: 'StepStarted',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { step, index: stepsCompleted, total: steps.length },
      });

      let contextPack;
      try {
        const scanner = new RepoScanner();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const snapshot = await scanner.scan(this.repoRoot, {
          excludes: this.config.context?.exclude,
        });

        const searchService = new SearchService(this.config.context?.rgPath);
        const searchResults = await searchService.search({
          query: step,
          cwd: this.repoRoot,
          maxMatchesPerFile: 5,
        });

        const extraMatches = [];
        for (const touched of touchedFiles) {
          extraMatches.push({
            path: touched,
            line: 1,
            column: 1,
            matchText: 'PREVIOUSLY_TOUCHED',
            lineText: '',
            score: 1000,
          });
        }

        const extractor = new SnippetExtractor();
        const candidates = await extractor.extractSnippets(
          [...searchResults.matches, ...extraMatches],
          { cwd: this.repoRoot },
        );

        const packer = new SimpleContextPacker();
        contextPack = packer.pack(step, [], candidates, {
          tokenBudget: this.config.context?.tokenBudget || 8000,
        });
      } catch {
        // Ignore context errors
      }

      let contextText = `Goal: ${goal}\nCurrent Step: ${step}\n`;
      if (contextPack) {
        const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
        const packFilename = `context_pack_step_${stepsCompleted}_${stepSlug}.json`;
        const packPath = path.join(artifacts.root, packFilename);
        await fs.writeFile(packPath, JSON.stringify(contextPack, null, 2));
        contextPaths.push(packPath);

        let formattedContext = `\nCONTEXT:\n`;

        formattedContext += `Context Rationale:\n`;
        for (const item of contextPack.items) {
          formattedContext += `- ${item.path}:${item.startLine}-${item.endLine} (Score: ${item.score.toFixed(2)}): ${item.reason}\n`;
        }
        formattedContext += `\n`;

        for (const item of contextPack.items) {
          formattedContext += `File: ${item.path} (Lines ${item.startLine}-${item.endLine})\n\
${item.content}\
\
`;
        }

        const txtFilename = `context_pack_step_${stepsCompleted}_${stepSlug}.txt`;
        const txtPath = path.join(artifacts.root, txtFilename);
        await fs.writeFile(txtPath, formattedContext);

        contextText += formattedContext;
      }

      let attempt = 0;
      let success = false;
      let lastError = '';

      while (attempt < 2 && !success) {
        attempt++;

        let systemPrompt = `You are an expert software engineer.
Your task is to implement the current step: "${step}"
Part of the overall goal: "${goal}"

CONTEXT:
${contextText}

INSTRUCTIONS:
1. Analyze the context and the step.
2. Produce a unified diff that implements the changes for THIS STEP ONLY.
3. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
4. Do not include any explanations outside the markers.
`;

        if (attempt > 1) {
          systemPrompt += `\n\nPREVIOUS ATTEMPT FAILED. Error: ${lastError}\nPlease fix the error and try again.`;
        }

        const response = await providers.executor.generate(
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: 'Implement the step.' },
            ],
          },
          { runId, logger },
        );

        const outputText = response.text;

        if (outputText) {
          const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
          await fs.writeFile(
            path.join(
              artifacts.root,
              `step_${stepsCompleted}_${stepSlug}_attempt_${attempt}_output.txt`,
            ),
            outputText,
          );
        }

        const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);

        if (!diffMatch || !diffMatch[1].trim()) {
          lastError = 'Failed to extract diff from executor output';
          consecutiveInvalidDiffs++;
          if (consecutiveInvalidDiffs >= 2) {
            return finish(
              'failure',
              'invalid_output',
              'Executor produced invalid output twice consecutively',
            );
          }
          continue;
        } else {
          consecutiveInvalidDiffs = 0;
        }

        const rawDiffContent = diffMatch[1];
        // Remove completely empty leading/trailing lines (no characters at all)
        // but preserve lines with spaces (which are valid diff context for blank lines)
        const lines = rawDiffContent.split('\n');
        const firstContentIdx = lines.findIndex((l) => l !== '');
        let lastContentIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i] !== '') {
            lastContentIdx = i;
            break;
          }
        }
        const diffContent = firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');


        if (diffContent.length === 0) {
          return finish('failure', 'invalid_output', 'Executor produced empty patch');
        }

        const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
        const patchPath = await patchStore.saveSelected(stepsCompleted, diffContent);
        if (attempt === 1) patchPaths.push(patchPath);

        const result = await executionService.applyPatch(diffContent, step);

        if (result.success) {
          success = true;
          if (result.filesChanged) {
            result.filesChanged.forEach((f) => touchedFiles.add(f));
          }
          consecutiveApplyFailures = 0;
          lastApplyErrorHash = '';
        } else {
          lastError = result.error || 'Unknown apply error';
          const errorHash = createHash('sha256').update(lastError).digest('hex');
          if (lastApplyErrorHash === errorHash) {
            consecutiveApplyFailures++;
          } else {
            consecutiveApplyFailures = 1;
            lastApplyErrorHash = errorHash;
          }

          if (consecutiveApplyFailures >= 2) {
            return finish(
              'failure',
              'repeated_failure',
              `Repeated patch apply failure: ${lastError}`,
            );
          }
        }
      }

      if (success) {
        stepsCompleted++;
        await eventBus.emit({
          type: 'StepFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { step, success: true },
        });
      } else {
        await eventBus.emit({
          type: 'StepFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { step, success: false, error: lastError },
        });

        return finish(
          'failure',
          'repeated_failure',
          `Step failed after retries: ${step}. Error: ${lastError}`,
        );
      }
    }

    return finish('success', undefined, `L1 Plan Executed Successfully. ${stepsCompleted} steps.`);
  }

  async runL2(goal: string, runId: string): Promise<RunResult> {
    // 1. Initial Plan & Execute (L1)
    this.suppressEpisodicMemoryWrite = true;
    let l1Result: RunResult;
    try {
      l1Result = await this.runL1(goal, runId);
    } finally {
      this.suppressEpisodicMemoryWrite = false;
    }

    if (l1Result.stopReason === 'budget_exceeded') {
      const artifacts = await createRunDir(this.repoRoot, runId);
      const logger = new JsonlLogger(artifacts.trace);
      const eventBus: EventBus = {
        emit: async (e) => await logger.log(e),
      };
      await this.writeEpisodicMemory(
        {
          runId,
          goal,
          status: l1Result.status,
          stopReason: l1Result.stopReason ?? 'budget_exceeded',
          artifactsRoot: artifacts.root,
          patchPaths: l1Result.patchPaths,
        },
        eventBus,
      );
      return l1Result;
    }

    // 2. Setup Verification
    if (!this.ui || !this.toolPolicy) {
      const artifacts = await createRunDir(this.repoRoot, runId);
      const logger = new JsonlLogger(artifacts.trace);
      const eventBus: EventBus = {
        emit: async (e) => await logger.log(e),
      };
      await this.writeEpisodicMemory(
        {
          runId,
          goal,
          status: l1Result.status,
          stopReason: l1Result.stopReason ?? 'success',
          artifactsRoot: artifacts.root,
          patchPaths: l1Result.patchPaths,
        },
        eventBus,
      );
      return {
        ...l1Result,
        summary: l1Result.summary + ' (L2 skipped: missing UI/Policy)',
      };
    }

    // Re-use run dir structure
    const artifacts = await createRunDir(this.repoRoot, runId);
    const logger = new JsonlLogger(artifacts.trace);
    const eventBus: EventBus = {
      emit: async (e) => await logger.log(e),
    };

    const verificationRunner = new VerificationRunner(
      this.toolPolicy,
      this.ui,
      eventBus,
      this.repoRoot,
    );

    // Construct Profile
    const profile: VerificationProfile = {
      enabled: this.config.verification?.enabled ?? true,
      mode: this.config.verification?.mode || 'auto',
      steps: [],
      auto: {
        enableLint: this.config.verification?.auto?.enableLint ?? true,
        enableTypecheck: this.config.verification?.auto?.enableTypecheck ?? true,
        enableTests: this.config.verification?.auto?.enableTests ?? true,
        testScope: this.config.verification?.auto?.testScope || 'targeted',
        maxCommandsPerIteration: this.config.verification?.auto?.maxCommandsPerIteration ?? 5,
      },
    };

    // 3. Initial Verification
    let verification = await verificationRunner.run(
      profile,
      profile.mode,
      { touchedFiles: l1Result.filesChanged },
      { runId },
    );

    const initialReportPath = path.join(artifacts.root, 'verification_report_initial.json');
    await fs.writeFile(initialReportPath, JSON.stringify(verification, null, 2));
    const reportPaths = [initialReportPath];

    if (verification.passed) {
      await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status: 'success', summary: 'L2 Verified Success' },
      });
      
      const result: RunResult = {
        ...l1Result,
        status: 'success',
        summary: 'L2 Verified Success',
        memory: this.config.memory,
        verification: {
          enabled: profile.enabled,
          passed: true,
          summary: verification.summary,
          reportPaths,
        },
      };

      await fs.writeFile(artifacts.summary, JSON.stringify(result, null, 2));

      await this.writeEpisodicMemory(
        {
          runId,
          goal,
          status: 'success',
          stopReason: 'success',
          artifactsRoot: artifacts.root,
          patchPaths: result.patchPaths,
          extraArtifactPaths: reportPaths,
          verificationReport: verification,
        },
        eventBus,
      );

      return result;
    }

    // 4. Repair Loop
    const maxIterations = 5;
    let iterations = 0;
    let failureSignature = verification.failureSignature;
    let consecutiveSameSignature = 0;

    const patchPaths = l1Result.patchPaths || [];
    const touchedFiles = new Set(l1Result.filesChanged);

    const executorId = this.config.defaults?.executor || 'openai';
    const executor = this.registry.getAdapter(executorId);

    while (iterations < maxIterations) {
      iterations++;

      await eventBus.emit({
        type: 'IterationStarted',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { iteration: iterations, goal },
      });

      // Stop Conditions checks (Signature)
      if (failureSignature && verification.failureSignature === failureSignature) {
        consecutiveSameSignature++;
        if (consecutiveSameSignature >= 2) {
          // Non-improving -> Stop
          await eventBus.emit({
            type: 'RunStopped',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: {
              reason: 'non_improving',
              details: 'Verification failure signature unchanged for 2 iterations',
            },
          });
          
          const result: RunResult = {
            ...l1Result,
            status: 'failure',
            stopReason: 'non_improving',
            summary: 'Verification failure signature unchanged for 2 iterations',
            filesChanged: Array.from(touchedFiles),
            patchPaths,
            memory: this.config.memory,
            verification: {
              enabled: profile.enabled,
              passed: false,
              summary: verification.summary,
              failedChecks: verification.checks.filter((c) => !c.passed).map((c) => c.name),
              reportPaths,
            },
            lastFailureSignature: verification.failureSignature,
          };

          await fs.writeFile(artifacts.summary, JSON.stringify(result, null, 2));

          await this.writeEpisodicMemory(
            {
              runId,
              goal,
              status: 'failure',
              stopReason: 'non_improving',
              artifactsRoot: artifacts.root,
              patchPaths: result.patchPaths,
              extraArtifactPaths: reportPaths,
              verificationReport: verification,
            },
            eventBus,
          );

          return result;
        }
      } else {
        consecutiveSameSignature = 0;
        failureSignature = verification.failureSignature;
      }

      // Generate Repair
      const verificationSummary = `Verification Failed.\n${verification.summary}\nFailed Checks: ${verification.checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(', ')}\n`;

      let errorDetails = '';
      for (const check of verification.checks) {
        if (!check.passed) {
          if (check.stderrPath) {
            try {
              const errContent = await fs.readFile(check.stderrPath, 'utf8');
              errorDetails += `\nCommand '${check.command}' failed:\n${errContent.slice(-2000)}\n`;
            } catch {
              /* ignore */
            }
          }
        }
      }

      const repairPrompt = `
The previous attempt failed verification.
Goal: ${goal}

Verification Results:
${verificationSummary}

Error Details:
${errorDetails}

Please analyze the errors and produce a unified diff to fix them.
Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
`;

      const response = await executor.generate(
        {
          messages: [
            { role: 'system', content: 'You are an expert software engineer fixing code.' },
            { role: 'user', content: repairPrompt },
          ],
        },
        { runId, logger },
      );

      const outputText = response.text;

      if (outputText) {
        await fs.writeFile(
          path.join(artifacts.root, `repair_iter_${iterations}_output.txt`),
          outputText,
        );
      }

      const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);

      if (!diffMatch) {
        // Fail iteration (no diff)
        await eventBus.emit({
          type: 'RepairAttempted',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { iteration: iterations, patchPath: 'none (no-diff)' },
        });
        continue;
      }

      const rawDiffContent = diffMatch[1];
      // Remove completely empty leading/trailing lines (no characters at all)
      // but preserve lines with spaces (which are valid diff context for blank lines)
      const lines = rawDiffContent.split('\n');
      const firstContentIdx = lines.findIndex((l) => l !== '');
      let lastContentIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i] !== '') {
          lastContentIdx = i;
          break;
        }
      }
      const diffContent = firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');

      // Apply Patch
      const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
      const patchPath = await patchStore.saveSelected(100 + iterations, diffContent);
      patchPaths.push(patchPath);

      await eventBus.emit({
        type: 'RepairAttempted',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { iteration: iterations, patchPath },
      });

      const applier = new PatchApplier();
      const patchTextWithNewline = diffContent.endsWith('\n') ? diffContent : diffContent + '\n';
      
      const applyResult = await applier.applyUnifiedDiff(this.repoRoot, patchTextWithNewline, {
        maxFilesChanged: 5,
      });

      if (applyResult.applied) {
        applyResult.filesChanged?.forEach((f) => touchedFiles.add(f));
        await eventBus.emit({
          type: 'PatchApplied',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            description: `L2 Repair Iteration ${iterations}`,
            filesChanged: applyResult.filesChanged || [],
            success: true,
          },
        });
      } else {
        await eventBus.emit({
          type: 'PatchApplyFailed',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            error: applyResult.error?.message || 'Unknown apply error',
            details: applyResult.error,
          },
        });
        // Continue loop to try again? Or verify existing state?
        // If patch failed, verify result is likely same, so signature check will catch it.
      }

      // Verify again
      verification = await verificationRunner.run(
        profile,
        profile.mode,
        { touchedFiles: Array.from(touchedFiles) },
        { runId },
      );

      const reportPath = path.join(artifacts.root, `verification_report_iter_${iterations}.json`);
      await fs.writeFile(reportPath, JSON.stringify(verification, null, 2));
      reportPaths.push(reportPath);

      await fs.writeFile(
        path.join(artifacts.root, `verification_summary_iter_${iterations}.txt`),
        verification.summary,
      );

      if (verification.passed) {
        await eventBus.emit({
          type: 'IterationFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { iteration: iterations, result: 'success' },
        });

        await eventBus.emit({
          type: 'RunFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            status: 'success',
            summary: `L2 Verified Success after ${iterations} iterations`,
          },
        });

        // Save Summary
        const finalResult: RunResult = {
          status: 'success',
          runId,
          summary: `L2 Verified Success after ${iterations} iterations`,
          filesChanged: Array.from(touchedFiles),
          patchPaths,
          memory: this.config.memory,
          verification: {
            enabled: profile.enabled,
            passed: true,
            summary: verification.summary,
            reportPaths,
          },
        };

        await fs.writeFile(artifacts.summary, JSON.stringify(finalResult, null, 2));

        await this.writeEpisodicMemory(
          {
            runId,
            goal,
            status: 'success',
            stopReason: 'success',
            artifactsRoot: artifacts.root,
            patchPaths: finalResult.patchPaths,
            extraArtifactPaths: reportPaths,
            verificationReport: verification,
          },
          eventBus,
        );

        return finalResult;
      }

      await eventBus.emit({
        type: 'IterationFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { iteration: iterations, result: 'failure' },
      });
    }

    // Budget exceeded
    const failureSummary = `L2 failed to converge after ${iterations} iterations`;
    await eventBus.emit({
      type: 'RunFinished',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { status: 'failure', summary: failureSummary },
    });

    const finalResult: RunResult = {
      status: 'failure',
      runId,
      summary: failureSummary,
      filesChanged: Array.from(touchedFiles),
      patchPaths,
      stopReason: 'budget_exceeded',
      memory: this.config.memory,
      verification: {
        enabled: profile.enabled,
        passed: false,
        summary: verification.summary,
        failedChecks: verification.checks.filter((c) => !c.passed).map((c) => c.name),
        reportPaths,
      },
      lastFailureSignature: verification.failureSignature,
    };

    await fs.writeFile(artifacts.summary, JSON.stringify(finalResult, null, 2));

    await this.writeEpisodicMemory(
      {
        runId,
        goal,
        status: 'failure',
        stopReason: 'budget_exceeded',
        artifactsRoot: artifacts.root,
        patchPaths: finalResult.patchPaths,
        extraArtifactPaths: reportPaths,
        verificationReport: verification,
      },
      eventBus,
    );

    return finalResult;
  }
}
