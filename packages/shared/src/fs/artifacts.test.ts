import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createRunDir, getRunArtifactPaths, writeManifest, Manifest } from './artifacts';

describe('artifacts', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('createRunDir creates directory structure', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-test-'));
    const runId = 'test-run-123';

    const paths = await createRunDir(tmpDir, runId);

    // Verify directories exist
    const runDirExists = await fs
      .stat(paths.root)
      .then(() => true)
      .catch(() => false);
    const toolLogsDirExists = await fs
      .stat(paths.toolLogsDir)
      .then(() => true)
      .catch(() => false);
    const patchesDirExists = await fs
      .stat(paths.patchesDir)
      .then(() => true)
      .catch(() => false);

    expect(runDirExists).toBe(true);
    expect(toolLogsDirExists).toBe(true);
    expect(patchesDirExists).toBe(true);

    // Verify paths structure
    expect(paths.trace).toBe(path.join(tmpDir, '.orchestrator/runs', runId, 'trace.jsonl'));
    expect(paths.manifest).toBe(path.join(tmpDir, '.orchestrator/runs', runId, 'manifest.json'));
  });

  it('getRunArtifactPaths returns correct paths without creating', () => {
    const base = '/tmp/project';
    const runId = 'abc';
    const paths = getRunArtifactPaths(base, runId);

    expect(paths.root).toBe(path.join(base, '.orchestrator/runs', runId));
    expect(paths.trace).toBe(path.join(base, '.orchestrator/runs', runId, 'trace.jsonl'));
    expect(paths.toolLogsDir).toBe(path.join(base, '.orchestrator/runs', runId, 'tool_logs'));
    expect(paths.patchesDir).toBe(path.join(base, '.orchestrator/runs', runId, 'patches'));
  });

  it('writeManifest writes the manifest file', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-test-'));
    const runId = 'manifest-test';
    const paths = await createRunDir(tmpDir, runId);

    const manifest: Manifest = {
      runId,
      startedAt: new Date().toISOString(),
      command: 'run',
      repoRoot: tmpDir,
      artifactsDir: paths.root,
      tracePath: 'trace.jsonl',
      summaryPath: 'summary.json',
      effectiveConfigPath: 'effective-config.json',
      patchPaths: [],
      toolLogPaths: [],
    };

    await writeManifest(paths.manifest, manifest);

    const content = await fs.readFile(paths.manifest, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed).toEqual(manifest);
  });
});
