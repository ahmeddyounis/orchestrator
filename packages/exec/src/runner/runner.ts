import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  ToolRunRequest,
  ToolPolicy,
  ToolRunResult,
  ToolError,
  UsageError,
} from '@orchestrator/shared';
import { parseCommand } from '../classify/parser';

export interface RunnerContext {
  runId: string;
  toolRunId?: string;
  cwd?: string;
}

export interface UserInterface {
  confirm(message: string, details?: string, defaultNo?: boolean): Promise<boolean>;
}

export class SafeCommandRunner {
  checkPolicy(
    req: Pick<ToolRunRequest, 'command' | 'classification'>,
    policy: ToolPolicy,
  ): { isAllowed: boolean; needsConfirmation: boolean; reason?: string } {
    // 1. Policy Check: Enabled
    if (!policy.enabled) {
      return {
        isAllowed: false,
        needsConfirmation: false,
        reason: 'Tool execution is disabled by policy',
      };
    }

    // 2. Policy Check: Denylist
    const isDenied = policy.denylistPatterns.some((pattern) =>
      new RegExp(pattern).test(req.command),
    );
    if (isDenied) {
      return {
        isAllowed: false,
        needsConfirmation: false,
        reason: `Command matched denylist pattern: ${req.command}`,
      };
    }

    // 3. Policy Check: Confirmation
    const isAllowlisted = policy.allowlistPrefixes.some((prefix) => req.command.startsWith(prefix));

    let needsConfirmation = policy.requireConfirmation;

    if (isAllowlisted) {
      needsConfirmation = false;
    }

    // Force confirmation for destructive commands unless explicitly allowlisted
    if (req.classification === 'destructive' && !isAllowlisted) {
      needsConfirmation = true;
    }

    // Auto-approve overrides confirmation needs (except denylist which is already checked)
    if (policy.autoApprove) {
      needsConfirmation = false;
    }

    return { isAllowed: true, needsConfirmation };
  }

  async run(
    req: ToolRunRequest,
    policy: ToolPolicy,
    ui: UserInterface,
    ctx: RunnerContext,
  ): Promise<ToolRunResult> {
    const policyResult = this.checkPolicy(req, policy);
    if (!policyResult.isAllowed) {
      throw new UsageError(policyResult.reason || 'Command denied by policy');
    }

    if (policyResult.needsConfirmation) {
      // Check for non-interactive mode
      // Corresponds to --non-interactive flag
      if (policy.interactive === false) {
        throw new UsageError(`Command execution denied in non-interactive mode: ${req.command}`);
      }

      const confirmed = await ui.confirm(
        `Execute command: ${req.command}`,
        `Reason: ${req.reason}\nCWD: ${req.cwd || ctx.cwd || process.cwd()}`,
      );
      if (!confirmed) {
        throw new UsageError(`User denied execution of: ${req.command}`);
      }
    }

    // 4. Execution Setup
    const runId = ctx.runId;
    const toolRunId = ctx.toolRunId || randomUUID();
    const projectRoot = process.cwd(); // Assuming root is CWD

    // Artifacts paths
    const runsDir = path.join(projectRoot, '.orchestrator', 'runs', runId, 'tool_logs');
    fs.mkdirSync(runsDir, { recursive: true });

    const stdoutPath = path.join(runsDir, `${toolRunId}_stdout.log`);
    const stderrPath = path.join(runsDir, `${toolRunId}_stderr.log`);

    // 5. Run Process
    return this.exec(req, policy, stdoutPath, stderrPath);
  }

  protected async exec(
    req: ToolRunRequest,
    policy: ToolPolicy,
    stdoutPath: string,
    stderrPath: string,
  ): Promise<ToolRunResult> {
    const parsed = parseCommand(req.command);
    if (!parsed.bin) {
      throw new ToolError(`Could not parse command: ${req.command}`);
    }

    const stdoutStream = fs.createWriteStream(stdoutPath);
    const stderrStream = fs.createWriteStream(stderrPath);

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    // Timer
    const start = Date.now();
    let timeoutTimer: NodeJS.Timeout;

    return new Promise<ToolRunResult>((resolve, reject) => {
      const child = spawn(parsed.bin, parsed.args, {
        cwd: req.cwd,
        env: { ...process.env, ...req.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: true,
      });

      // Timeout handling
      timeoutTimer = setTimeout(() => {
        try {
          if (child.pid) {
            process.kill(-child.pid, 'SIGTERM');
          }
        } catch {
          // Ignore if already dead
        }

        const partialStdout = fs.readFileSync(stdoutPath, 'utf8').slice(0, 1000);
        const partialStderr = fs.readFileSync(stderrPath, 'utf8').slice(0, 1000);

        reject(
          new ToolError(`Command timed out after ${policy.timeoutMs}ms`, {
            details: { partialStdout, partialStderr },
          }),
        );
      }, policy.timeoutMs);

      // Output handling
      child.stdout.on('data', (chunk: Buffer) => {
        if (truncated) return;

        stdoutBytes += chunk.length;
        if (stdoutBytes + stderrBytes > policy.maxOutputBytes) {
          truncated = true;
          stdoutStream.write(
            chunk.slice(
              0,
              Math.max(0, policy.maxOutputBytes - (stdoutBytes - chunk.length) - stderrBytes),
            ),
          );
          stdoutStream.write('\n[Output truncated due to limit]\n');
          // Kill process
          try {
            if (child.pid) {
              process.kill(-child.pid, 'SIGTERM');
            }
          } catch {
            /* ignore */
          }
        } else {
          stdoutStream.write(chunk);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (truncated) return;

        stderrBytes += chunk.length;
        if (stdoutBytes + stderrBytes > policy.maxOutputBytes) {
          truncated = true;
          stderrStream.write(
            chunk.slice(
              0,
              Math.max(0, policy.maxOutputBytes - (stderrBytes - chunk.length) - stdoutBytes),
            ),
          );
          stderrStream.write('\n[Output truncated due to limit]\n');
          // Kill process
          try {
            if (child.pid) {
              process.kill(-child.pid, 'SIGTERM');
            }
          } catch {
            /* ignore */
          }
        } else {
          stderrStream.write(chunk);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        stdoutStream.end();
        stderrStream.end();
        reject(new ToolError(`Failed to start process: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        stdoutStream.end();
        stderrStream.end();

        const durationMs = Date.now() - start;

        resolve({
          exitCode: code ?? -1,
          durationMs,
          stdoutPath,
          stderrPath,
          truncated,
        });
      });
    });
  }
}
