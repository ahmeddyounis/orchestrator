export declare class PatchStore {
  private patchesDir;
  private manifestPath;
  constructor(patchesDir: string, manifestPath: string);
  saveCandidate(iteration: number, candidateIndex: number, content: string): Promise<string>;
  saveSelected(iteration: number, content: string): Promise<string>;
  saveFinalDiff(content: string): Promise<string>;
  private savePatch;
  private updateManifest;
}
//# sourceMappingURL=patch_store.d.ts.map
