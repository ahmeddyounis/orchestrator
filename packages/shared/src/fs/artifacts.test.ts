import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createRunArtifactsDir, getRunArtifactPaths } from './artifacts';

describe('artifacts', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('createRunArtifactsDir creates directory structure', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-test-'));
    const runId = 'test-run-123';

    const paths = await createRunArtifactsDir(tmpDir, runId);

    // Verify directories exist
    const runDirExists = await fs
      .stat(paths.root)
      .then(() => true)
      .catch(() => false);
    const toolLogsDirExists = await fs
      .stat(paths.toolLogs)
      .then(() => true)
      .catch(() => false);

    expect(runDirExists).toBe(true);
    expect(toolLogsDirExists).toBe(true);

    // Verify paths structure
    expect(paths.trace).toBe(path.join(tmpDir, '.orchestrator/runs', runId, 'trace.jsonl'));
  });

  it('getRunArtifactPaths returns correct paths without creating', () => {
    const base = '/tmp/project';
    const runId = 'abc';
    const paths = getRunArtifactPaths(base, runId);

    expect(paths.root).toBe(path.join(base, '.orchestrator/runs', runId));
    expect(paths.trace).toBe(path.join(base, '.orchestrator/runs', runId, 'trace.jsonl'));
  });
});
