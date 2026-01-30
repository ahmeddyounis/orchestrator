// packages/shared/src/artifacts/manager.ts

import { MANIFEST_FILENAME, MANIFEST_VERSION, Manifest } from './manifest.js';
import { join, relative } from 'path';
import { atomicWrite, ensureDir } from '../fs/index.js';
import { readJson } from 'fs-extra';

export class ManifestManager {
  private manifest: Manifest;
  private readonly runDir: string;

  private constructor(runDir: string, manifest: Manifest) {
    this.runDir = runDir;
    this.manifest = manifest;
  }

  static async load(runDir: string): Promise<ManifestManager> {
    const manifestPath = join(runDir, MANIFEST_FILENAME);
    let manifest: Manifest;
    try {
      manifest = (await readJson(manifestPath)) as Manifest;
      if (manifest.schemaVersion !== MANIFEST_VERSION) {
        // For now, we'll just overwrite. In the future, we might want to migrate.
        manifest = ManifestManager.init(runDir);
      }
    } catch (e) {
      manifest = ManifestManager.init(runDir);
    }
    return new ManifestManager(runDir, manifest);
  }

  static init(runDir: string): Manifest {
    const now = new Date().toISOString();
    const runId = relative(join(runDir, '..'), runDir);
    const manifest: Manifest = {
      schemaVersion: MANIFEST_VERSION,
      runId,
      runDir,
      createdAt: now,
      updatedAt: now,
      paths: {
        patchesDir: 'patches',
        toolLogsDir: 'tool-logs',
      },
      lists: {
        patchPaths: [],
        toolLogPaths: [],
        contextPaths: [],
        provenancePaths: [],
        verificationPaths: [],
      },
    };
    return manifest;
  }

  addPatch(path: string): void {
    this.manifest.lists.patchPaths.push(this.relative(path));
  }

  addToolLog(path: string): void {
    this.manifest.lists.toolLogPaths.push(this.relative(path));
  }

  addContext(path: string): void {
    this.manifest.lists.contextPaths.push(this.relative(path));
  }

  addProvenance(path: string): void {
    this.manifest.lists.provenancePaths.push(this.relative(path));
  }

  addVerification(path: string): void {
    this.manifest.lists.verificationPaths.push(this.relative(path));
  }

  setPath(key: keyof Manifest['paths'], path: string): void {
    this.manifest.paths[key] = this.relative(path);
  }

  private relative(path: string): string {
    if (!path) return '';
    return relative(this.runDir, path);
  }

  async save(): Promise<void> {
    this.manifest.updatedAt = new Date().toISOString();
    const manifestPath = join(this.runDir, MANIFEST_FILENAME);
    await ensureDir(this.runDir);
    await atomicWrite(manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  getManifest(): Manifest {
    return this.manifest;
  }
}
