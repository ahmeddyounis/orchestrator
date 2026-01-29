import * as fs from 'fs/promises';
import * as path from 'path';
import { Manifest, writeManifest } from '@orchestrator/shared';

export class PatchStore {
  constructor(
    private patchesDir: string,
    private manifestPath: string,
  ) {}

  async saveCandidate(iteration: number, candidateIndex: number, content: string): Promise<string> {
    const filename = `iter_${iteration}_candidate_${candidateIndex}.patch`;
    return this.savePatch(filename, content);
  }

  async saveSelected(iteration: number, content: string): Promise<string> {
    const filename = `iter_${iteration}_selected.patch`;
    return this.savePatch(filename, content);
  }

  async saveFinalDiff(content: string): Promise<string> {
    return this.savePatch('final.diff.patch', content);
  }

  private async savePatch(filename: string, content: string): Promise<string> {
    const filePath = path.join(this.patchesDir, filename);
    const contentWithNewline = content.endsWith('\n') ? content : content + '\n';
    await fs.writeFile(filePath, contentWithNewline, 'utf-8');
    await this.updateManifest(filePath);
    return filePath;
  }

  private async updateManifest(patchPath: string): Promise<void> {
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      const manifest: Manifest = JSON.parse(content);

      if (!manifest.patchPaths.includes(patchPath)) {
        manifest.patchPaths.push(patchPath);
        await writeManifest(this.manifestPath, manifest);
      }
    } catch (err) {
      // If manifest doesn't exist or is invalid, we should probably fail
      // as it violates the integrity of the run artifacts.
      throw new Error(
        `Failed to update manifest at ${this.manifestPath}: ${(err as Error).message}`,
      );
    }
  }
}
