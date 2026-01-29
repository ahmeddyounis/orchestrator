import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import { SafeCommandRunner, RunnerContext, UserInterface } from '@orchestrator/exec';
import { ToolPolicy } from '@orchestrator/shared';
import {
  VerificationReport,
  VerificationProfile,
  VerificationMode,
  VerificationScope,
  CheckResult,
} from './types';
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
      const scripts = await this.detectScripts();

      if (profile.auto.enableLint && scripts.lint) {
        commandsToRun.push({ name: 'lint', command: scripts.lint });
      }

      if (profile.auto.enableTypecheck && scripts.typecheck) {
        commandsToRun.push({ name: 'typecheck', command: scripts.typecheck });
      }

      if (profile.auto.enableTests && scripts.test) {
        let testCmd = scripts.test;

        // Simple targeted logic
        if (
          profile.auto.testScope === 'targeted' &&
          scope.touchedFiles &&
          scope.touchedFiles.length > 0
        ) {
          // Heuristic: if command contains vitest or jest, we can append files
          if (testCmd.includes('vitest') || testCmd.includes('jest')) {
            // Filter for test files or source files
            // For now, just pass all touched files that verify
            const relevantFiles = scope.touchedFiles.filter(
              (f) => !f.endsWith('.md') && !f.endsWith('.json') && !f.endsWith('.lock'),
            );

            if (relevantFiles.length > 0) {
              testCmd += ` ${relevantFiles.join(' ')}`;
            }
          }
        }

        commandsToRun.push({ name: 'tests', command: testCmd });
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

        // Fail fast? Spec doesn't strictly say, but usually verification continues to gather full feedback.
        // But if 'lint' fails, maybe we don't care about 'tests'.
        // For now, I'll run all.
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
        // Log error if needed, but the result captures the failure
      }
    }

    const failureSignature = !allPassed
      ? await this.generateFailureSignature(checkResults)
      : undefined;
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
    };
  }

  private async detectScripts(): Promise<{ lint?: string; typecheck?: string; test?: string }> {
    try {
      const pkgPath = path.join(this.repoRoot, 'package.json');
      const content = await fs.promises.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts || {};

      const result: { lint?: string; typecheck?: string; test?: string } = {};

      if (scripts.lint) result.lint = 'npm run lint';
      else if (scripts['lint:fix']) result.lint = 'npm run lint:fix'; // fallback? maybe not safe

      if (scripts.typecheck) result.typecheck = 'npm run typecheck';
      else if (scripts['tsc']) result.typecheck = 'npm run tsc';

      if (scripts.test) result.test = 'npm run test';

      // Heuristics if scripts missing but tools present?
      // For now rely on scripts.

      return result;
    } catch {
      return {};
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
