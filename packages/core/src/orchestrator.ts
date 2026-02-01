import {
  Config,
  OrchestratorEvent,
  createRunDir,
  writeManifest,
  JsonlLogger,
  ToolPolicy,
  RetrievalIntent,
  RunSummary,
  SummaryWriter,
  ConfigError,
  redactObject,
} from '@orchestrator/shared';
import {
  ContextSignal,
  GitService,
  RepoScanner,
  SearchService,
  PatchApplier,
  SimpleContextPacker,
  SnippetExtractor,
  getIndexStatus,
  IndexUpdater,
  SemanticIndexStore,
  SemanticSearchService,
} from '@orchestrator/repo';
import {
  MemoryEntry,
  createMemoryStore,
  ProceduralMemory,
  ProceduralMemoryEntry,
  ProceduralMemoryQuery,
  MemorySearchService,
  VectorBackendFactory,
  NoOpVectorMemoryBackend,
} from '@orchestrator/memory';
import { Embedder } from '@orchestrator/adapters';
import { ProviderRegistry, EventBus } from './registry';
import { PatchStore } from './exec/patch_store';
import { PlanService } from './plan/service';
import { ExecutionService } from './exec/service';
import { UserInterface } from '@orchestrator/exec';
import { VerificationRunner } from './verify/runner';
import { VerificationProfile } from './verify/types';
import { MemoryWriter } from './memory';
import type { RepoState } from './memory/types';
import type { VerificationReport } from './verify/types';
import path from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import { createHash } from 'crypto';
import { CostTracker } from './cost/tracker';
import { DEFAULT_BUDGET } from './config/budget';
import { ConfigLoader } from './config/loader';
import { SimpleContextFuser } from './context';
import {
  CandidateGenerator,
  StepContext,
  Candidate,
  CandidateGenerationResult,
} from './orchestrator/l3/candidate_generator';
import {
  CandidateEvaluator,
  EvaluationResult,
  selectBestCandidate,
} from './orchestrator/l3/candidate_evaluator';
import { Judge, JudgeContext, JudgeCandidate, JudgeVerification } from './judge';
import { Diagnoser } from './orchestrator/l3/diagnoser';

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
  thinkLevel: 'L0' | 'L1' | 'L2' | 'L3';
  runId?: string;
}

class ProceduralMemoryImpl implements ProceduralMemory {
  constructor(
    private config: Config,
    private repoRoot: string,
  ) {}

  private resolveMemoryDbPath(): string | undefined {
    const p = this.config.memory?.storage?.path;
    if (!p) return undefined;
    return path.isAbsolute(p) ? p : path.join(this.repoRoot, p);
  }

  async find(queries: ProceduralMemoryQuery[], limit: number): Promise<ProceduralMemoryEntry[][]> {
    const dbPath = this.resolveMemoryDbPath();
    if (!dbPath) {
      return queries.map(() => []);
    }
    const store = createMemoryStore();
    try {
      const keyEnvVar = this.config.security?.encryption?.keyEnv ?? 'ORCHESTRATOR_ENC_KEY';
      const key = process.env[keyEnvVar];

      store.init({
        dbPath,
        encryption: {
          encryptAtRest: this.config.memory?.storage?.encryptAtRest ?? false,
          key: key || '',
        },
      });

      const repoId = this.repoRoot; // Assuming repoRoot is the repoId
      const allProcedural = store.list(repoId, 'procedural');

      const results: ProceduralMemoryEntry[][] = [];
      for (const query of queries) {
        const filtered = allProcedural.filter((entry) => {
          if (query.titleContains && !entry.title.includes(query.titleContains)) {
            return false;
          }
          return true;
        });
        results.push(filtered.slice(0, limit));
      }
      return results;
    } finally {
      store.close();
    }
  }
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
  private escalationCount = 0;

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

    // L1+ features below
    if (options.thinkLevel !== 'L0') {
      const artifacts = await createRunDir(this.repoRoot, runId);
      const logger = new JsonlLogger(artifacts.trace);
      const eventBus: EventBus = {
        emit: async (e) => {
          const redactedEvent = this.config.security?.redaction?.enabled
            ? (redactObject(e) as OrchestratorEvent)
            : e;
          await logger.log(redactedEvent);
        },
      };
      await this.autoUpdateIndex(eventBus, runId);
    }

