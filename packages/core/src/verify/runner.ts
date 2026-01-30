import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import { SafeCommandRunner, RunnerContext, UserInterface } from '@orchestrator/exec';
import { ToolPolicy } from '@orchestrator/shared';
import { ToolchainDetector, TargetingManager } from '@orchestrator/repo';
import {
  VerificationReport,
  VerificationProfile,
  VerificationMode,
  VerificationScope,
  CheckResult,
  FailureSummary,
} from './types';
import { FailureSummarizer } from './summarizer';
import { EventBus } from '../registry';

export class VerificationRunner {
  private runner: SafeCommandRunner;

  constructor(
    private toolPolicy: ToolPolicy,
    private ui: UserInterface,
    private eventBus: EventBus,
    private repoRoot: string,
  ) {
    this.runner = new SafeCommandRunner();
  }

  async run(
    profile: VerificationProfile,
    mode: VerificationMode,
    scope: VerificationScope,
    ctx: RunnerContext,
  ): Promise<VerificationReport> {
    const commandsToRun: Array<{ name: string; command: string; timeoutMs?: number }> = [];
    const runMode = mode === 'custom' ? 'custom' : profile.mode;

    await this.eventBus.emit({
      type: 'VerificationStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { mode: runMode },
    });

    if (runMode === 'custom') {
      for (const step of profile.steps) {
        if (step.required) {
          // TODO: Handle required flag logic if needed, currently treating all steps in list as to-be-run
          commandsToRun.push({
            name: step.name,
            command: step.command,
            timeoutMs: step.timeoutMs,
          });
        }
      }
    } else {
      // Auto mode
      const detector = new ToolchainDetector();
      const targeting = new TargetingManager();
      const toolchain = await detector.detect(this.repoRoot);

      // Determine touched packages if targeting is requested
      let touchedPackages: Set<string> | null = null;
      if (
        profile.auto.testScope === 'targeted' &&
        scope.touchedFiles &&
        scope.touchedFiles.length > 0
      ) {
        touchedPackages = await targeting.resolveTouchedPackages(this.repoRoot, scope.touchedFiles);
      }

      // Helper to select command (targeted -> root fallback)
      const getCommand = (task: 'lint' | 'typecheck' | 'test'): string | undefined => {
        // 1. Try targeted
        if (touchedPackages && touchedPackages.size > 0) {
          const targetedCmd = targeting.generateTargetedCommand(toolchain, touchedPackages, task);
          if (targetedCmd) return targetedCmd;
        }

        // 2. Fallback to root command
        if (task === 'lint') return toolchain.commands.lintCmd;
        if (task === 'typecheck') return toolchain.commands.typecheckCmd;
        if (task === 'test') return toolchain.commands.testCmd;
        return undefined;
      };

      if (profile.auto.enableLint) {
        const cmd = getCommand('lint');
        if (cmd) commandsToRun.push({ name: 'lint', command: cmd });
      }

      if (profile.auto.enableTypecheck) {
        const cmd = getCommand('typecheck');
        if (cmd) commandsToRun.push({ name: 'typecheck', command: cmd });
      }

      if (profile.auto.enableTests) {
        const cmd = getCommand('test');
        if (cmd) commandsToRun.push({ name: 'tests', command: cmd });
      }
    }

    const checkResults: CheckResult[] = [];
    let allPassed = true;

    for (const cmd of commandsToRun) {
      try {
        const result = await this.runner.run(
          {
            command: cmd.command,
            cwd: this.repoRoot,
            reason: `Verification: ${cmd.name}`,
            classification: 'test',
          },
          this.toolPolicy, // Use the injected policy
          this.ui,
          ctx,
        );

        const passed = result.exitCode === 0;
        if (!passed) allPassed = false;

        checkResults.push({
          name: cmd.name,
          command: cmd.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdoutPath: result.stdoutPath,
          stderrPath: result.stderrPath,
          passed,
          truncated: result.truncated,
        });
      } catch {
        // Runner error (policy, timeout, etc.)
        allPassed = false;
        checkResults.push({
          name: cmd.name,
          command: cmd.command,
          exitCode: -1,
          durationMs: 0,
          stdoutPath: '',
          stderrPath: '',
          passed: false,
          truncated: false,
        });
      }
    }

    let failureSignature: string | undefined;
    let failureSummary: FailureSummary | undefined;

    if (!allPassed) {
      failureSignature = await this.generateFailureSignature(checkResults);
      const summarizer = new FailureSummarizer();
      failureSummary = await summarizer.summarize(checkResults);
      await this.saveFailureSummary(failureSummary, ctx);
    }

    const summary = this.generateSummary(checkResults);

    await this.eventBus.emit({
      type: 'VerificationFinished',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: {
        passed: allPassed,
        failedChecks: checkResults.filter((c) => !c.passed).map((c) => c.name),
      },
    });

    return {
      passed: allPassed,
      checks: checkResults,
      summary,
      failureSignature,
      failureSummary,
    };
  }

