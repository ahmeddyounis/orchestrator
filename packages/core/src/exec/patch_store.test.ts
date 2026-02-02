import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PatchStore } from './patch_store';
import { MANIFEST_VERSION, Manifest } from '@orchestrator/shared';

describe('PatchStore', () => {
  let tmpDir: string;
  let patchesDir: string;
  let manifestPath: string;
  let store: PatchStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patch-store-test-'));
    patchesDir = path.join(tmpDir, 'patches');
    manifestPath = path.join(tmpDir, 'manifest.json');

    await fs.mkdir(patchesDir, { recursive: true });

    // Create initial manifest
    const manifest: Manifest = {
      schemaVersion: MANIFEST_VERSION,
      runId: 'test-run',
      startedAt: new Date().toISOString(),
      command: 'test',
      repoRoot: tmpDir,
      artifactsDir: tmpDir,
      tracePath: 'trace',
      summaryPath: 'summary',
      effectiveConfigPath: 'config',
      patchPaths: [],
      toolLogPaths: [],
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    store = new PatchStore(patchesDir, manifestPath);
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('saves candidate patch and updates manifest', async () => {
    const patchContent = 'diff --git a/file b/file...';
    const filePath = await store.saveCandidate(1, 0, patchContent);

    expect(path.basename(filePath)).toBe('iter_1_candidate_0.patch');

    const savedContent = await fs.readFile(filePath, 'utf-8');
    expect(savedContent).toBe(patchContent + '\n');

    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: Manifest = JSON.parse(manifestContent);
    expect(manifest.patchPaths).toContain(filePath);
  });

  it('saves selected patch and updates manifest', async () => {
    const patchContent = 'diff --git a/selected b/selected...';
    const filePath = await store.saveSelected(2, patchContent);

    expect(path.basename(filePath)).toBe('iter_2_selected.patch');

    const savedContent = await fs.readFile(filePath, 'utf-8');
    expect(savedContent).toBe(patchContent + '\n');

    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: Manifest = JSON.parse(manifestContent);
    expect(manifest.patchPaths).toContain(filePath);
  });

  it('saves final diff and updates manifest', async () => {
    const patchContent = 'diff --git a/final b/final...';
    const filePath = await store.saveFinalDiff(patchContent);

    expect(path.basename(filePath)).toBe('final.diff.patch');

    const savedContent = await fs.readFile(filePath, 'utf-8');
    expect(savedContent).toBe(patchContent + '\n');

    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: Manifest = JSON.parse(manifestContent);
    expect(manifest.patchPaths).toContain(filePath);
  });

  it('does not duplicate paths in manifest', async () => {
    const patchContent = 'content';
    const path1 = await store.saveCandidate(1, 1, patchContent);
    // Overwrite same file
    const path2 = await store.saveCandidate(1, 1, 'new content');

    expect(path1).toBe(path2);

    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: Manifest = JSON.parse(manifestContent);

    // Should only contain it once
    const matches = manifest.patchPaths.filter((p) => p === path1);
    expect(matches.length).toBe(1);
  });
});
