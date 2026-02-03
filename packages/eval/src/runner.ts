import path from 'node:path';
import fs from 'fs-extra';
import { spawn } from 'node:child_process';
import {
  type EvalSuite,
  type EvalTask,
  type EvalResult,
  type EvalTaskResult,
  validateEvalSuite,
  EVAL_SCHEMA_VERSION,
  type RunSummary,
  type EvalAggregates,
  type EvalComparison,
  type CriterionResult,
  type Config,
  type ProviderConfig,
  ConfigError,
  UsageError,
  VerificationError,
} from '@orchestrator/shared';
import { findRepoRoot, GitService } from '@orchestrator/repo';
import {
  Orchestrator,
  ProviderRegistry,
  NoopUserInterface,
  allowAllToolPolicy,
  CostTracker,
} from '@orchestrator/core';
import {
  OpenAIAdapter,
  AnthropicAdapter,
  ClaudeCodeAdapter,
  GeminiCliAdapter,
  FakeAdapter,
  SubprocessProviderAdapter,
} from '@orchestrator/adapters';
import { file_contains, script_exit, verification_pass } from './criteria';
import { SimpleRenderer } from './renderer';

export interface EvalRunnerOptions {
  baseline?: string;
  quiet?: boolean;
}

export interface EvalRunnerConstructorOptions {
  config: Config;
  outputDir: string;
}

interface BaselineConfig {
  provider: string;
  thinkLevel: Config['thinkLevel'];
  args: {
    model: string;
  };
}

export class EvalRunner {
  private baselines: Record<string, BaselineConfig> = {};
  private config: Config;
  private outputDir: string;
  private renderer: SimpleRenderer;

  constructor(options: EvalRunnerConstructorOptions) {
    this.config = options.config;
    this.outputDir = options.outputDir;
    this.renderer = new SimpleRenderer();
  }

  async runSuite(suitePath: string, options: EvalRunnerOptions): Promise<EvalResult> {
    await this.loadBaselines();

    const suite = await this.loadSuite(suitePath);
    const suiteName = suite.name;
    const startedAt = Date.now();
    const quiet = options.quiet ?? false;
    if (!quiet) {
      this.renderer.logSuiteStarted(suiteName);
    }

    const orchestratorTaskResults: EvalTaskResult[] = [];
    for (const [index, task] of suite.tasks.entries()) {
      if (!quiet) {
        this.renderer.logTaskStarted(task, index, suite.tasks.length);
      }
      const taskResult = await this.runTask(task);
      orchestratorTaskResults.push(taskResult);
      if (!quiet) {
        this.renderer.logTaskFinished(taskResult);
      }
    }

    let baselineResult: EvalResult | undefined;
    if (options.baseline) {
      const baselineConfig = this.baselines[options.baseline];
      if (!baselineConfig) {
        throw new UsageError(`Baseline '${options.baseline}' not found.`);
      }

      const baselineTaskResults: EvalTaskResult[] = [];
      for (const [index, task] of suite.tasks.entries()) {
        if (!quiet) {
          this.renderer.logTaskStarted(task, index, suite.tasks.length, true);
        }
        const taskResult = await this.runBaselineTask(task, baselineConfig);
        baselineTaskResults.push(taskResult);
        if (!quiet) {
          this.renderer.logTaskFinished(taskResult, true);
        }
      }
      const baselineFinishedAt = Date.now();
      const baselineAggregates = this.calculateAggregates(
        baselineTaskResults,
        baselineFinishedAt - startedAt,
      );
      baselineResult = {
        schemaVersion: EVAL_SCHEMA_VERSION,
        suiteName,
        startedAt: startedAt,
        finishedAt: baselineFinishedAt,
        tasks: baselineTaskResults,
        aggregates: baselineAggregates,
      };
    }

    const finishedAt = Date.now();
    const orchestratorAggregates = this.calculateAggregates(
      orchestratorTaskResults,
      finishedAt - startedAt,
    );

    const orchestratorResult: EvalResult = {
      schemaVersion: EVAL_SCHEMA_VERSION,
      suiteName,
      startedAt,
      finishedAt,
      tasks: orchestratorTaskResults,
      aggregates: orchestratorAggregates,
    };

    let comparison: EvalComparison | undefined;
    if (baselineResult) {
      comparison = this.compareAggregates(orchestratorResult.aggregates, baselineResult.aggregates);
    }

    const finalReportPath = await this.writeAllResults(
      suiteName,
      orchestratorResult,
      baselineResult,
      comparison,
    );
    if (!quiet) {
      this.renderer.logSuiteFinished(orchestratorResult, finalReportPath);
    }

    return orchestratorResult;
  }

