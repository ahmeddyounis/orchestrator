import path from 'node:path';
import fs from 'fs-extra';
import {
  type EvalSuite,
  type EvalTask,
  type EvalResult,
  type EvalTaskResult,
  validateEvalSuite,
  type RunSummary,
  type EvalAggregates,
  type EvalComparison,
  type CriterionResult,
  type Config,
  ConfigError,
  UsageError,
  VerificationError,
} from '@orchestrator/shared';
import { findRepoRoot, GitService } from '@orchestrator/repo';
import {
  Orchestrator,
  ProviderRegistry,
  NoopUserInterface,
  AllowAllToolPolicy,
} from '@orchestrator/core';
import { file_contains, script_exit, verification_pass } from './criteria';
import { SimpleRenderer } from './renderer';

export interface EvalRunnerOptions {
  baseline?: string;
}

export interface EvalRunnerConstructorOptions {
  config: Config;
  outputDir: string;
}

interface BaselineConfig {
  provider: string;
  thinkLevel: 'L0' | 'L1' | 'L2' | 'auto';
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
    this.renderer.logSuiteStarted(suiteName);

    const orchestratorTaskResults: EvalTaskResult[] = [];
    for (const [index, task] of suite.tasks.entries()) {
      this.renderer.logTaskStarted(task, index, suite.tasks.length);
      const taskResult = await this.runTask(task);
      orchestratorTaskResults.push(taskResult);
      this.renderer.logTaskFinished(taskResult);
    }

    let baselineResult: EvalResult | undefined;
    if (options.baseline) {
      const baselineConfig = this.baselines[options.baseline];
      if (!baselineConfig) {
        throw new UsageError(`Baseline '${options.baseline}' not found.`);
      }

      const baselineTaskResults: EvalTaskResult[] = [];
      for (const [index, task] of suite.tasks.entries()) {
        this.renderer.logTaskStarted(task, index, suite.tasks.length, true);
        const taskResult = await this.runBaselineTask(task, baselineConfig);
        baselineTaskResults.push(taskResult);
        this.renderer.logTaskFinished(taskResult, true);
      }
      const baselineFinishedAt = Date.now();
      const baselineAggregates = this.calculateAggregates(
        baselineTaskResults,
        baselineFinishedAt - startedAt,
      );
      baselineResult = {
        schemaVersion: '1',
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
      schemaVersion: '1',
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
    this.renderer.logSuiteFinished(orchestratorResult, finalReportPath);

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
    const validationResult = validateEvalSuite(suiteContent);
    if (!validationResult.success) {
      throw new ConfigError(`Invalid eval suite: ${validationResult.error.message}`);
    }
    return validationResult.data as EvalSuite;
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
          iterations: summary.iterations,
          toolRuns: summary.tools?.runs?.length,
          tokens: summary.costs?.totals?.totalTokens,
          estimatedCostUsd: summary.costs?.totals?.estimatedCostUsd,
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
    const workDir = await fs.mkdtemp(path.join(repoRoot, '.tmp', 'eval-'));

    const fixturePath = path.resolve(repoRoot, task.repo.fixturePath);
    await fs.copy(fixturePath, workDir);

    const git = new GitService(workDir);
    await git.init();
    await git.addAll();
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

      const baselineRunConfig = {
        ...this.config,
        thinkLevel: baselineConfig.thinkLevel || this.config.thinkLevel,
        memory: { enabled: false }, // Baselines run without memory
        providers: {
          ...this.config.providers,
          [baselineConfig.provider]: {
            ...this.config.providers?.[baselineConfig.provider],
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
          iterations: summary.iterations,
          toolRuns: summary.tools?.runs?.length,
          tokens: summary.costs?.totals?.totalTokens,
          estimatedCostUsd: summary.costs?.totals?.estimatedCostUsd,
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
    const registry = new ProviderRegistry(config.providers || {});
    const git = new GitService(workDir);

    const orchestrator = new Orchestrator({
      config,
      git,
      registry,
      repoRoot: workDir,
      toolPolicy: new AllowAllToolPolicy(), // Evals run with full tool access
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
