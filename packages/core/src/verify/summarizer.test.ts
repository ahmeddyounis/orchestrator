import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { FailureSummarizer } from './summarizer';
import { CheckResult } from './types';

describe('FailureSummarizer', () => {
  let tmpDir: string;
  let summarizer: FailureSummarizer;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'orchestrator-summarizer-test-'));
    summarizer = new FailureSummarizer();
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('should summarize typescript errors', async () => {
    const stderrPath = path.join(tmpDir, 'tsc.stderr');
    const stderrContent = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/utils/helper.ts(5,10): error TS2345: Argument of type 'null' is not assignable to parameter of type 'string'.
    `;
    await fs.promises.writeFile(stderrPath, stderrContent);

    const checks: CheckResult[] = [
      {
        name: 'typecheck',
        command: 'tsc --noEmit',
        exitCode: 1,
        durationMs: 100,
        stdoutPath: '',
        stderrPath: stderrPath,
        passed: false,
        truncated: false,
      },
    ];

    const summary = await summarizer.summarize(checks);

    expect(summary.failedChecks).toHaveLength(1);
    expect(summary.failedChecks[0].name).toBe('typecheck');
    expect(summary.failedChecks[0].keyErrors).toContain("src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(summary.suspectedFiles).toContain('src/index.ts');
    expect(summary.suspectedFiles).toContain('src/utils/helper.ts');
    expect(summary.suggestedNextActions).toContain('Fix TypeScript type errors in the suspected files.');
  });

  it('should summarize eslint errors', async () => {
    const stderrPath = path.join(tmpDir, 'eslint.stderr');
    // ESLint usually prints to stdout, but we handle that in logic. Let's pretend it's in stderr for now or passed via stdoutPath logic if we tested that.
    // The summarizer checks stderrPath then stdoutPath.
    const output = `
/Users/user/project/src/component.tsx:5:10: 'React' is defined but never used.
/Users/user/project/src/api.ts:20:5: Unexpected console statement.
    `;
    await fs.promises.writeFile(stderrPath, output);

    const checks: CheckResult[] = [
      {
        name: 'lint',
        command: 'eslint .',
        exitCode: 1,
        durationMs: 100,
        stdoutPath: '',
        stderrPath: stderrPath,
        passed: false,
        truncated: false,
      },
    ];

    const summary = await summarizer.summarize(checks);

    expect(summary.suspectedFiles).toContain('/Users/user/project/src/component.tsx');
    expect(summary.suspectedFiles).toContain('/Users/user/project/src/api.ts');
    expect(summary.suggestedNextActions).toContain('Fix lint errors in the suspected files.');
  });

  it('should summarize vitest stack traces', async () => {
    const stderrPath = path.join(tmpDir, 'vitest.stderr');
    const output = `
FAIL src/math.test.ts > should add numbers
Error: expected 2 to be 3
    at src/math.test.ts:15:12
    at src/math.ts:5:10
    `;
    await fs.promises.writeFile(stderrPath, output);

    const checks: CheckResult[] = [
      {
        name: 'test',
        command: 'vitest run',
        exitCode: 1,
        durationMs: 100,
        stdoutPath: '',
        stderrPath: stderrPath,
        passed: false,
        truncated: false,
      },
    ];

    const summary = await summarizer.summarize(checks);

    expect(summary.suspectedFiles).toContain('src/math.test.ts');
    expect(summary.suspectedFiles).toContain('src/math.ts');
    expect(summary.suggestedNextActions).toContain('Fix failing tests. Check stack traces in logs.');
  });
});
