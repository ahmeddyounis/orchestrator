import { promises as fs } from 'fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Thresholds
const MIN_SUCCESS_RATE = 0.9;
const ALLOW_ERRORS = false;

interface EvalResult {
  schemaVersion: number;
  suiteName: string;
  startedAt: number;
  finishedAt: number;
  tasks: Array<{
    taskId: string;
    status: 'pass' | 'fail' | 'error' | 'skipped';
    durationMs: number;
  }>;
  aggregates: {
    totalTasks: number;
    passed: number;
    failed: number;
    error: number;
    skipped: number;
    totalDurationMs: number;
    avgDurationMs: number;
    passRate: number;
  };
}

function getPnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: options?.cwd });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Command terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Command exited with code ${code ?? 'unknown'}`));
        return;
      }

      resolve();
    });
  });
}

async function runCommandCaptureStdout(
  command: string,
  args: string[],
  options?: { cwd?: string; allowedExitCodes?: number[] },
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'], cwd: options?.cwd });

    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Command terminated by signal ${signal}`));
        return;
      }
      const allowedExitCodes = options?.allowedExitCodes ?? [0];
      if (!allowedExitCodes.includes(code ?? -1)) {
        reject(new Error(`Command exited with code ${code ?? 'unknown'}`));
        return;
      }

      resolve(stdout);
    });
  });
}

async function main() {
  console.log('🚀 Starting release check...');

  const repoRoot = path.resolve(__dirname, '..');
  const suitePath = path.join(repoRoot, 'packages/eval/src/suites/golden.suite.json');
  const cliPath = path.join(repoRoot, 'packages/cli/dist/index.js');
  const releaseCheckDir = path.join(repoRoot, '.tmp', 'release-check');
  const configPath = path.join(releaseCheckDir, 'config.yaml');
  const resultsPath = path.join(releaseCheckDir, 'eval-results.json');

  try {
    console.log('Building workspace...');
    await runCommand(getPnpmCommand(), ['build'], { cwd: repoRoot });

    await fs.mkdir(releaseCheckDir, { recursive: true });
    await fs.writeFile(
      configPath,
      `providers:\n  openai:\n    type: fake\n    model: fake-model\n`,
      'utf8',
    );

    console.log(`Running evaluation suite: ${suitePath}`);
    const stdout = await runCommandCaptureStdout(
      process.execPath,
      [cliPath, '--config', configPath, '--json', 'eval', suitePath],
      { cwd: repoRoot, allowedExitCodes: [0, 1] },
    );
    await fs.writeFile(resultsPath, stdout, 'utf8');
  } catch (e) {
    console.error('❌ Evaluation run failed.', e);
    process.exit(1);
  }

  console.log(`✅ Evaluation finished. Parsing results from ${resultsPath}...`);

  let result: EvalResult;
  try {
    const resultsContent = await fs.readFile(resultsPath, 'utf-8');
    result = JSON.parse(resultsContent);
  } catch (e) {
    console.error(`❌ Could not read or parse results file at ${resultsPath}.`, e);
    process.exit(1);
  }

  console.log('🔍 Analyzing results...');

  const { passRate, error: errorCount } = result.aggregates;
  const errors = result.tasks.filter((t) => t.status === 'error');

  let failed = false;

  if (passRate < MIN_SUCCESS_RATE) {
    console.error(
      `❌ FAILED: Pass rate is ${passRate}, which is below the threshold of ${MIN_SUCCESS_RATE}.`,
    );
    failed = true;
  } else {
    console.log(`✅ PASSED: Pass rate is ${passRate}.`);
  }

  if (!ALLOW_ERRORS && errorCount > 0) {
    console.error(`❌ FAILED: Found ${errorCount} tasks with errors.`);
    errors.forEach((t) => console.error(`  - Task ${t.taskId} resulted in an error.`));
    failed = true;
  } else {
    console.log(`✅ PASSED: No tasks with errors.`);
  }

  if (failed) {
    console.error('\n🔥 Release check failed.');
    process.exit(1);
  } else {
    console.log('\n✅ All release checks passed!');
  }
}

main().catch((err) => {
  console.error('An unexpected error occurred:', err);
  process.exit(1);
});