  private compareAggregates(
    orchestrator: EvalAggregates,
    baseline: EvalAggregates,
  ): EvalComparison {
    return {
      passRateDelta: orchestrator.passRate - baseline.passRate,
      avgDurationDelta: orchestrator.avgDurationMs - baseline.avgDurationMs,
      totalCostDelta: (orchestrator.totalCostUsd ?? 0) - (baseline.totalCostUsd ?? 0),
    };
  }

  private async loadBaselines(): Promise<void> {
    const repoRoot = await findRepoRoot();
    const baselinesPath = path.join(repoRoot, 'packages/eval/src/baselines.json');
    if (await fs.pathExists(baselinesPath)) {
      this.baselines = await fs.readJson(baselinesPath);
    }
  }

  private calculateAggregates(tasks: EvalTaskResult[], totalDurationMs: number): EvalAggregates {
    const totalTasks = tasks.length;
    const passed = tasks.filter((t) => t.status === 'pass').length;
    const failed = tasks.filter((t) => t.status === 'fail').length;
    const error = tasks.filter((t) => t.status === 'error').length;
    const skipped = tasks.filter((t) => t.status === 'skipped').length;
    const totalCostUsd = tasks.reduce((sum, t) => sum + (t.metrics?.estimatedCostUsd ?? 0), 0);
    const totalIterations = tasks.reduce((sum, t) => sum + (t.metrics?.iterations ?? 0), 0);
    const totalToolRuns = tasks.reduce((sum, t) => sum + (t.metrics?.toolRuns ?? 0), 0);

    return {
      totalTasks,
      passed,
      failed,
      error,
      skipped,
      totalDurationMs,
      totalCostUsd,
      avgDurationMs: totalTasks > 0 ? totalDurationMs / totalTasks : 0,
      passRate: totalTasks > 0 ? passed / totalTasks : 0,
      avgIterations: totalTasks > 0 ? totalIterations / totalTasks : 0,
      avgToolRuns: totalTasks > 0 ? totalToolRuns / totalTasks : 0,
      avgCostUsd: totalTasks > 0 ? totalCostUsd / totalTasks : 0,
    };
  }

