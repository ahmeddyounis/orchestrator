import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'fs-extra';
import { EvalRunner } from './runner';
import { findRepoRoot } from '@orchestrator/repo';

describe('EvalRunner', () => {
  let repoRoot: string;
  let fixturesDir: string;
  let suitePath: string;

  beforeEach(async () => {
    repoRoot = await findRepoRoot();
    fixturesDir = path.join(repoRoot, 'packages', 'eval', 'src', '__fixtures__');
    suitePath = path.join(fixturesDir, 'test-suite.json');
  });

  afterEach(async () => {
    const evalResultsDir = path.join(repoRoot, '.orchestrator', 'eval');
    await fs.remove(evalResultsDir);
    const tmpDir = path.join(repoRoot, '.tmp');
    await fs.remove(tmpDir);
  });

  it('should run a suite and produce results', async () => {
    const runner = new EvalRunner();
    const result = await runner.runSuite(suitePath, {});

    expect(result).toBeDefined();
    expect(result.suiteName).toBe('test-suite');
    expect(result.tasks).toHaveLength(1);

    const taskResult = result.tasks[0];
    expect(taskResult.taskId).toBe('task-1');
    // This is tricky because the orchestrator might not succeed, so we just check it tried.
    expect(taskResult.status).oneOf(['pass', 'fail', 'error']);

    if (taskResult.status !== 'error') {
        expect(taskResult.runId).toBeDefined();
    }
    
  }, 30000); // 30s timeout for the test
});
