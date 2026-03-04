import { Config, JsonlLogger, ToolPolicy } from '@orchestrator/shared';
import { GitService } from '@orchestrator/repo';
import { ProviderRegistry } from './registry';
import { UserInterface } from '@orchestrator/exec';
import type { VerificationReport } from './verify/types';
import path from 'path';
import { CostTracker } from './cost/tracker';
import type { LoadedPlugin } from './plugins/loader';
import { PluginManager } from './plugins/manager';
import { IndexAutoUpdateService } from './indexing/auto_update';
import {
  RunInitializationService,
  ContextBuilderService,
  ContextStackService,
  createRunSession,
  RunMemoryService,
  RunFinalizerService,
  RunSummaryService,
  type RunSession,
} from './orchestrator/services';
import { runL0 as runL0Runner } from './orchestrator/runners/l0';
import { runL1 as runL1Runner, type RunL1Options } from './orchestrator/runners/l1';
import { runL2 as runL2Runner } from './orchestrator/runners/l2';
import { runL3 as runL3Runner, type RunL3Options } from './orchestrator/runners/l3';

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
    checks?: VerificationReport['checks'];
    commandSources?: VerificationReport['commandSources'];
    failureSignature?: VerificationReport['failureSignature'];
    failureSummary?: VerificationReport['failureSummary'];
  };
  lastFailureSignature?: string;
}

export interface RunOptions {
  thinkLevel: 'L0' | 'L1' | 'L2' | 'L3';
  runId?: string;
}

export class Orchestrator {
  private config: Config;
  private git: GitService;
  private readonly registry: ProviderRegistry;
  private repoRoot: string;
  private costTracker?: CostTracker;
  private toolPolicy?: ToolPolicy;
  private ui?: UserInterface;
  private suppressEpisodicMemoryWrite = false;
  private initService: RunInitializationService;
  private contextBuilder: ContextBuilderService;
  private contextStackService: ContextStackService;
  private runMemoryService: RunMemoryService;
  private runFinalizerService: RunFinalizerService;
  private runSummaryService: RunSummaryService;
  private indexAutoUpdate: IndexAutoUpdateService;
  private escalationCount = 0;

  private constructor(
    options: OrchestratorOptions,
    private loadedPlugins: LoadedPlugin[] = [],
  ) {
    this.config = options.config;
    this.git = options.git;
    this.registry = options.registry;
    this.repoRoot = options.repoRoot;
    this.costTracker = options.costTracker;
    this.toolPolicy = options.toolPolicy;
    this.ui = options.ui;
    this.initService = new RunInitializationService(this.config, this.repoRoot);
    this.contextBuilder = new ContextBuilderService(this.config, this.repoRoot);
    this.contextStackService = new ContextStackService(this.config, this.repoRoot);
    this.runMemoryService = new RunMemoryService(this.config, this.repoRoot, this.git);
    this.runSummaryService = new RunSummaryService(this.config, this.repoRoot, {
      costTracker: this.costTracker,
      toolPolicy: this.toolPolicy,
    });
    this.runFinalizerService = new RunFinalizerService(
      this.config,
      this.git,
      this.runSummaryService,
      this.runMemoryService,
    );
    this.indexAutoUpdate = new IndexAutoUpdateService({
      config: this.config,
      repoRoot: this.repoRoot,
    });
  }

  public static async create(options: OrchestratorOptions): Promise<Orchestrator> {
    const logger = new JsonlLogger(
      path.join(options.repoRoot, '.orchestrator', 'logs', 'plugins.jsonl'),
    );
    const pluginManager = new PluginManager(options.config, logger, options.repoRoot);
    const loadedPlugins = await pluginManager.load();
    pluginManager.registerProviderPlugins(options.registry);

    return new Orchestrator(options, loadedPlugins);
  }

  async run(goal: string, options: RunOptions): Promise<RunResult> {
    const runId = options.runId || Date.now().toString();

    if (options.thinkLevel === 'L0') {
      return this.runL0(goal, runId);
    }

    const session = await createRunSession({
      runId,
      goal,
      initService: this.initService,
      contextStackService: this.contextStackService,
    });
    const eventBus = session.contextStack.eventBus;
    this.registry.bindEventBus?.(eventBus, runId);

    await this.indexAutoUpdate.maybeAutoUpdateIndex({ eventBus, runId });

    if (options.thinkLevel === 'L3') {
      return this.runL3(goal, runId, { session });
    }
    if (options.thinkLevel === 'L2') {
      return this.runL2(goal, runId, session);
    }

    return this.runL1(goal, runId, { session });
  }

  async runL0(goal: string, runId: string): Promise<RunResult> {
    return runL0Runner(goal, runId, {
      config: this.config,
      git: this.git,
      registry: this.registry,
      repoRoot: this.repoRoot,
      initService: this.initService,
      contextStackService: this.contextStackService,
      runMemoryService: this.runMemoryService,
      runSummaryService: this.runSummaryService,
      escalationCount: this.escalationCount,
      suppressEpisodicMemoryWrite: this.suppressEpisodicMemoryWrite,
    });
  }

  async runL1(goal: string, runId: string, runnerOptions: RunL1Options = {}): Promise<RunResult> {
    return runL1Runner(
      goal,
      runId,
      {
        config: this.config,
        git: this.git,
        registry: this.registry,
        repoRoot: this.repoRoot,
        costTracker: this.costTracker,
        initService: this.initService,
        contextStackService: this.contextStackService,
        contextBuilder: this.contextBuilder,
        runMemoryService: this.runMemoryService,
        runSummaryService: this.runSummaryService,
        runFinalizerService: this.runFinalizerService,
        escalationCount: this.escalationCount,
        suppressEpisodicMemoryWrite: this.suppressEpisodicMemoryWrite,
      },
      runnerOptions,
    );
  }

  async runL2(goal: string, runId: string, session?: RunSession): Promise<RunResult> {
    return runL2Runner(
      goal,
      runId,
      {
        config: this.config,
        git: this.git,
        registry: this.registry,
        repoRoot: this.repoRoot,
        toolPolicy: this.toolPolicy,
        ui: this.ui,
        initService: this.initService,
        contextStackService: this.contextStackService,
        contextBuilder: this.contextBuilder,
        runMemoryService: this.runMemoryService,
        runSummaryService: this.runSummaryService,
        runFinalizerService: this.runFinalizerService,
        escalationCount: this.escalationCount,
        suppressEpisodicMemoryWrite: this.suppressEpisodicMemoryWrite,
      },
      { session },
    );
  }

  async runL3(goal: string, runId: string, runnerOptions: RunL3Options = {}): Promise<RunResult> {
    return runL3Runner(
      goal,
      runId,
      {
        config: this.config,
        git: this.git,
        registry: this.registry,
        repoRoot: this.repoRoot,
        costTracker: this.costTracker,
        toolPolicy: this.toolPolicy,
        ui: this.ui,
        initService: this.initService,
        contextStackService: this.contextStackService,
        contextBuilder: this.contextBuilder,
        runMemoryService: this.runMemoryService,
        runSummaryService: this.runSummaryService,
        runFinalizerService: this.runFinalizerService,
        escalationCount: this.escalationCount,
        suppressEpisodicMemoryWrite: this.suppressEpisodicMemoryWrite,
      },
      runnerOptions,
    );
  }
}
