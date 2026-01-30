import { createHash } from 'crypto';
import path from 'path';
import * as fs from 'fs';
import { SafeCommandRunner, RunnerContext, UserInterface } from '@orchestrator/exec';
import {
  ProceduralMemory,
  ProceduralMemoryEntry,
  ProceduralMemoryQuery,
} from '@orchestrator/memory';
import { ToolPolicy } from '@orchestrator/shared';
import {
  ToolchainDetector,
  TargetingManager,
  ToolchainProfile as Toolchain,
} from '@orchestrator/repo';
import {
  VerificationReport,
  VerificationProfile,
  VerificationMode,
  VerificationScope,
  CheckResult,
  FailureSummary,
  CommandSourceInfo,
} from './types';
import { FailureSummarizer } from './summarizer';
import { EventBus } from '../registry';

type CommandTask = 'lint' | 'typecheck' | 'test';
interface CommandToRun {
  name: string;
  command: string;
  timeoutMs?: number;
}

export class VerificationRunner {
  private runner: SafeCommandRunner;

  constructor(
    private memory: ProceduralMemory,
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
    const commandsToRun: CommandToRun[] = [];
    const commandSources: Record<string, CommandSourceInfo> = {};
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
        commandsToRun.push({
          name: step.name,
          command: step.command,
          timeoutMs: step.timeoutMs,
        });
        commandSources[step.name] = { source: 'custom' };
      }
    } else {
      // Auto mode
      const memoryCommands = await this.getCommandsFromMemory();

      const detector = new ToolchainDetector();
      const toolchain = await detector.detect(this.repoRoot);

      const getDetectedCommand = await this.createCommandDetector(toolchain, profile, scope);

      const tasks: { name: CommandTask; enabled: boolean }[] = [
        { name: 'lint', enabled: profile.auto.enableLint },
        { name: 'typecheck', enabled: profile.auto.enableTypecheck },
        { name: 'test', enabled: profile.auto.enableTests },
      ];

      for (const task of tasks) {
        if (!task.enabled) continue;

        const taskName = task.name === 'test' ? 'tests' : task.name;
        let command: string | undefined;
        let sourceInfo: CommandSourceInfo | undefined;

        const memCmd = memoryCommands[task.name];
        if (memCmd) {
          const { isAllowed } = this.runner.checkPolicy(
            { command: memCmd, classification: 'test' },
            this.toolPolicy,
          );
          if (isAllowed) {
            command = memCmd;
            sourceInfo = { source: 'memory' };
          } else {
            sourceInfo = {
              source: 'memory',
              fallbackReason: 'Command from memory was blocked by tool policy.',
            };
          }
        }

        if (!command) {
          const detectedCmd = getDetectedCommand(task.name);
          if (detectedCmd) {
            command = detectedCmd;
            // if sourceInfo is already set, it means memory failed and we are falling back
            if (sourceInfo) {
              sourceInfo.fallbackReason =
                (sourceInfo.fallbackReason ?? '') + ' Falling back to detected command.';
            } else {
              sourceInfo = { source: 'detected' };
            }
          }
        }

        if (command && sourceInfo) {
          commandsToRun.push({ name: taskName, command });
          commandSources[taskName] = sourceInfo;
        }
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
          this.toolPolicy,
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
    await this.saveCommandSources(commandSources, ctx);

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
      commandSources,
    };
  }

  private async createCommandDetector(
    toolchain: Toolchain,
    profile: VerificationProfile,
    scope: VerificationScope,
  ): Promise<(task: CommandTask) => string | undefined> {
    const targeting = new TargetingManager();
    let touchedPackages: Set<string> | null = null;
    if (
      profile.auto.testScope === 'targeted' &&
      scope.touchedFiles &&
      scope.touchedFiles.length > 0
    ) {
      touchedPackages = await targeting.resolveTouchedPackages(this.repoRoot, scope.touchedFiles);
    }

    return (task: CommandTask): string | undefined => {
      if (touchedPackages && touchedPackages.size > 0) {
        const targetedCmd = targeting.generateTargetedCommand(toolchain, touchedPackages, task);
        if (targetedCmd) return targetedCmd;
      }

      if (task === 'lint') return toolchain.commands.lintCmd;
      if (task === 'typecheck') return toolchain.commands.typecheckCmd;
      if (task === 'test') return toolchain.commands.testCmd;
      return undefined;
    };
  }

  private async getCommandsFromMemory(): Promise<Partial<Record<CommandTask, string>>> {
    const queries: ProceduralMemoryQuery[] = [
      { titleContains: 'How to run tests' },
      { titleContains: 'How to run lint' },
      { titleContains: 'How to run typecheck' },
    ];

    const results = await this.memory.find(queries, 1);
    const commands: Partial<Record<CommandTask, string>> = {};

    const findBest = (
      entries: ProceduralMemoryEntry[] | undefined,
    ): ProceduralMemoryEntry | undefined => {
      if (!entries || entries.length === 0) return undefined;
      return entries.sort((a, b) => {
        if (a.stale !== b.stale) return a.stale ? 1 : -1;
        return b.updatedAt - a.updatedAt;
      })[0];
    };

    const testEntry = findBest(results[0]);
    if (testEntry && !testEntry.stale) commands.test = testEntry.content;

    const lintEntry = findBest(results[1]);
    if (lintEntry && !lintEntry.stale) commands.lint = lintEntry.content;

    const typecheckEntry = findBest(results[2]);
    if (typecheckEntry && !typecheckEntry.stale) commands.typecheck = typecheckEntry.content;

    return commands;
  }

  private async saveCommandSources(
    sources: Record<string, CommandSourceInfo>,
    ctx: RunnerContext,
  ): Promise<void> {
    try {
      const runId = ctx.runId;
      const projectRoot = process.cwd();
      const runsDir = path.join(projectRoot, '.orchestrator', 'runs', runId);

      if (!fs.existsSync(runsDir)) {
        await fs.promises.mkdir(runsDir, { recursive: true });
      }

      const jsonPath = path.join(runsDir, 'verification_command_source.json');
      await fs.promises.writeFile(jsonPath, JSON.stringify(sources, null, 2));
    } catch {
      // ignore
    }
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
