import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import { join, isWindows } from '@orchestrator/shared';
import { randomUUID } from 'crypto';
import {
  ToolRunRequest,
  ToolPolicy,
  ToolRunResult,
  ToolError,
  UsageError,
} from '@orchestrator/shared';
import { parseCommand } from '../classify/parser';
import * as classifier from '../classify/classifier';

function killProcessTree(pid: number, signal: NodeJS.Signals | number = 'SIGTERM') {
  if (isWindows()) {
    // On Windows, process.kill is not effective for killing process trees.
    // We use taskkill to forcefully terminate the process and its children.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    // On POSIX systems, sending a signal to the negative PID kills the entire process group.
    // This requires the child process to have been spawned in detached mode.
    try {
      process.kill(-pid, signal);
    } catch {
      // This can fail if the process is already dead, which is fine.
    }
  }
}

// Detects characters that require a shell to interpret.
function isShellCommand(command: string): boolean {
  return /[|&;<>`$]/.test(command);
}

// Minimal env vars that are safe and commonly needed by CLIs.
// Secrets must be explicitly allowlisted via ToolPolicy.envAllowlist.
const BASELINE_ENV_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'COLORTERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'NODE_ENV',
  // Windows
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'HOMEDRIVE',
  'HOMEPATH',
];

function getSafeEnv(
  policy: Pick<ToolPolicy, 'envAllowlist'>,
  baseEnv: NodeJS.ProcessEnv,
  requestEnv?: Record<string, string>,
): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  const combinedEnv = { ...baseEnv, ...requestEnv };

  // Always include PATH for basic command resolution.
  const pathValue = combinedEnv.PATH ?? combinedEnv.Path;
  if (pathValue) {
    safeEnv.PATH = pathValue;
  }

  for (const key of BASELINE_ENV_KEYS) {
    const value = combinedEnv[key];
    if (value === undefined) continue;
    safeEnv[key] = value;
  }

  for (const key of policy.envAllowlist ?? []) {
    const value = combinedEnv[key];
    if (value === undefined) continue;
    safeEnv[key] = value;
  }

  return safeEnv;
}

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
    const isDenied = classifier.matchesDenylist(req.command, policy.denylistPatterns);
    if (isDenied) {
      return {
        isAllowed: false,
        needsConfirmation: false,
        reason: `Command matched denylist pattern: ${req.command}`,
      };
    }

    const isAllowlisted = classifier.matchesAllowlist(req.command, policy.allowlistPrefixes);

    // 3. Network Policy Check
    if (policy.networkPolicy === 'deny' && !isAllowlisted) {
      const parsed = parseCommand(req.command);
      if (
        classifier.isNetworkCommand(parsed) ||
        req.classification === 'install' ||
        req.classification === 'network'
      ) {
        return {
          isAllowed: false,
          needsConfirmation: false,
          reason: `Command requires network access, which is denied by policy: ${req.command}`,
        };
      }
    }

    // 4. Policy Check: Confirmation
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
    const projectRoot = req.cwd || ctx.cwd || process.cwd();
    const normalizedReq: ToolRunRequest = { ...req, cwd: projectRoot };

    // Artifacts paths
    const runsDir = join(projectRoot, '.orchestrator', 'runs', runId, 'tool_logs');
    fs.mkdirSync(runsDir, { recursive: true });

    const stdoutPath = join(runsDir, `${toolRunId}_stdout.log`);
    const stderrPath = join(runsDir, `${toolRunId}_stderr.log`);

    // 5. Run Process
    return this.exec(normalizedReq, policy, stdoutPath, stderrPath);
  }

  protected async exec(
    req: ToolRunRequest,
    policy: ToolPolicy,
    stdoutPath: string,
    stderrPath: string,
  ): Promise<ToolRunResult> {
    // Shell policy enforcement
    const needsShell = isShellCommand(req.command);
    if (needsShell && !policy.allowShell) {
      throw new ToolError(
        `Command requires a shell, which is disallowed by policy: ${req.command}`,
        { details: { reason: 'shell_disallowed' } },
      );
    }

    const useShell = needsShell && policy.allowShell;
    let bin: string;
    let args: string[];

    if (useShell) {
      // When shell is true, spawn receives the command as is.
      // We still parse for metadata, but execution differs.
      bin = req.command;
      args = [];
    } else {
      const parsed = parseCommand(req.command);
      if (!parsed.bin) {
        throw new ToolError(`Could not parse command: ${req.command}`);
      }
      bin = parsed.bin;
      args = parsed.args;
    }

    // Env policy enforcement
    const env = getSafeEnv(policy, process.env, req.env);

    const stdoutStream = fs.createWriteStream(stdoutPath);
    const stderrStream = fs.createWriteStream(stderrPath);

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    // Timer
    const start = Date.now();
    let timeoutTimer: NodeJS.Timeout;

    return new Promise<ToolRunResult>((resolve, reject) => {
      let settled = false;
      const child = spawn(bin, args, {
        cwd: req.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
        detached: true,
      });

      // Timeout handling
      timeoutTimer = setTimeout(() => {
        if (!settled) {
          if (child.pid) {
            killProcessTree(child.pid, 'SIGTERM');
          }

          const partialStdout = fs.readFileSync(stdoutPath, 'utf8').slice(0, 1000);
          const partialStderr = fs.readFileSync(stderrPath, 'utf8').slice(0, 1000);

          reject(
            new ToolError(`Command timed out after ${policy.timeoutMs}ms`, {
              details: { partialStdout, partialStderr },
            }),
          );
        }
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
          if (child.pid) {
            killProcessTree(child.pid, 'SIGTERM');
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
          if (child.pid) {
            killProcessTree(child.pid, 'SIGTERM');
          }
        } else {
          stderrStream.write(chunk);
        }
      });

      child.on('error', (err) => {
        settled = true;
        clearTimeout(timeoutTimer);
        stdoutStream.end();
        stderrStream.end();
        reject(new ToolError(`Failed to start process: ${err.message}`));
      });

      child.on('close', (code) => {
        settled = true;
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
