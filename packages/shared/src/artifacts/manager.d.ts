import { Manifest } from './manifest.js';
export declare class ManifestManager {
  private manifest;
  private readonly runDir;
  private constructor();
  static load(runDir: string): Promise<ManifestManager>;
  static init(runDir: string): Manifest;
  addPatch(path: string): void;
  addToolLog(path: string): void;
  addContext(path: string): void;
  addProvenance(path: string): void;
  addVerification(path: string): void;
  setPath(key: keyof Manifest['paths'], path: string): void;
  private relative;
  save(): Promise<void>;
  getManifest(): Manifest;
}
//# sourceMappingURL=manager.d.ts.map
