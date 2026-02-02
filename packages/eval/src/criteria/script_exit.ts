import type { CriterionEvaluator } from './types';
import { SafeCommandRunner, type UserInterface } from '@orchestrator/exec';
import { ToolRunRequest, ToolPolicy } from '@orchestrator/shared';

const evalToolPolicy: ToolPolicy = {
  enabled: true,
  interactive: false, // Never allow interactive prompts during eval
  requireConfirmation: true, // Default to needing confirmation
  autoApprove: false, // Do not auto-approve
  denylistPatterns: [
    'git', // Don't mess with git history
    'npm install', // Avoid installing packages during eval
  ],
  allowlistPrefixes: ['ls', 'cat', 'grep', 'node', 'python', 'pnpm test', 'npm run test'],
  networkPolicy: 'deny',
  envAllowlist: [],
  allowShell: false,
  timeoutMs: 1000 * 30, // 30s timeout
  maxOutputBytes: 1024 * 1024, // 1MB limit
};

const nonInteractiveUi: UserInterface = {
  confirm: async () => false, // Always deny confirmation
};

export const script_exit: CriterionEvaluator = async (summary, details) => {
  if (!details || typeof details !== 'object') {
    return {
      passed: false,
      message: 'Missing command or expectedExitCode for script_exit criterion.',
    };
  }

  const d = details as Record<string, unknown>;
  const command = d.command;
  const expectedExitCode = d.expectedExitCode;

  if (typeof command !== 'string' || typeof expectedExitCode !== 'number') {
    return {
      passed: false,
      message: 'Missing command or expectedExitCode for script_exit criterion.',
    };
  }

  const runner = new SafeCommandRunner();
  const request: ToolRunRequest = {
    command,
    classification: 'read_only', // Assume read-only for safety
    reason: 'Evaluation script',
    cwd: summary.repoRoot,
  };

  const context = {
    runId: summary.runId,
    cwd: summary.repoRoot,
  };

  try {
    const result = await runner.run(request, evalToolPolicy, nonInteractiveUi, context);
    const passed = result.exitCode === expectedExitCode;
    return {
      passed,
      message: passed
        ? `Script exited with expected code ${expectedExitCode}.`
        : `Script exited with code ${result.exitCode}, expected ${expectedExitCode}.`,
      details: {
        exitCode: result.exitCode,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      message: `Failed to run script: ${message}`,
      details: { error },
    };
  }
};
