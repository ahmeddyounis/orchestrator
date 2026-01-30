// packages/shared/src/artifacts/manager.test.ts

import { ManifestManager } from './manager.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'path';
import { remove } from 'fs-extra';
import { readJson } from 'fs-extra';
import { MANIFEST_FILENAME } from './manifest.js';
import { tmpdir } from 'os';

const TEST_RUN_DIR = join(tmpdir(), 'orchestrator-test-run', `${Date.now()}`);

describe('ManifestManager', () => {
  beforeEach(async () => {
    await remove(TEST_RUN_DIR);
  });

  it('should initialize a new manifest if one does not exist', async () => {
    const manager = await ManifestManager.load(TEST_RUN_DIR);
    await manager.save();

    const manifestPath = join(TEST_RUN_DIR, MANIFEST_FILENAME);
    const manifest = await readJson(manifestPath);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.runId).toMatch(/\d+/);
    expect(manifest.runDir).toBe(TEST_RUN_DIR);
    expect(manifest.paths.patchesDir).toBe('patches');
  });

  it('should add a patch path', async () => {
    const manager = await ManifestManager.load(TEST_RUN_DIR);
    manager.addPatch(join(TEST_RUN_DIR, 'patches', 'patch1.diff'));
    await manager.save();

    const manifest = manager.getManifest();
    expect(manifest.lists.patchPaths).toEqual(['patches/patch1.diff']);
  });

  it('should add a tool log path', async () => {
    const manager = await ManifestManager.load(TEST_RUN_DIR);
    manager.addToolLog(join(TEST_RUN_DIR, 'tool-logs', 'log1.log'));
    await manager.save();

    const manifest = manager.getManifest();
    expect(manifest.lists.toolLogPaths).toEqual(['tool-logs/log1.log']);
  });

  it('should set a path', async () => {
    const manager = await ManifestManager.load(TEST_RUN_DIR);
    manager.setPath('summary', join(TEST_RUN_DIR, 'summary.md'));
    await manager.save();

    const manifest = manager.getManifest();
    expect(manifest.paths.summary).toBe('summary.md');
  });

  it('should handle incremental updates', async () => {
    const manager1 = await ManifestManager.load(TEST_RUN_DIR);
    manager1.addPatch(join(TEST_RUN_DIR, 'patches', 'patch1.diff'));
    await manager1.save();

    const manager2 = await ManifestManager.load(TEST_RUN_DIR);
    manager2.addPatch(join(TEST_RUN_DIR, 'patches', 'patch2.diff'));
    await manager2.save();

    const manifest = manager2.getManifest();
    expect(manifest.lists.patchPaths).toEqual(['patches/patch1.diff', 'patches/patch2.diff']);
  });
});
