import type { CriterionEvaluator } from './types';
import { SafeCommandRunner, ToolPolicy, UserInterface } from '@orchestrator/exec';
import { ToolRunRequest } from '@orchestrator/shared';

interface ScriptExitDetails {
  command: string;
  expectedExitCode: number;
}

const evalToolPolicy: ToolPolicy = {
  enabled: true,
  interactive: false, // Never allow interactive prompts during eval
  requireConfirmation: true, // Default to needing confirmation
  autoApprove: false, // Do not auto-approve
  denylistPatterns: [
    'git', // Don't mess with git history
    'npm install', // Avoid installing packages during eval
  ],
  allowlistPrefixes: [
    'ls',
    'cat',
    'grep',
    'node',
    'python',
    'pnpm test',
    'npm run test',
  ],
  timeoutMs: 1000 * 30, // 30s timeout
  maxOutputBytes: 1024 * 1024, // 1MB limit
};

const nonInteractiveUi: UserInterface = {
  confirm: async () => false, // Always deny confirmation
};

export const script_exit: CriterionEvaluator = async (summary, details: ScriptExitDetails) => {
  if (!details?.command || details.expectedExitCode === undefined) {
    return {
      passed: false,
      message: 'Missing command or expectedExitCode for script_exit criterion.',
    };
  }

  const runner = new SafeCommandRunner();
  const request: ToolRunRequest = {
    command: details.command,
    classification: 'readonly', // Assume readonly for safety
    reason: 'Evaluation script',
    cwd: summary.repoRoot,
  };

  const context = {
    runId: summary.runId,
    cwd: summary.repoRoot,
  };

  try {
    const result = await runner.run(request, evalToolPolicy, nonInteractiveUi, context);
    const passed = result.exitCode === details.expectedExitCode;
    return {
      passed,
      message: passed
        ? `Script exited with expected code ${details.expectedExitCode}.`
        : `Script exited with code ${result.exitCode}, expected ${details.expectedExitCode}.`,
      details: {
        exitCode: result.exitCode,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
      },
    };
  } catch (error) {
    return {
      passed: false,
      message: `Failed to run script: ${error.message}`,
      details: { error },
    };
  }
};