  private async saveFailureSummary(summary: FailureSummary, ctx: RunnerContext): Promise<void> {
    try {
      // Find run directory
      const runId = ctx.runId;
      // SafeCommandRunner uses process.cwd() for .orchestrator location
      const projectRoot = process.cwd();
      const runsDir = path.join(projectRoot, '.orchestrator', 'runs', runId);

      // Ensure runs dir exists
      if (!fs.existsSync(runsDir)) {
        await fs.promises.mkdir(runsDir, { recursive: true });
      }

      // Determine iteration index
      let iter = 1;
      while (fs.existsSync(path.join(runsDir, `failure_summary_iter_${iter}.json`))) {
        iter++;
      }

      const jsonPath = path.join(runsDir, `failure_summary_iter_${iter}.json`);
      const txtPath = path.join(runsDir, `failure_summary_iter_${iter}.txt`);

      await fs.promises.writeFile(jsonPath, JSON.stringify(summary, null, 2));

      const txtContent =
        `Failure Summary (Iter ${iter})\n` +
        `----------------------------\n` +
        `Failed Checks: ${summary.failedChecks.map((c) => c.name).join(', ')}\n` +
        `Suspected Files:\n${summary.suspectedFiles.map((f) => ' - ' + f).join('\n')}\n` +
        `Suggested Actions:\n${summary.suggestedNextActions.map((a) => ' - ' + a).join('\n')}\n` +
        `\nDetails:\n` +
        summary.failedChecks
          .map(
            (c) =>
              `[${c.name}] Exit Code: ${c.exitCode}\n` + `Errors:\n${c.keyErrors.join('\n')}\n`,
          )
          .join('\n');

      await fs.promises.writeFile(txtPath, txtContent);
    } catch {
      // Ignore errors saving summary, don't fail verification
    }
  }

  private async generateFailureSignature(results: CheckResult[]): Promise<string> {
    const failed = results.filter((r) => !r.passed);
    if (failed.length === 0) return '';

    const parts: string[] = [];

    for (const f of failed) {
      parts.push(`check:${f.name}`);
      // Read tail of stderr
      if (f.stderrPath && fs.existsSync(f.stderrPath)) {
        try {
          // Read last 1KB?
          const stat = await fs.promises.stat(f.stderrPath);
          const size = stat.size;
          const readSize = Math.min(size, 2048);
          const buffer = Buffer.alloc(readSize);
          const handle = await fs.promises.open(f.stderrPath, 'r');
          await handle.read(buffer, 0, readSize, size - readSize);
          await handle.close();
          parts.push(buffer.toString('utf8').trim());
        } catch {
          parts.push('err-read-failed');
        }
      }
    }

    const signatureBase = parts.join('|');
    return createHash('sha256').update(signatureBase).digest('hex');
  }

  private generateSummary(results: CheckResult[]): string {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    return `Verification ${failed === 0 ? 'Passed' : 'Failed'}: ${passed} passed, ${failed} failed.`;
  }
}
