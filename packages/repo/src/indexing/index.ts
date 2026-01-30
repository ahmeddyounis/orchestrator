import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { Index, IndexReport } from './types';
import { RepoScanner } from '../scanner';
import { Config } from '@orchestrator/shared';

// Default configuration for indexing, can be overridden by user config
const DEFAULT_INDEXING_CONFIG = {
  enabled: false,
  path: '.orchestrator/index/index.json',
  mode: 'on-demand',
  hashAlgorithm: 'sha256',
  maxFileSizeBytes: 2_000_000,
} as const;

export class IndexManager {
  constructor(
    private readonly repoRoot: string,
    private readonly config: Config['indexing'],
  ) {}

  private get indexPath(): string {
    return path.join(this.repoRoot, this.config?.path ?? DEFAULT_INDEXING_CONFIG.path);
  }

  private get repoId(): string {
    return crypto.createHash('sha256').update(this.repoRoot).digest('hex');
  }

  async readIndex(): Promise<Index | null> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      return JSON.parse(content) as Index;
    } catch {
      return null;
    }
  }

  async writeIndex(index: Index): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  async build(): Promise<IndexReport> {
    const scanner = new RepoScanner();
    const snapshot = await scanner.scan(this.repoRoot);
    const now = new Date().toISOString();
    const index: Index = {
      version: 1,
      repoRoot: this.repoRoot,
      repoId: this.repoId,
      createdAt: now,
      updatedAt: now,
      hashAlgorithm: 'sha256',
      files: {},
    };

    let hashedCount = 0;
    const maxFileSizeBytes = this.config?.maxFileSizeBytes ?? DEFAULT_INDEXING_CONFIG.maxFileSizeBytes;

    for (const file of snapshot.files) {
      let hash = '';
      if (file.sizeBytes <= maxFileSizeBytes) {
        const content = await fs.readFile(file.absPath);
        hash = crypto.createHash('sha256').update(content).digest('hex');
        hashedCount++;
      }

      index.files[file.path] = {
        path: file.path,
        hash,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
      };
    }

    await this.writeIndex(index);

    return {
      repoRoot: this.repoRoot,
      repoId: this.repoId,
      indexPath: this.indexPath,
      fileCount: snapshot.files.length,
      hashedCount,
      updatedAt: now,
    };
  }

  async update(): Promise<IndexReport> {
    const existingIndex = await this.readIndex();
    if (!existingIndex) {
      return this.build();
    }

    const scanner = new RepoScanner();
    const snapshot = await scanner.scan(this.repoRoot);
    const now = new Date().toISOString();

    const newIndex: Index = {
      ...existingIndex,
      updatedAt: now,
      files: { ...existingIndex.files },
    };

    const delta = { added: 0, removed: 0, changed: 0 };
    const newFilePaths = new Set(snapshot.files.map((f) => f.path));
    const oldFilePaths = new Set(Object.keys(newIndex.files));
    let hashedCount = 0;
    const maxFileSizeBytes = this.config?.maxFileSizeBytes ?? DEFAULT_INDEXING_CONFIG.maxFileSizeBytes;

    // Removed files
    for (const filePath of oldFilePaths) {
      if (!newFilePaths.has(filePath)) {
        delete newIndex.files[filePath];
        delta.removed++;
      }
    }

    // Added and changed files
    for (const file of snapshot.files) {
      const existingFile = newIndex.files[file.path];
      if (!existingFile) {
        delta.added++;
        // Fallthrough to hash and add
      } else if (file.mtimeMs > existingFile.mtimeMs || file.sizeBytes !== existingFile.sizeBytes) {
        delta.changed++;
        // Fallthrough to hash and update
      } else {
        // Unchanged, just count it if it was hashed
        if (existingFile.hash) {
          hashedCount++;
        }
        continue;
      }

      let hash = '';
      if (file.sizeBytes <= maxFileSizeBytes) {
        const content = await fs.readFile(file.absPath);
        hash = crypto.createHash('sha256').update(content).digest('hex');
        hashedCount++;
      }
      newIndex.files[file.path] = {
        path: file.path,
        hash,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
      };
    }

    await this.writeIndex(newIndex);

    return {
      repoRoot: this.repoRoot,
      repoId: this.repoId,
      indexPath: this.indexPath,
      fileCount: snapshot.files.length,
      hashedCount: hashedCount,
      updatedAt: now,
      delta,
    };
  }

  async status(): Promise<IndexReport | null> {
    const index = await this.readIndex();
    if (!index) {
      return null;
    }
    return {
      repoRoot: this.repoRoot,
      repoId: this.repoId,
      indexPath: this.indexPath,
      fileCount: Object.keys(index.files).length,
      hashedCount: Object.keys(index.files).length,
      updatedAt: index.updatedAt,
    };
  }
}