  private async loadSuite(suitePath: string): Promise<EvalSuite> {
    const suiteContent = await fs.readJson(suitePath);
    try {
      return validateEvalSuite(suiteContent);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigError(`Invalid eval suite: ${message}`);
    }
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd });
      let stderr = '';

      child.stderr.on('data', (d) => {
        stderr += String(d);
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `${command} ${args.join(' ')} failed with code ${code}: ${stderr.trim() || '(no stderr)'}`,
          ),
        );
      });
    });
  }

  private async initGitRepo(repoRoot: string): Promise<void> {
    await this.runCommand('git', ['init'], repoRoot);
    // Ensure commits work in ephemeral temp directories regardless of global git config.
    await this.runCommand('git', ['config', 'user.email', 'eval@orchestrator.local'], repoRoot);
    await this.runCommand('git', ['config', 'user.name', 'Orchestrator Eval Runner'], repoRoot);
    await this.runCommand('git', ['config', 'commit.gpgsign', 'false'], repoRoot);
    await this.runCommand('git', ['config', 'core.hooksPath', '.git/hooks'], repoRoot);
  }

  private async runTask(task: EvalTask): Promise<EvalTaskResult> {
    const startedAt = Date.now();
    let workDir: string | undefined;

    try {
      workDir = await this.setupTask(task);
      const { runId, runDir, summary } = await this.executeTask(task, workDir, this.config);
      const finishedAt = Date.now();

      const { passed, verificationPassed, results } = await this.evaluateSuccess(
        task.successCriteria,
        summary,
      );

      return {
        taskId: task.id,
        status: passed ? 'pass' : 'fail',
        runId,
        durationMs: finishedAt - startedAt,
        stopReason: summary.stopReason,
        verificationPassed,
        criteria: results,
        metrics: {
          toolRuns: summary.tools?.runs?.length,
          tokens: summary.costs?.totals?.totalTokens,
          estimatedCostUsd: summary.costs?.totals?.estimatedCostUsd ?? undefined,
          filesChanged: summary.patchStats?.filesChanged,
          linesChanged:
            (summary.patchStats?.linesAdded ?? 0) + (summary.patchStats?.linesDeleted ?? 0),
        },
        artifacts: {
          runDir: runDir,
          summaryPath: path.join(runDir, 'summary.json'),
          finalDiffPath: summary.patchStats?.finalDiffPath,
        },
      };
    } catch (e) {
      const finishedAt = Date.now();
      return {
        taskId: task.id,
        status: 'error',
        durationMs: finishedAt - startedAt,
        failure: {
          kind: 'eval_error',
          message: e instanceof Error ? e.message : String(e),
        },
      };
    } finally {
      if (workDir) {
        await fs.remove(workDir);
      }
    }
  }

  private async setupTask(task: EvalTask): Promise<string> {
    const repoRoot = await findRepoRoot();
    const tmpRoot = path.join(repoRoot, '.tmp');
    await fs.ensureDir(tmpRoot);
    const workDir = await fs.mkdtemp(path.join(tmpRoot, 'eval-'));

    const fixturePath = path.resolve(repoRoot, task.repo.fixturePath);
    await fs.copy(fixturePath, workDir);
    // Fixtures may include .git/.orchestrator from prior runs. Ensure we start from a clean repo.
    await fs.remove(path.join(workDir, '.git'));
    await fs.remove(path.join(workDir, '.orchestrator'));

    await this.initGitRepo(workDir);

    const git = new GitService({ repoRoot: workDir });
    await git.stageAll();
    await git.commit('Initial commit');

    return workDir;
  }

  private async runBaselineTask(
    task: EvalTask,
    baselineConfig: BaselineConfig,
  ): Promise<EvalTaskResult> {
    const startedAt = Date.now();
    let workDir: string | undefined;

    try {
      workDir = await this.setupTask(task);

      const baseProvider = this.config.providers?.[baselineConfig.provider];
      if (!baseProvider) {
        throw new ConfigError(
          `Baseline provider '${baselineConfig.provider}' not found in config.providers.`,
        );
      }

      const baselineRunConfig: Config = {
        ...this.config,
        thinkLevel: baselineConfig.thinkLevel ?? this.config.thinkLevel,
        memory: { ...this.config.memory, enabled: false }, // Baselines run without memory
        providers: {
          ...(this.config.providers ?? {}),
          [baselineConfig.provider]: {
            ...baseProvider,
            model: baselineConfig.args.model,
          },
        },
        defaults: {
          ...this.config.defaults,
          planner: baselineConfig.provider,
          executor: baselineConfig.provider,
          reviewer: baselineConfig.provider,
        },
      };

      const { runId, runDir, summary } = await this.executeTask(task, workDir, baselineRunConfig);
      const finishedAt = Date.now();

      const { passed, verificationPassed, results } = await this.evaluateSuccess(
        task.successCriteria,
        summary,
      );

      return {
        taskId: task.id,
        status: passed ? 'pass' : 'fail',
        runId,
        durationMs: finishedAt - startedAt,
        stopReason: summary.stopReason,
        verificationPassed,
        criteria: results,
        metrics: {
          toolRuns: summary.tools?.runs?.length,
          tokens: summary.costs?.totals?.totalTokens,
          estimatedCostUsd: summary.costs?.totals?.estimatedCostUsd ?? undefined,
          filesChanged: summary.patchStats?.filesChanged,
          linesChanged:
            (summary.patchStats?.linesAdded ?? 0) + (summary.patchStats?.linesDeleted ?? 0),
        },
        artifacts: {
          runDir: runDir,
          summaryPath: path.join(runDir, 'summary.json'),
          finalDiffPath: summary.patchStats?.finalDiffPath,
        },
      };
    } catch (e) {
      const finishedAt = Date.now();
      return {
        taskId: task.id,
        status: 'error',
        durationMs: finishedAt - startedAt,
        failure: {
          kind: 'eval_error',
          message: e instanceof Error ? e.message : String(e),
        },
      };
    } finally {
      if (workDir) {
        await fs.remove(workDir);
      }
    }
  }

  private async executeTask(
    task: EvalTask,
    workDir: string,
    config: Config,
  ): Promise<{ runId: string; runDir: string; summary: RunSummary }> {
    const costTracker = new CostTracker(config);
    const registry = new ProviderRegistry(config, costTracker);

    registry.registerFactory('openai', (cfg: ProviderConfig) => new OpenAIAdapter(cfg));
    registry.registerFactory('anthropic', (cfg: ProviderConfig) => new AnthropicAdapter(cfg));
    registry.registerFactory('claude_code', (cfg: ProviderConfig) => new ClaudeCodeAdapter(cfg));
    registry.registerFactory('gemini_cli', (cfg: ProviderConfig) => new GeminiCliAdapter(cfg));
    registry.registerFactory('fake', (cfg: ProviderConfig) => new FakeAdapter(cfg));
    registry.registerFactory('subprocess', (cfg: ProviderConfig) => {
      if (!cfg.command) {
        throw new ConfigError(`Provider type 'subprocess' requires 'command' in config.`);
      }
      return new SubprocessProviderAdapter({
        command: [cfg.command, ...(cfg.args ?? [])],
        cwdMode: cfg.cwdMode,
        envAllowlist: cfg.env,
      });
    });

    const git = new GitService({ repoRoot: workDir });

    const orchestrator = await Orchestrator.create({
      config,
      git,
      registry,
      repoRoot: workDir,
      costTracker,
      toolPolicy: allowAllToolPolicy(), // Evals run with full tool access
      ui: new NoopUserInterface(), // Evals are non-interactive
    });

    const thinkLevel = task.thinkLevel === 'auto' ? 'L1' : task.thinkLevel || 'L1';

    if (task.command !== 'run') {
      throw new UsageError(`Eval task command '${task.command}' not yet supported.`);
    }

    const result = await orchestrator.run(task.goal, { thinkLevel });

    const runDir = path.join(workDir, '.orchestrator', 'runs', result.runId);
    const summary = await this.loadRunSummary(runDir);

    return { runId: result.runId, runDir, summary };
  }

  private async loadRunSummary(runDir: string): Promise<RunSummary> {
    const summaryPath = path.join(runDir, 'summary.json');
    if (!(await fs.pathExists(summaryPath))) {
      throw new VerificationError(`summary.json not found in ${runDir}`);
    }
    return fs.readJson(summaryPath);
  }

  private async evaluateSuccess(
    criteria: EvalTask['successCriteria'],
    summary: RunSummary,
  ): Promise<{
    passed: boolean;
    verificationPassed?: boolean;
    results: EvalTaskResult['criteria'];
  }> {
    const evaluators = {
      verification_pass,
      file_contains,
      script_exit,
    };

    const results: EvalTaskResult['criteria'] = [];
    let allPassed = true;
    let verificationPassed: boolean | undefined;

    for (const criterion of criteria) {
      const evaluator = evaluators[criterion.name];
      if (!evaluator) {
        const result: CriterionResult = {
          passed: false,
          message: `Unknown criterion type: ${criterion.name}`,
        };
        results.push({ criterion, result });
        allPassed = false;
        continue;
      }

      const result = await evaluator(summary, criterion.details);
      results.push({ criterion, result });
      if (!result.passed) {
        allPassed = false;
      }
      if (criterion.name === 'verification_pass') {
        verificationPassed = result.passed;
      }
    }

    return { passed: allPassed, verificationPassed, results };
  }

  private async writeAllResults(
    suiteName: string,
    orchestratorResult: EvalResult,
    baselineResult?: EvalResult,
    comparison?: EvalComparison,
  ): Promise<string> {
    const resultsDir = path.join(this.outputDir, suiteName, String(orchestratorResult.startedAt));
    await fs.ensureDir(resultsDir);

    const orchestratorResultsPath = path.join(resultsDir, 'results_orchestrator.json');
    await fs.writeJson(orchestratorResultsPath, orchestratorResult, {
      spaces: 2,
    });

    if (baselineResult) {
      const baselineResultsPath = path.join(resultsDir, 'results_baseline.json');
      await fs.writeJson(baselineResultsPath, baselineResult, { spaces: 2 });
    }

    if (comparison) {
      const comparisonPath = path.join(resultsDir, 'comparison.json');
      await fs.writeJson(comparisonPath, comparison, { spaces: 2 });
    }

    const summaryReport = {
      suite: suiteName,
      status:
        orchestratorResult.aggregates.failed > 0 || orchestratorResult.aggregates.error > 0
          ? 'FAIL'
          : 'PASS',
      aggregates: orchestratorResult.aggregates,
      comparison,
    };

    const finalReportPath = path.join(resultsDir, 'summary.json');
    await fs.writeJson(finalReportPath, summaryReport, { spaces: 2 });

    return finalReportPath;
  }
}