    if (options.thinkLevel === 'L0') {
      return this.runL0(goal, runId);
    } else if (options.thinkLevel === 'L3') {
      return this.runL3(goal, runId);
    } else if (options.thinkLevel === 'L2') {
      return this.runL2(goal, runId);
    } else {
      return this.runL1(goal, runId);
    }
  }

  private async autoUpdateIndex(eventBus: EventBus, runId: string): Promise<void> {
    const cfg = this.config.indexing;
    if (!this.config.memory?.enabled || !cfg?.enabled || !cfg.autoUpdateOnRun) {
      return;
    }

    try {
      const orchestratorConfig = {
        ...this.config,
        rootDir: this.repoRoot,
        orchestratorDir: path.join(this.repoRoot, '.orchestrator'),
      };
      const status = await getIndexStatus(orchestratorConfig);

      if (!status.isIndexed) {
        // TODO: Could auto-build here based on config
        console.warn('Auto-update skipped: index does not exist.');
        return;
      }

      const drift = status.drift;
      if (!drift || !drift.hasDrift) {
        return; // No drift
      }

      const totalDrift = drift.addedCount + drift.removedCount + drift.changedCount;
      if (totalDrift > (cfg.maxAutoUpdateFiles ?? 5000)) {
        console.warn(
          `Index drift (${totalDrift} files) exceeds limit (${cfg.maxAutoUpdateFiles}). Skipping auto-update.`,
        );
        return;
      }

      await eventBus.emit({
        type: 'IndexAutoUpdateStarted',
        schemaVersion: 1,
        runId,
        timestamp: new Date().toISOString(),
        payload: {
          fileCount: totalDrift,
          reason: 'Pre-run check detected drift.',
        },
      });

      const indexPath = path.join(this.repoRoot, cfg.path);
      const updater = new IndexUpdater(indexPath);
      const result = await updater.update(this.repoRoot);

      await eventBus.emit({
        type: 'IndexAutoUpdateFinished',
        schemaVersion: 1,
        runId,
        timestamp: new Date().toISOString(),
        payload: {
          filesAdded: result.added.length,
          filesRemoved: result.removed.length,
          filesChanged: result.changed.length,
        },
      });

      await eventBus.emit({
        type: 'MemoryStalenessReconciled',
        schemaVersion: 1,
        runId,
        timestamp: new Date().toISOString(),
        payload: {
          details: 'Index updated, subsequent memory retrievals will use fresh data.',
        },
      });
    } catch (error) {
      console.warn('Auto-update of index failed:', error);
      // Non-fatal
    }
  }

  private shouldWriteEpisodicMemory(): boolean {
    const mem = this.config.memory;
    return !!(mem?.enabled && mem?.writePolicy?.enabled && mem?.writePolicy?.storeEpisodes);
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

    addDirFiles(
      root,
      (n) =>
        n === 'executor_output.txt' ||
        /^step_.*_output\.txt$/.test(n) ||
        /^repair_iter_\d+_output\.txt$/.test(n) ||
        /^verification_report_.*\.json$/.test(n) ||
        /^verification_command_source.json$/.test(n) ||
        /^verification_summary_.*\.txt$/.test(n) ||
        /^failure_summary_iter_\d+\.(json|txt)$/.test(n) ||
        /^fused_context_.*\.(json|txt)$/.test(n) ||
        /^reviewer_iter_.*\.json$/.test(n),
    );

    // De-dupe + relativize.
    return [...new Set(absPaths.map((p) => this.toArtifactRelPath(p)))];
  }

  private async writeEpisodicMemory(
    summary: RunSummary,
    args: {
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
      config: this.config,
      artifactPaths: this.collectArtifactPaths(
        summary.runId,
        args.artifactsRoot,
        args.patchPaths ?? [],
        args.extraArtifactPaths ?? [],
      ),
    };

    try {
      const writer = new MemoryWriter({
        eventBus,
        runId: summary.runId,
        securityConfig: this.config.security,
      });
      await writer.extractEpisodic(
        {
          runId: summary.runId,
          goal: summary.goal ?? '',
          status: summary.status,
          stopReason: summary.stopReason ?? 'unknown',
        },
        repoState,
        args.verificationReport,
      );
    } catch {
      // Non-fatal: don't fail the run if memory persistence fails.
    }
  }

  private async _buildRunSummary(
    runId: string,
    goal: string,
    startTime: number,
    status: 'success' | 'failure',
    options: RunOptions,
    runResult: Partial<RunResult>,
    artifacts: {
      root: string;
      trace: string;
      summary: string;
      patchesDir: string;
      manifest: string;
    },
    l3Metadata?: {
      bestOfN: number;
      candidatesGenerated: number;
      candidatesEvaluated: number;
      selectedCandidateId?: string;
      passingCandidateSelected: boolean;
      reviewerInvoked: boolean;
      judgeInvoked: boolean;
      judgeInvocationReason?: string;
      evaluationReportPaths?: string[];
      selectionRankingPath?: string;
    },
  ): Promise<RunSummary> {
    const finishedAt = new Date();
    const patchStats = runResult.filesChanged
      ? {
          filesChanged: runResult.filesChanged.length,
          linesAdded: 0, // Note: Not easily available, default to 0
          linesDeleted: 0, // Note: Not easily available, default to 0
          finalDiffPath:
            runResult.patchPaths && runResult.patchPaths.length > 0
              ? runResult.patchPaths[runResult.patchPaths.length - 1]
              : undefined,
        }
      : undefined;

    const costSummary = this.costTracker?.getSummary();

    return {
      schemaVersion: 1,
      runId,
      command: ['run', goal],
      goal,
      repoRoot: this.repoRoot,
      repoId: this.repoRoot, // Consider a more stable repo ID
      startedAt: new Date(startTime).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startTime,
      status,
      stopReason: runResult.stopReason,
      thinkLevel: parseInt(options.thinkLevel.slice(1), 10),
      escalated: this.escalationCount > 0,
      selectedProviders: {
        planner: this.config.defaults?.planner || 'default',
        executor: this.config.defaults?.executor || 'default',
        reviewer: this.config.defaults?.reviewer,
      },
      budgets: {
        maxIterations: this.config.budget?.iter ?? DEFAULT_BUDGET.iter,
        maxToolRuns: 999, // Not yet implemented
        maxWallTimeMs: this.config.budget?.time ?? DEFAULT_BUDGET.time,
        maxCostUsd: this.config.budget?.cost,
      },
      patchStats,
      verification: runResult.verification
        ? {
            enabled: runResult.verification.enabled,
            passed: runResult.verification.passed,
            failedChecks: runResult.verification.failedChecks?.length,
            reportPaths: runResult.verification.reportPaths,
          }
        : undefined,
      tools: {
        enabled: this.toolPolicy !== undefined,
        runs: [], // Not yet implemented
      },
      memory: {
        enabled: this.config.memory?.enabled ?? false,
        // Deferring detailed stats for now
      },
      indexing: {
        enabled: this.config.indexing?.enabled ?? false,
        autoUpdated: false, // Deferring detailed stats for now
      },
      costs: {
        perProvider: costSummary?.providers || {},
        totals: {
          inputTokens: costSummary?.total.inputTokens || 0,
          outputTokens: costSummary?.total.outputTokens || 0,
          totalTokens: costSummary?.total.totalTokens || 0,
          estimatedCostUsd: costSummary?.total.estimatedCostUsd ?? null,
        },
      },
      artifacts: {
        manifestPath: artifacts.manifest,
        tracePath: artifacts.trace,
        patchPaths: runResult.patchPaths,
        contextPaths: [], // Not yet implemented
        toolLogPaths: [], // Not yet implemented
      },
      telemetry: {
        enabled: this.config.telemetry?.enabled ?? false,
        mode: this.config.telemetry?.mode ?? 'local',
      },
      l3: l3Metadata,
    };
  }

  async runL0(goal: string, runId: string): Promise<RunResult> {
    const startTime = Date.now();
    // 1. Setup Artifacts
    const artifacts = await createRunDir(this.repoRoot, runId);
    ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
    const logger = new JsonlLogger(artifacts.trace);

    const emitEvent = async (e: OrchestratorEvent) => {
      const redactedEvent = this.config.security?.redaction?.enabled
        ? (redactObject(e) as OrchestratorEvent)
        : e;
      await logger.log(redactedEvent);
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
      throw new ConfigError('No executor provider configured');
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

      const runResult: RunResult = {
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

      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        'failure',
        { thinkLevel: 'L0' },
        runResult,
        artifacts,
      );
      await SummaryWriter.write(summary, artifacts.root);

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
        summary,
        {
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
    const diffContent =
      firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');

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

    const summary = await this._buildRunSummary(
      runId,
      goal,
      startTime,
      runResult.status,
      { thinkLevel: 'L0' },
      runResult,
      artifacts,
    );
    await SummaryWriter.write(summary, artifacts.root);

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
      summary,
      {
        artifactsRoot: artifacts.root,
        patchPaths: runResult.patchPaths,
      },
      { emit: emitEvent },
    );

    return runResult;
  }

  async runL1(goal: string, runId: string): Promise<RunResult> {
    const startTime = Date.now();
    const artifacts = await createRunDir(this.repoRoot, runId);
    ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
    const logger = new JsonlLogger(artifacts.trace);

    const eventBus: EventBus = {
      emit: async (e) => {
        const redactedEvent = this.config.security?.redaction?.enabled
          ? (redactObject(e) as OrchestratorEvent)
          : e;
        await logger.log(redactedEvent);
      },
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

      const runResult: RunResult = {
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

      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        'failure',
        { thinkLevel: 'L1' },
        runResult,
        artifacts,
      );
      await SummaryWriter.write(summary, artifacts.root);

      await this.writeEpisodicMemory(
        summary,
        {
          artifactsRoot: artifacts.root,
        },
        eventBus,
      );

      return runResult;
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
      summaryMsg: string,
    ): Promise<RunResult> => {
      if (stopReason) {
        await eventBus.emit({
          type: 'RunStopped',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { reason: stopReason, details: summaryMsg },
        });
      }

      await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status, summary: summaryMsg },
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

      const runResult: RunResult = {
        status,
        runId,
        summary: summaryMsg,
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

      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        status,
        { thinkLevel: 'L1' },
        runResult,
        artifacts,
      );
      await SummaryWriter.write(summary, artifacts.root);

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
        summary,
        {
          artifactsRoot: artifacts.root,
          patchPaths,
          extraArtifactPaths: contextPaths,
        },
        eventBus,
      );

      return runResult;
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

        const lexicalMatches = searchResults.matches;

        // M15-07: Semantic Search
        let semanticHits: { path: string; startLine: number; content: string }[] = [];
        if (this.config.indexing?.semantic?.enabled) {
          try {
            const indexPath = path.join(this.repoRoot, this.config.indexing.path);
            if (fsSync.existsSync(path.join(indexPath, 'semantic.sqlite'))) {
              const store = new SemanticIndexStore();
              store.init(path.join(indexPath, 'semantic.sqlite'));

              const embedderId = store.getMeta()?.embedderId;
              if (embedderId) {
                const embedder = this.registry.getAdapter(embedderId);
                const semanticSearchService = new SemanticSearchService({
                  store,
                  embedder,
                  eventBus,
                });

                const hits = await semanticSearchService.search(
                  step,
                  this.config.indexing.semantic.topK ?? 5,
                  runId,
                );

                if (hits.length > 0) {
                  const hitsArtifactPath = path.join(
                    artifacts.root,
                    `semantic_hits_step_${stepsCompleted}.json`,
                  );
                  await fs.writeFile(hitsArtifactPath, JSON.stringify(hits, null, 2));
                  contextPaths.push(hitsArtifactPath);
                }

                semanticHits = hits.map((hit) => ({
                  path: hit.path,
                  startLine: hit.startLine,
                  endLine: hit.endLine,
                  content: hit.content,
                  score: hit.score,
                }));
              }
              store.close();
            }
          } catch (e: any) {
            await eventBus.emit({
              type: 'SemanticSearchFailed',
              schemaVersion: 1,
              runId,
              timestamp: new Date().toISOString(),
              payload: {
                error: e.message,
              },
            });
          }
        }

        const allMatches = [
          ...lexicalMatches,
          ...semanticHits.map((h) => ({
            path: h.path,
            line: h.startLine,
            column: 0,
            matchText: 'SEMANTIC_MATCH',
            lineText: '',
            score: (h as any).score || 0.5,
          })),
        ];

        for (const touched of touchedFiles) {
          allMatches.push({
            path: touched,
            line: 1,
            column: 1,
            matchText: 'PREVIOUSLY_TOUCHED',
            lineText: '',
            score: 1000,
          });
        }

        const extractor = new SnippetExtractor();
        const candidates = await extractor.extractSnippets(allMatches, { cwd: this.repoRoot });

        const packer = new SimpleContextPacker();
        contextPack = packer.pack(step, [], candidates, {
          tokenBudget: this.config.context?.tokenBudget || 8000,
        });
      } catch {
        // Ignore context errors
      }

      // Memory Search
      const memoryHits = await this.searchMemoryHits(
        {
          query: `${goal} ${step}`,
          runId,
          stepId: stepsCompleted,
          artifactsRoot: artifacts.root,
          intent: 'implementation',
        },
        eventBus,
      );

      const fuser = new SimpleContextFuser(this.config.security);
      const fusionBudgets = {
        maxRepoContextChars: (this.config.context?.tokenBudget || 8000) * 4,
        maxMemoryChars: this.config.memory?.maxChars ?? 2000,
        maxSignalsChars: 1000,
      };

      // TODO: Plumb real signals
      const signals: ContextSignal[] = [];

      const fusedContext = fuser.fuse({
        goal: `Goal: ${goal}\nCurrent Step: ${step}`,
        repoPack: contextPack || { items: [], totalChars: 0, estimatedTokens: 0 },
        memoryHits,
        signals,
        budgets: fusionBudgets,
      });

      const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
      const fusedJsonPath = path.join(
        artifacts.root,
        `fused_context_step_${stepsCompleted}_${stepSlug}.json`,
      );
      const fusedTxtPath = path.join(
        artifacts.root,
        `fused_context_step_${stepsCompleted}_${stepSlug}.txt`,
      );

      await fs.writeFile(fusedJsonPath, JSON.stringify(fusedContext.metadata, null, 2));
      await fs.writeFile(fusedTxtPath, fusedContext.prompt);
      contextPaths.push(fusedJsonPath, fusedTxtPath);

      const contextText = fusedContext.prompt;

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
          systemPrompt += `

PREVIOUS ATTEMPT FAILED. Error: ${lastError}\nPlease fix the error and try again.`;
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
        const diffContent =
          firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');

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

  private async searchMemoryHits(
    args: {
      query: string;
      runId: string;
      stepId: number;
      artifactsRoot: string;
      intent: RetrievalIntent;
      failureSignature?: string;
    },
    eventBus: EventBus,
  ): Promise<MemoryEntry[]> {
    const memConfig = this.config.memory;
    if (!memConfig?.enabled) {
      return [];
    }

    const dbPath = this.resolveMemoryDbPath();
    if (!dbPath) {
      return [];
    }

    const store = createMemoryStore();
    try {
      const keyEnvVar = this.config.security?.encryption?.keyEnv ?? 'ORCHESTRATOR_ENC_KEY';
      const key = process.env[keyEnvVar];

      store.init({
        dbPath,
        encryption: {
          encryptAtRest: memConfig.storage?.encryptAtRest ?? false,
          key: key || '',
        },
      });

      const { query } = args;
      const topK = memConfig.retrieval.topK ?? 5;

      const vectorBackend = memConfig.vector?.backend
        ? VectorBackendFactory.fromConfig(
            {
              ...memConfig.vector,
              path: path.join(this.repoRoot, memConfig.vector.path || ''),
            },
            false,
          )
        : new NoOpVectorMemoryBackend();

      const embedderId = memConfig.embedder;
      if (!embedderId) {
        throw new ConfigError('Memory search requires an embedder to be configured.');
      }
      const embedder = this.registry.getAdapter(embedderId) as Embedder;

      const searchService = new MemorySearchService({
        memoryStore: store,
        vectorBackend,
        embedder,
        repoId: this.repoRoot,
      });

      const result = await searchService.search({
        query,
        mode: 'hybrid',
        topKFinal: topK,
        intent: args.intent,
        staleDownrank: memConfig.retrieval.staleDownrank ?? true,
        episodicBoostFailureSignature: args.failureSignature,
        fallbackToLexicalOnVectorError: true,
      });

      const hits = result.hits;

      await eventBus.emit({
        type: 'MemorySearched',
        schemaVersion: 1,
        runId: args.runId,
        timestamp: new Date().toISOString(),
        payload: {
          query,
          topK,
          hitsCount: hits.length,
          intent: args.intent,
        },
      });

      if (hits.length === 0) {
        return [];
      }

      const artifactPath = path.join(args.artifactsRoot, `memory_hits_step_${args.stepId}.json`);
      await fs.writeFile(artifactPath, JSON.stringify(hits, null, 2));

      return hits;
    } catch (err) {
      // Log but don't fail
      console.error('Memory search failed:', err);
      return [];
    } finally {
      store.close();
    }
  }

  async runL2(goal: string, runId: string): Promise<RunResult> {
    const startTime = Date.now();
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
        emit: async (e) => {
          const redactedEvent = this.config.security?.redaction?.enabled
            ? (redactObject(e) as OrchestratorEvent)
            : e;
          await logger.log(redactedEvent);
        },
      };
      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        l1Result.status,
        { thinkLevel: 'L2' },
        l1Result,
        artifacts,
      );
      await this.writeEpisodicMemory(
        summary,
        {
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
        emit: async (e) => {
          const redactedEvent = this.config.security?.redaction?.enabled
            ? (redactObject(e) as OrchestratorEvent)
            : e;
          await logger.log(redactedEvent);
        },
      };
      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        l1Result.status,
        { thinkLevel: 'L2' },
        l1Result,
        artifacts,
      );
      await this.writeEpisodicMemory(
        summary,
        {
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

    const eventBus: EventBus = {
      emit: async (e) => {
        const redactedEvent = this.config.security?.redaction?.enabled
          ? (redactObject(e) as OrchestratorEvent)
          : e;
        await logger.log(redactedEvent);
      },
    };
    const proceduralMemory = new ProceduralMemoryImpl(this.config, this.repoRoot);
    const verificationRunner = new VerificationRunner(
      proceduralMemory,
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

      const runResult: RunResult = {
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

      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        'success',
        { thinkLevel: 'L2' },
        runResult,
        artifacts,
      );
      await SummaryWriter.write(summary, artifacts.root);

      await this.writeEpisodicMemory(
        summary,
        {
          artifactsRoot: artifacts.root,
          patchPaths: runResult.patchPaths,
          extraArtifactPaths: reportPaths,
          verificationReport: verification,
        },
        eventBus,
      );

      return runResult;
    }

    // 4. Repair Loop
    const maxIterations = 5;
    let iterations = 0;
    let failureSignature = verification.failureSignature;
    let consecutiveSameSignature = 0;
    let consecutivePatchApplyFailures = 0;

    const patchPaths = l1Result.patchPaths || [];
    const touchedFiles = new Set(l1Result.filesChanged);
    const executorId = this.config.defaults?.executor || 'openai';
    const executor = this.registry.getAdapter(executorId);

    while (iterations < maxIterations) {
      iterations++;

      // Escalation checks
      const escalationConfig = this.config.escalation;
      if (
        escalationConfig?.enabled &&
        this.escalationCount < (escalationConfig.maxEscalations ?? 1)
      ) {
        if (
          consecutiveSameSignature >= (escalationConfig.toL3AfterNonImprovingIterations ?? 2) ||
          consecutivePatchApplyFailures >= (escalationConfig.toL3AfterPatchApplyFailures ?? 2)
        ) {
          await eventBus.emit({
            type: 'RunEscalated',
            schemaVersion: 1,
            runId,
            timestamp: new Date().toISOString(),
            payload: {
              from: 'L2',
              to: 'L3',
              reason:
                consecutiveSameSignature >= (escalationConfig.toL3AfterNonImprovingIterations ?? 2)
                  ? 'non_improving'
                  : 'patch_apply_failure',
            },
          });
          this.escalationCount++;
          return this.runL3(goal, runId);
        }
      }

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

          const runResult: RunResult = {
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

          const summary = await this._buildRunSummary(
            runId,
            goal,
            startTime,
            'failure',
            { thinkLevel: 'L2' },
            runResult,
            artifacts,
          );
          await SummaryWriter.write(summary, artifacts.root);

          await this.writeEpisodicMemory(
            summary,
            {
              artifactsRoot: artifacts.root,
              patchPaths: runResult.patchPaths,
              extraArtifactPaths: reportPaths,
              verificationReport: verification,
            },
            eventBus,
          );

          return runResult;
        }
      } else {
        consecutiveSameSignature = 0;
        failureSignature = verification.failureSignature;
      }

      // Search memory for similar failures
      const memoryHits = await this.searchMemoryHits(
        {
          query: `${goal} ${verification.summary}`,
          runId,
          stepId: 100 + iterations,
          artifactsRoot: artifacts.root,
          intent: 'verification',
          failureSignature: verification.failureSignature,
        },
        eventBus,
      );

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

      const fuser = new SimpleContextFuser(this.config.security);
      const fusedContext = fuser.fuse({
        goal: `Goal: ${goal}\nTask: Fix verification errors.`,
        repoPack: { items: [], totalChars: 0, estimatedTokens: 0 }, // No repo context for repairs yet
        memoryHits,
        signals: [],
        budgets: {
          maxRepoContextChars: 0,
          maxMemoryChars: 4000,
          maxSignalsChars: 1000,
        },
      });

      const repairPrompt = `
The previous attempt failed verification.
Goal: ${goal}

Verification Results:
${verificationSummary}

Error Details:
${errorDetails}

CONTEXT FROM MEMORY:
${fusedContext.prompt}

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
      const diffContent =
        firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');

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
        consecutivePatchApplyFailures = 0;
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
        consecutivePatchApplyFailures++;
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
        const runResult: RunResult = {
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

        const summary = await this._buildRunSummary(
          runId,
          goal,
          startTime,
          'success',
          { thinkLevel: 'L2' },
          runResult,
          artifacts,
        );
        await SummaryWriter.write(summary, artifacts.root);

        await this.writeEpisodicMemory(
          summary,
          {
            artifactsRoot: artifacts.root,
            patchPaths: runResult.patchPaths,
            extraArtifactPaths: reportPaths,
            verificationReport: verification,
          },
          eventBus,
        );

        return runResult;
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

    const runResult: RunResult = {
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

    const summary = await this._buildRunSummary(
      runId,
      goal,
      startTime,
      'failure',
      { thinkLevel: 'L2' },
      runResult,
      artifacts,
    );
    await SummaryWriter.write(summary, artifacts.root);

    await this.writeEpisodicMemory(
      summary,
      {
        artifactsRoot: artifacts.root,
        patchPaths: runResult.patchPaths,
        extraArtifactPaths: reportPaths,
        verificationReport: verification,
      },
      eventBus,
    );

    return runResult;
  }

  async runL3(goal: string, runId: string): Promise<RunResult> {
    const startTime = Date.now();
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

      const runResult: RunResult = {
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

      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        'failure',
        { thinkLevel: 'L3' },
        runResult,
        artifacts,
      );
      await SummaryWriter.write(summary, artifacts.root);

      await this.writeEpisodicMemory(
        summary,
        {
          artifactsRoot: artifacts.root,
        },
        eventBus,
      );

      return runResult;
    }

    const executionService = new ExecutionService(
      eventBus,
      this.git,
      new PatchApplier(),
      runId,
      this.repoRoot,
      this.config,
    );

    const budget = { ...DEFAULT_BUDGET, ...this.config.budget };

    // L3 metadata tracking
    const l3Metadata = {
      bestOfN: this.config.l3?.bestOfN ?? 3,
      candidatesGenerated: 0,
      candidatesEvaluated: 0,
      selectedCandidateId: undefined as string | undefined,
      passingCandidateSelected: false,
      reviewerInvoked: false,
      judgeInvoked: false,
      judgeInvocationReason: undefined as string | undefined,
      evaluationReportPaths: [] as string[],
      selectionRankingPath: undefined as string | undefined,
    };

    // Set up verification runner for candidate evaluation
    const proceduralMemory = new ProceduralMemoryImpl(this.config, this.repoRoot);
    const toolPolicy = this.toolPolicy ?? {
      enabled: true,
      requireConfirmation: false,
      allowlistPrefixes: [],
      denylistPatterns: [],
      allowNetwork: false,
      maxOutputBytes: 1024 * 1024,
      timeoutMs: 60000,
      autoApprove: true,
    };
    const ui = this.ui ?? {
      confirm: async () => true,
    };
    const verificationRunner = new VerificationRunner(
      proceduralMemory,
      toolPolicy,
      ui,
      eventBus,
      this.repoRoot,
    );

    const verificationProfile: VerificationProfile = {
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

    // Create candidate evaluator for L3 flow
    const candidateEvaluator = new CandidateEvaluator(
      this.git,
      new PatchApplier(),
      verificationRunner,
      this.repoRoot,
      artifacts.root,
      logger,
    );

    let stepsCompleted = 0;
    const patchPaths: string[] = [];
    const contextPaths: string[] = [];
    const touchedFiles = new Set<string>();

    const signals: ContextSignal[] = [];
    let consecutiveInvalidDiffs = 0;
    let consecutiveApplyFailures = 0;
    let lastApplyErrorHash = '';

    const finish = async (
      status: 'success' | 'failure',
      stopReason: RunResult['stopReason'] | undefined,
      summaryMsg: string,
    ): Promise<RunResult> => {
      if (stopReason) {
        await eventBus.emit({
          type: 'RunStopped',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { reason: stopReason, details: summaryMsg },
        });
      }

      await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status, summary: summaryMsg },
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

      const runResult: RunResult = {
        status,
        runId,
        summary: summaryMsg,
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

      const summary = await this._buildRunSummary(
        runId,
        goal,
        startTime,
        status,
        { thinkLevel: 'L3' },
        runResult,
        artifacts,
        l3Metadata,
      );
      await SummaryWriter.write(summary, artifacts.root);

      await this.writeEpisodicMemory(
        summary,
        {
          artifactsRoot: artifacts.root,
          patchPaths,
          extraArtifactPaths: contextPaths,
        },
        eventBus,
      );

      return runResult;
    };

    for (const step of steps) {
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
        const snapshot = await scanner.scan(this.repoRoot, {
          excludes: this.config.context?.exclude,
        });

        const searchService = new SearchService(this.config.context?.rgPath);
        const searchResults = await searchService.search({
          query: step,
          cwd: this.repoRoot,
          maxMatchesPerFile: 5,
        });

        const lexicalMatches = searchResults.matches;
        let semanticHits: { path: string; startLine: number; content: string }[] = [];

        // ... (semantic search logic from L1)

        const allMatches = [
          ...lexicalMatches,
          ...semanticHits.map((h) => ({
            path: h.path,
            line: h.startLine,
            column: 0,
            matchText: 'SEMANTIC_MATCH',
            lineText: '',
            score: (h as any).score || 0.5,
          })),
        ];

        for (const touched of touchedFiles) {
          allMatches.push({
            path: touched,
            line: 1,
            column: 1,
            matchText: 'PREVIOUSLY_TOUCHED',
            lineText: '',
            score: 1000,
          });
        }

        const extractor = new SnippetExtractor();
        const candidates = await extractor.extractSnippets(allMatches, { cwd: this.repoRoot });

        const packer = new SimpleContextPacker();
        contextPack = packer.pack(step, [], candidates, {
          tokenBudget: this.config.context?.tokenBudget || 8000,
        });
      } catch {
        // Ignore context errors
      }

      const memoryHits = await this.searchMemoryHits(
        {
          query: `${goal} ${step}`,
          runId,
          stepId: stepsCompleted,
          artifactsRoot: artifacts.root,
          intent: 'implementation',
        },
        eventBus,
      );

      const fuser = new SimpleContextFuser(this.config.security);
      let fusedContext = fuser.fuse({
        goal: `Goal: ${goal}\nCurrent Step: ${step}`,
        repoPack: contextPack || { items: [], totalChars: 0, estimatedTokens: 0 },
        memoryHits,
        signals,
        budgets: {
          maxRepoContextChars: (this.config.context?.tokenBudget || 8000) * 4,
          maxMemoryChars: this.config.memory?.maxChars ?? 2000,
          maxSignalsChars: 1000,
        },
      });

      const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
      const fusedJsonPath = path.join(
        artifacts.root,
        `fused_context_step_${stepsCompleted}_${stepSlug}.json`,
      );
      const fusedTxtPath = path.join(
        artifacts.root,
        `fused_context_step_${stepsCompleted}_${stepSlug}.txt`,
      );

      await fs.writeFile(fusedJsonPath, JSON.stringify(fusedContext.metadata, null, 2));
      await fs.writeFile(fusedTxtPath, fusedContext.prompt);
      contextPaths.push(fusedJsonPath, fusedTxtPath);

      // --- L3 Candidate Generation ---
      const candidateGenerator = new CandidateGenerator();
      const bestOfN = this.config.l3?.bestOfN ?? 3;
      const enableJudge = this.config.l3?.enableJudge ?? true;
      const enableReviewer = this.config.l3?.enableReviewer ?? true;
      const stepContext: StepContext = {
        runId,
        goal,
        step,
        stepIndex: stepsCompleted,
        fusedContext,
        eventBus,
        costTracker: this.costTracker!,
        executor: providers.executor,
        reviewer: providers.reviewer,
        artifactsRoot: artifacts.root,
        budget: budget,
        logger,
      };

      // Generate candidates and get reviews
      const generationResult = await candidateGenerator.generateAndReviewCandidates(
        stepContext,
        bestOfN,
      );

      l3Metadata.candidatesGenerated += generationResult.candidates.length;
      if (enableReviewer && generationResult.reviews.length > 0) {
        l3Metadata.reviewerInvoked = true;
      }

      let bestCandidate: Candidate | null = null;
      let judgeInvoked = false;
      let judgeReason: string | undefined;

      if (generationResult.candidates.length === 0) {
        // No valid candidates - stop condition
        return finish(
          'failure',
          'invalid_output',
          'No valid candidates generated for step: ' + step,
        );
      }

      // --- L3 Candidate Evaluation with Verification ---
      // Evaluate each candidate against verification profile
      const evaluationResults: EvaluationResult[] = [];

      for (const candidate of generationResult.candidates) {
        if (!candidate.patch) continue;

        const evalResult = await candidateEvaluator.evaluate(
          { patch: candidate.patch, index: candidate.index },
          verificationProfile,
          { touchedFiles: Array.from(touchedFiles) },
          ui,
          { runId },
          stepsCompleted,
        );

        evaluationResults.push(evalResult);
        l3Metadata.candidatesEvaluated++;

        // Track evaluation report paths
        const evalReportPath = path.join(
          artifacts.root,
          'verification',
          `iter_${stepsCompleted}_candidate_${candidate.index}_report.json`,
        );
        if (fsSync.existsSync(evalReportPath)) {
          l3Metadata.evaluationReportPaths.push(evalReportPath);
        }
      }

      // --- L3 Selection Logic ---
      // 1. If passing candidates exist, select the minimal (smallest diff)
      // 2. Else use reviewer/judge tie-break
      const passingResults = evaluationResults.filter((r) => r.report.passed);

      if (passingResults.length > 0) {
        // Select minimal passing candidate
        const selected = await selectBestCandidate(passingResults, artifacts.root, stepsCompleted);
        if (selected) {
          bestCandidate =
            generationResult.candidates.find((c) => c.index === selected.candidate.index) || null;
          l3Metadata.passingCandidateSelected = true;
          l3Metadata.selectedCandidateId = String(selected.candidate.index);
        }
      } else if (evaluationResults.length > 0) {
        // No passing candidates - use reviewer/judge tie-break
        const reviews = generationResult.reviews;

        // Check for near-tie or need for judge
        const { invoke: shouldInvokeJudge, reason: invokeReason } = Judge.shouldInvoke(
          verificationProfile.enabled,
          evaluationResults.map((r) => ({
            candidateId: String(r.candidate.index),
            passed: r.report.passed,
            score: r.score,
          })),
          reviews.map((r) => ({
            candidateId: r.candidateId,
            score: r.score,
          })),
        );

        if (enableJudge && shouldInvokeJudge && invokeReason) {
          // Invoke Judge for tie-breaking
          const judge = new Judge(providers.reviewer);

          const judgeContext: JudgeContext = {
            runId,
            iteration: stepsCompleted,
            artifactsRoot: artifacts.root,
            logger,
            eventBus,
          };

          // Build judge input from actual evaluation results
          const judgeCandidates: JudgeCandidate[] = evaluationResults.map((r) => {
            const candidate = generationResult.candidates.find(
              (c) => c.index === r.candidate.index,
            );
            return {
              id: String(r.candidate.index),
              patch: r.candidate.patch,
              patchStats: candidate?.patchStats,
            };
          });

          const judgeVerifications: JudgeVerification[] = evaluationResults.map((r) => ({
            candidateId: String(r.candidate.index),
            status: r.report.passed ? 'passed' : 'failed',
            score: r.score / 1000, // Normalize from evaluation score
            summary: r.report.summary,
          }));

          const judgeOutput = await judge.decide(
            {
              goal,
              candidates: judgeCandidates,
              verifications: judgeVerifications,
              invocationReason: invokeReason,
            },
            judgeContext,
          );

          judgeInvoked = true;
          judgeReason = `${invokeReason}: Judge selected candidate ${judgeOutput.winnerCandidateId} with confidence ${judgeOutput.confidence}.`;
          l3Metadata.judgeInvoked = true;
          l3Metadata.judgeInvocationReason = judgeReason;

          // Select the winner
          const winnerId = parseInt(judgeOutput.winnerCandidateId, 10);
          bestCandidate =
            generationResult.candidates.find((c) => c.index === winnerId) ||
            generationResult.candidates[0];
          l3Metadata.selectedCandidateId = judgeOutput.winnerCandidateId;
        } else {
          // Use evaluation-based selection (least bad)
          const selected = await selectBestCandidate(
            evaluationResults,
            artifacts.root,
            stepsCompleted,
          );
          if (selected) {
            bestCandidate =
              generationResult.candidates.find((c) => c.index === selected.candidate.index) || null;
            l3Metadata.selectedCandidateId = String(selected.candidate.index);
          }
        }
      }

      // Update selection ranking path
      const selectionRankingPath = path.join(
        artifacts.root,
        'selection',
        `iter_${stepsCompleted}_ranking.json`,
      );
      if (fsSync.existsSync(selectionRankingPath)) {
        l3Metadata.selectionRankingPath = selectionRankingPath;
      }

      let success = false;
      let lastError = '';

      if (bestCandidate && bestCandidate.patch) {
        consecutiveInvalidDiffs = 0;
        const diffContent = bestCandidate.patch;

        const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
        const patchPath = await patchStore.saveSelected(stepsCompleted, diffContent);
        patchPaths.push(patchPath);

        // Apply the selected patch
        const result = await executionService.applyPatch(diffContent, step);

        if (result.success) {
          success = true;
          if (result.filesChanged) {
            result.filesChanged.forEach((f) => touchedFiles.add(f));
          }
          consecutiveApplyFailures = 0;
          lastApplyErrorHash = '';

          // Run final verification on applied patch
          const finalVerification = await verificationRunner.run(
            verificationProfile,
            verificationProfile.mode,
            { touchedFiles: result.filesChanged },
            { runId },
          );

          const verificationReportPath = path.join(
            artifacts.root,
            `verification_iter_${stepsCompleted}_final.json`,
          );
          await fs.writeFile(verificationReportPath, JSON.stringify(finalVerification, null, 2));
          l3Metadata.evaluationReportPaths.push(verificationReportPath);

          if (!finalVerification.passed) {
            // Final verification failed - log but continue (patch was applied)
            await eventBus.emit({
              type: 'VerificationFinished',
              schemaVersion: 1,
              timestamp: new Date().toISOString(),
              runId,
              payload: {
                passed: false,
                failedChecks: finalVerification.checks.filter((c) => !c.passed).map((c) => c.name),
              },
            });
          }
        } else {
          lastError = result.error || 'Unknown apply error';
          const errorHash = createHash('sha256').update(lastError).digest('hex');
          if (lastApplyErrorHash === errorHash) {
            consecutiveApplyFailures++;
          } else {
            consecutiveApplyFailures = 1;
            lastApplyErrorHash = errorHash;
          }

          const diagnosisConfig = this.config.l3?.diagnosis;
          const triggerThreshold = diagnosisConfig?.triggerOnRepeatedFailures ?? 2;

          if (diagnosisConfig?.enabled && consecutiveApplyFailures >= triggerThreshold) {
            await eventBus.emit({
              type: 'DiagnosisStarted',
              schemaVersion: 1,
              runId,
              timestamp: new Date().toISOString(),
              payload: {
                iteration: stepsCompleted,
                reason: `Repeated patch apply failure: ${lastError}`,
              },
            });

            const diagnoser = new Diagnoser();
            const diagnosisResult = await diagnoser.diagnose({
              runId,
              goal,
              fusedContext,
              eventBus,
              costTracker: this.costTracker!,
              reasoner: providers.planner,
              artifactsRoot: artifacts.root,
              logger,
              config: this.config,
              iteration: stepsCompleted,
              lastError,
            });

            if (diagnosisResult?.selectedHypothesis) {
              signals.push({
                type: 'diagnosis',
                data: `Diagnosis hypothesis: ${diagnosisResult.selectedHypothesis.hypothesis}`,
              });

              // Re-fuse context with new signal
              fusedContext = fuser.fuse({
                goal: `Goal: ${goal}\nCurrent Step: ${step}`,
                repoPack: contextPack || { items: [], totalChars: 0, estimatedTokens: 0 },
                memoryHits,
                signals,
                budgets: {
                  maxRepoContextChars: (this.config.context?.tokenBudget || 8000) * 4,
                  maxMemoryChars: this.config.memory?.maxChars ?? 2000,
                  maxSignalsChars: 1000,
                },
              });
              stepContext.fusedContext = fusedContext;
            }
            // Reset failure counter
            consecutiveApplyFailures = 0;
          }

          if (consecutiveApplyFailures >= triggerThreshold) {
            return finish(
              'failure',
              'repeated_failure',
              `Repeated patch apply failure: ${lastError}`,
            );
          }
        }
      } else {
        lastError = 'No valid patch generated from candidates';
        consecutiveInvalidDiffs++;
        if (consecutiveInvalidDiffs >= 2) {
          return finish(
            'failure',
            'invalid_output',
            'Executor produced no valid patches twice consecutively',
          );
        }
      }

      if (success) {
        stepsCompleted++;
        await eventBus.emit({
          type: 'StepFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            step,
            success: true,
            ...(judgeInvoked ? { judgeInvoked: true, judgeReason } : {}),
          },
        });
      } else {
        await eventBus.emit({
          type: 'StepFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { step, success: false, error: lastError },
        });

        return finish('failure', 'repeated_failure', `Step failed: ${step}. Error: ${lastError}`);
      }
    }

    return finish('success', undefined, `L3 Plan Executed Successfully. ${stepsCompleted} steps.`);
  }
}
