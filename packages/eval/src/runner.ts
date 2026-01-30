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
} from '@orchestrator/shared';
import { findRepoRoot } from '@orchestrator/repo';

export class EvalRunner {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor() {}

  async runSuite(
    suitePath: string,
    _options: Record<string, unknown>,
  ): Promise<EvalResult> {
    const suite = await this.loadSuite(suitePath);
    const suiteName = suite.name;
    const startedAt = Date.now();
    const taskResults: EvalTaskResult[] = [];

    for (const task of suite.tasks) {
      const taskResult = await this.runTask(task);
      taskResults.push(taskResult);
    }

    const finishedAt = Date.now();
    const aggregates = this.calculateAggregates(taskResults, finishedAt - startedAt);

    const evalResult: EvalResult = {
      schemaVersion: '1',
      suiteName,
      startedAt,
      finishedAt,
      tasks: taskResults,
      aggregates,
    };

    await this.writeResult(suiteName, evalResult);

    return evalResult;
  }

  private calculateAggregates(
    tasks: EvalTaskResult[],
    totalDurationMs: number,
  ): EvalAggregates {
    const totalTasks = tasks.length;
    const passed = tasks.filter((t) => t.status === 'pass').length;
    const failed = tasks.filter((t) => t.status === 'fail').length;
    const error = tasks.filter((t) => t.status === 'error').length;
    const skipped = tasks.filter((t) => t.status === 'skipped').length;
    const totalCostUsd = tasks.reduce(
      (sum, t) => sum + (t.metrics?.estimatedCostUsd ?? 0),
      0,
    );

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
    };
  }

  private async loadSuite(suitePath: string): Promise<EvalSuite> {
    const suiteContent = await fs.readJson(suitePath);
    const validationResult = validateEvalSuite(suiteContent);
    if (!validationResult.success) {
      throw new Error(
        `Invalid eval suite: ${validationResult.error.message}`,
      );
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

      const { passed, verificationPassed } = this.evaluateSuccess(
        task.successCriteria,
        summary,
        workDir,
      );

      return {
        taskId,
        status: passed ? 'pass' : 'fail',
        runId,
        durationMs: finishedAt - startedAt,
        stopReason: summary.stopReason,
        verificationPassed,
        metrics: {
          iterations: summary.patchStats ? 1 : 0, // Simplified
          toolRuns: summary.tools?.runs?.length,
          tokens: summary.costs?.totals?.totalTokens,
          estimatedCostUsd: summary.costs?.totals?.estimatedCostUsd,
          filesChanged: summary.patchStats?.filesChanged,
          linesChanged:
            (summary.patchStats?.linesAdded ?? 0) +
            (summary.patchStats?.linesDeleted ?? 0),
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
        if (code !== 0 && code !== 1) { // 1 can mean failure, which is a valid outcome for an eval
          return reject(new Error(`Orchestrator CLI failed with code ${code}:
${stderr}`));
        }
        try {
          // The CLI output should be a JSON object with runId
          const output = JSON.parse(stdout);
          const runDir = path.join(workDir, '.orchestrator', 'runs', output.runId);
          resolve({ runId: output.runId, runDir });
        } catch (e) {
          reject(new Error(`Failed to parse CLI output: ${stdout}`));
        }
      });
    });
  }

  private async loadRunSummary(runDir: string): Promise<RunSummary> {
    const summaryPath = path.join(runDir, 'summary.json');
    return fs.readJson(summaryPath);
  }

  private evaluateSuccess(
    criteria: EvalTask['successCriteria'],
    summary: RunSummary,
    workDir: string,
  ): { passed: boolean; verificationPassed?: boolean } {
    if (criteria.type === 'verification_pass') {
      const passed = summary.verification?.passed === true;
      return { passed, verificationPassed: passed };
    }
    if (criteria.type === 'file_contains') {
      const details = criteria.details as { path: string; content: string };
      const filePath = path.join(workDir, details.path);
      if (!fs.existsSync(filePath)) return { passed: false };
      const content = fs.readFileSync(filePath, 'utf-8');
      const passed = content.includes(details.content);
      return { passed };
    }
    if (criteria.type === 'script_exit') {
      // Not implemented yet
      return { passed: false };
    }
    return { passed: false };
  }

  private async writeResult(
    suiteName: string,
    result: EvalResult,
  ): Promise<void> {
    const repoRoot = await findRepoRoot();
    const resultsDir = path.join(
      repoRoot,
      '.orchestrator',
      'eval',
      suiteName,
      String(result.startedAt),
    );
    await fs.ensureDir(resultsDir);
    const resultsPath = path.join(resultsDir, 'results.json');
    await fs.writeJson(resultsPath, result, { spaces: 2 });
  }
}
