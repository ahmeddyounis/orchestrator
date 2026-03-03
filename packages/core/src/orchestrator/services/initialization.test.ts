import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { tmpdir } from 'node:os';
import { ConfigSchema, updateManifest } from '@orchestrator/shared';
import { RunInitializationService } from './initialization';

describe('RunInitializationService.initializeManifest', () => {
  it('is idempotent and backfills context paths', async () => {
    const repoRoot = await fs.mkdtemp(path.join(tmpdir(), 'orchestrator-init-test-'));

    try {
      const config = ConfigSchema.parse({});
      const initService = new RunInitializationService(config, repoRoot);
      const runId = `run-${Date.now()}`;
      const goal = 'test goal';

      const runContext = await initService.initializeRun(runId, goal);
      const { artifacts } = runContext;

      await initService.initializeManifest(artifacts, runId, goal, false);

      const rawBefore = JSON.parse(await fs.readFile(artifacts.manifest, 'utf-8'));
      expect(rawBefore.startedAt).toBeTruthy();
      expect(rawBefore.contextPaths).toEqual([]);

      await updateManifest(artifacts.manifest, (manifest) => {
        manifest.patchPaths = [...(manifest.patchPaths ?? []), 'patches/some.patch'];
      });

      await initService.initializeManifest(artifacts, runId, goal, true);

      const rawAfter = JSON.parse(await fs.readFile(artifacts.manifest, 'utf-8'));
      expect(rawAfter.startedAt).toBe(rawBefore.startedAt);
      expect(rawAfter.patchPaths).toEqual(expect.arrayContaining(['patches/some.patch']));
      expect(rawAfter.contextPaths).toEqual([]);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
