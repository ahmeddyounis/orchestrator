import path from 'node:path';
import fs from 'fs-extra';
import { spawn } from 'node:child_process';
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
} from '@orchestrator/shared';
import { findRepoRoot } from '@orchestrator/repo';
import { file_contains, script_exit, verification_pass } from './criteria';

export interface EvalRunnerOptions {
  baseline?: string;
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

  constructor() {
    // constructor
  }

  async runSuite(suitePath: string, options: EvalRunnerOptions): Promise<EvalResult> {
    await this.loadBaselines();

    const suite = await this.loadSuite(suitePath);
    const suiteName = suite.name;
    const startedAt = Date.now();

    const orchestratorTaskResults: EvalTaskResult[] = [];
    for (const task of suite.tasks) {
      const taskResult = await this.runTask(task);
      orchestratorTaskResults.push(taskResult);
    }

    let baselineResult: EvalResult | undefined;
    if (options.baseline) {
      const baselineConfig = this.baselines[options.baseline];
      if (!baselineConfig) {
        throw new Error(`Baseline '${options.baseline}' not found.`);
      }

      const baselineTaskResults: EvalTaskResult[] = [];
      for (const task of suite.tasks) {
        const taskResult = await this.runBaselineTask(task, baselineConfig);
        baselineTaskResults.push(taskResult);
      }
      const baselineFinishedAt = Date.now();
      const baselineAggregates = this.calculateAggregates(
        baselineTaskResults,
        baselineFinishedAt - startedAt,
      );
      baselineResult = {
        schemaVersion: '1',
        suiteName,
        startedAt,
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

    await this.writeAllResults(suiteName, orchestratorResult, baselineResult, comparison);

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
      throw new Error(`Invalid eval suite: ${validationResult.error.message}`);
    }
    return validationResult.data as EvalSuite;
  }

  private async runTask(task: EvalTask): Promise<EvalTaskResult> {
    const startedAt = Date.now();
    const taskId = task.id;
    let workDir: string | undefined;

    try {
      workDir = await this.setupTask(task);
      const { runId, runDir } = await this.executeTask(task, workDir);
      const summary = await this.loadRunSummary(runDir);

      const finishedAt = Date.now();

      const { passed, verificationPassed, results } = await this.evaluateSuccess(
        task.successCriteria,
        summary,
      );

      return {
        taskId,
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
        taskId,
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

    // TODO: Init git repo if needed
    return workDir;
  }

  private async runBaselineTask(
    task: EvalTask,
    baselineConfig: BaselineConfig,
  ): Promise<EvalTaskResult> {
    const startedAt = Date.now();
    const taskId = task.id;
    let workDir: string | undefined;

    try {
      workDir = await this.setupTask(task);
      const { runId, runDir } = await this.executeBaselineTask(task, workDir, baselineConfig);
      const summary = await this.loadRunSummary(runDir);

      const finishedAt = Date.now();

      const { passed, verificationPassed, results } = await this.evaluateSuccess(
        task.successCriteria,
        summary,
      );

      return {
        taskId,
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
        taskId,
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

  private async executeBaselineTask(
    task: EvalTask,
    workDir: string,
    baselineConfig: BaselineConfig,
  ): Promise<{ runId: string; runDir: string }> {
    const repoRoot = await findRepoRoot();
    const cliPath = path.resolve(repoRoot, 'packages/cli/dist/index.js');

    const args: string[] = [
      task.command,
      task.goal,
      '--think',
      baselineConfig.thinkLevel || task.thinkLevel || 'auto',
      `--provider=${baselineConfig.provider}`,
      `--provider-options-model=${baselineConfig.args.model}`,
      '--no-memory',
      '--json',
      '--non-interactive',
    ];

    return new Promise((resolve, reject) => {
      const child = spawn('node', [cliPath, ...args], {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0 && code !== 1) {
          return reject(
            new Error(`Orchestrator CLI failed with code ${code}:
${stderr}`),
          );
        }
        try {
          const output = JSON.parse(stdout);
          const runDir = path.join(workDir, '.orchestrator', 'runs', output.runId);
          resolve({ runId: output.runId, runDir });
        } catch {
          reject(new Error(`Failed to parse CLI output: ${stdout}`));
        }
      });
    });
  }

  private async executeTask(
    task: EvalTask,
    workDir: string,
  ): Promise<{ runId: string; runDir: string }> {
    const repoRoot = await findRepoRoot();
    const cliPath = path.resolve(repoRoot, 'packages/cli/dist/index.js');

    const args: string[] = [
      task.command,
      task.goal,
      '--think',
      task.thinkLevel || 'auto',
      '--json',
      '--non-interactive',
    ];

    return new Promise((resolve, reject) => {
      const child = spawn('node', [cliPath, ...args], {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0 && code !== 1) {
          // 1 can mean failure, which is a valid outcome for an eval
          return reject(
            new Error(`Orchestrator CLI failed with code ${code}:
${stderr}`),
          );
        }
        try {
          // The CLI output should be a JSON object with runId
          const output = JSON.parse(stdout);
          const runDir = path.join(workDir, '.orchestrator', 'runs', output.runId);
          resolve({ runId: output.runId, runDir });
        } catch {
          reject(new Error(`Failed to parse CLI output: ${stdout}`));
        }
      });
    });
  }

  private async loadRunSummary(runDir: string): Promise<RunSummary> {
    const summaryPath = path.join(runDir, 'summary.json');
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
  ): Promise<void> {
    const repoRoot = await findRepoRoot();
    const resultsDir = path.join(
      repoRoot,
      '.orchestrator',
      'eval',
      suiteName,
      String(orchestratorResult.startedAt),
    );
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
  }
}
