
import { RepoScanner } from '../scanner';
import { Index, IndexFile, IndexStats } from './types';
import { createHash } from 'crypto';
import nodeFs from 'fs';
import nodeFsPromises from 'fs/promises';
import { resolve } from 'path';

type FsPromises = typeof nodeFsPromises;

export interface IndexBuilderOptions {
  maxFileSizeBytes: number;
  fs?: FsPromises;
  fsSync?: typeof nodeFs;
}

export class IndexBuilder {
  private scanner: RepoScanner;
  private options: IndexBuilderOptions;
  private fs: FsPromises;
  private fsSync: typeof nodeFs;

  constructor(options: Partial<IndexBuilderOptions> = {}) {
    this.fs = options.fs || nodeFsPromises;
    this.fsSync = options.fsSync || nodeFs;
    this.scanner = new RepoScanner(this.fs);
    this.options = {
      maxFileSizeBytes: options.maxFileSizeBytes || 1024 * 1024, // 1MB default
    };
  }

  async build(repoRoot: string): Promise<Index> {
    const scanResult = await this.scanner.scan(repoRoot);
    const files: IndexFile[] = [];
    const stats: IndexStats = {
      fileCount: 0,
      textFileCount: 0,
      hashedCount: 0,
      byLanguage: {},
    };

    const sortedFiles = [...scanResult.files].sort((a, b) => a.path.localeCompare(b.path));

    for (const file of sortedFiles) {
      stats.fileCount++;
      if (file.isText) {
        stats.textFileCount++;
        const language = file.languageHint || 'unknown';
        if (!stats.byLanguage[language]) {
          stats.byLanguage[language] = { count: 0, bytes: 0 };
        }
        stats.byLanguage[language].count++;
        stats.byLanguage[language].bytes += file.sizeBytes;

        const fullPath = resolve(repoRoot, file.path);
        const fileStat = await this.fs.stat(fullPath);

        const indexFile: IndexFile = {
          path: file.path,
          sizeBytes: file.sizeBytes,
          mtimeMs: fileStat.mtimeMs,
          isText: file.isText,
          languageHint: file.languageHint,
        };

        if (file.sizeBytes <= this.options.maxFileSizeBytes) {
          indexFile.sha256 = await this.hashFile(fullPath);
          stats.hashedCount++;
        }
        files.push(indexFile);
      } else {
         files.push({
          path: file.path,
          sizeBytes: file.sizeBytes,
          mtimeMs: (await this.fs.stat(resolve(repoRoot, file.path))).mtimeMs,
          isText: file.isText,
        });
      }
    }

    // TODO: get headSha
    const headSha = undefined;

    return {
      version: '1',
      builtAt: new Date(),
      updatedAt: new Date(),
      headSha,
      stats,
      files,
      repoRoot,
    };
  }

  private hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = this.fsSync.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }
}
