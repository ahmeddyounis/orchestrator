import path from "node:path";
import crypto from "node:crypto";
import { type IndexReport } from "./types";
import { RepoScanner } from "../scanner";
import { type Config } from "@orchestrator/shared";
import {
  type IndexFile,
  INDEX_SCHEMA_VERSION,
  loadIndex,
  saveIndexAtomic,
} from "./store";

export * from "./store";

// Default configuration for indexing, can be overridden by user config
const DEFAULT_INDEXING_CONFIG = {
  enabled: false,
  path: ".orchestrator/index/index.json",
  mode: "on-demand",
  hashAlgorithm: "sha256",
  maxFileSizeBytes: 2_000_000,
} as const;

export class IndexManager {
  constructor(
    private readonly repoRoot: string,
    private readonly config: Config["indexing"],
  ) {}

  private get indexPath(): string {
    return path.join(
      this.repoRoot,
      this.config?.path ?? DEFAULT_INDEXING_CONFIG.path,
    );
  }

  private get repoId(): string {
    return crypto.createHash("sha256").update(this.repoRoot).digest("hex");
  }

  async build(): Promise<IndexReport> {
    const scanner = new RepoScanner();
    const snapshot = await scanner.scan(this.repoRoot);
    const now = Date.now();

    const files: IndexFile["files"] = [];
    const stats: IndexFile["stats"] = {
      fileCount: 0,
      textFileCount: 0,
      hashedCount: 0,
      byLanguage: {},
    };

    const maxFileSizeBytes =
      this.config?.maxFileSizeBytes ??
      DEFAULT_INDEXING_CONFIG.maxFileSizeBytes;

    for (const file of snapshot.files) {
      stats.fileCount++;
      if (file.isText) {
        stats.textFileCount++;
      }
      
      let sha256: string | undefined;
      if (file.sizeBytes <= maxFileSizeBytes) {
        stats.hashedCount++;
      }

      files.push({
        path: file.path,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        isText: file.isText,
        languageHint: undefined,
        sha256,
      });
    }

    const index: IndexFile = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      repoRoot: this.repoRoot,
      repoId: this.repoId,
      builtAt: now,
      updatedAt: now,
      files,
      stats,
    };

    saveIndexAtomic(this.indexPath, index);

    return {
      repoRoot: this.repoRoot,
      repoId: this.repoId,
      indexPath: this.indexPath,
      fileCount: stats.fileCount,
      hashedCount: stats.hashedCount,
      updatedAt: new Date(now).toISOString(),
    };
  }

  async update(): Promise<IndexReport> {
    const existingIndex = loadIndex(this.indexPath);
    if (!existingIndex) {
      return this.build();
    }
    // For now, we just rebuild. A more sophisticated update will be implemented later.
    return this.build();
  }

  async status(): Promise<IndexReport | null> {
    const index = loadIndex(this.indexPath);
    if (!index) {
      return null;
    }
    return {
      repoRoot: this.repoRoot,
      repoId: this.repoId,
      indexPath: this.indexPath,
      fileCount: index.stats.fileCount,
      hashedCount: index.stats.hashedCount,
      updatedAt: new Date(index.updatedAt).toISOString(),
    };
  }
}
