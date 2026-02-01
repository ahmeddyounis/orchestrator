import nodeFs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { RepoSnapshot, RepoFileMeta, ScanOptions } from './types';
import { isBinaryFile, DEFAULT_IGNORES } from './utils';
import { objectHash } from 'ohash';

export * from './types';

type Fs = typeof nodeFs;

export class RepoScanner {
  private fs: Fs;
  private scanCache: Map<string, RepoSnapshot> = new Map();

  constructor(fs: Fs = nodeFs) {
    this.fs = fs;
  }

  async scan(repoRoot: string, options: ScanOptions = {}): Promise<RepoSnapshot> {
    const cacheKey = objectHash({ repoRoot, options });
    if (this.scanCache.has(cacheKey)) {
      return this.scanCache.get(cacheKey)!;
    }

    const ig = ignore();
    const warnings: string[] = [];

    // 1. Add default ignores
    ig.add(DEFAULT_IGNORES);

    // 2. Add .gitignore
    try {
      const gitignorePath = path.join(repoRoot, '.gitignore');
      const gitignoreContent = await this.fs.readFile(gitignorePath, 'utf-8');
      ig.add(gitignoreContent);
    } catch {
      // ignore missing .gitignore
    }

    // 3. Add .orchestratorignore
    try {
      const orchIgnorePath = path.join(repoRoot, '.orchestratorignore');
      const orchIgnoreContent = await this.fs.readFile(orchIgnorePath, 'utf-8');
      ig.add(orchIgnoreContent);
    } catch {
      // ignore missing .orchestratorignore
    }

    // 4. Add config excludes
    if (options.excludes && options.excludes.length > 0) {
      ig.add(options.excludes);
    }

    const files: RepoFileMeta[] = [];
    let stoppedEarly = false;

    // Walker function
    const walk = async (dir: string, relativeDir: string) => {
      if (stoppedEarly) return;
      if (options.maxFiles && files.length >= options.maxFiles) {
        warnings.push(`Stopped scanning early, hit max files limit of ${options.maxFiles}.`);
        stoppedEarly = true;
        return;
      }
      let entries;
      try {
        entries = await this.fs.readdir(dir, { withFileTypes: true });
      } catch {
        // Access denied or deleted during scan
        return;
      }

      for (const entry of entries) {
        if (stoppedEarly) break;
        const entryName = entry.name;
        const entryRelativePath = relativeDir ? path.join(relativeDir, entryName) : entryName;

        if (entry.isDirectory()) {
          // For directories, append slash to match directory patterns in ignore
          if (ig.ignores(entryRelativePath + '/')) continue;

          // Recurse
          await walk(path.join(dir, entryName), entryRelativePath);
        } else if (entry.isFile()) {
          if (ig.ignores(entryRelativePath)) continue;

          const absPath = path.join(dir, entryName);
          let stats;
          try {
            stats = await this.fs.stat(absPath);
          } catch {
            continue; // Skip if stat fails
          }
          if (options.maxFileSize && stats.size > options.maxFileSize) {
            warnings.push(`Skipping large file: ${entryRelativePath} (${stats.size} bytes)`);
            continue;
          }
          const isText = !(await isBinaryFile(absPath, this.fs));
          const ext = path.extname(entryName);

          files.push({
            path: entryRelativePath,
            absPath,
            sizeBytes: stats.size,
            mtimeMs: stats.mtimeMs,
            ext,
            isText,
            languageHint: this.getLanguageHint(ext),
          });
        }
      }
    };

    await walk(repoRoot, '');

    // Sort files for stability (deterministic order)
    files.sort((a, b) => a.path.localeCompare(b.path));

    const snapshot: RepoSnapshot = {
      repoRoot,
      files,
      warnings,
    };
    
    this.scanCache.set(cacheKey, snapshot);
    
    return snapshot;
  }

  private getLanguageHint(ext: string): string | undefined {
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.json': 'json',
      '.md': 'markdown',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.css': 'css',
      '.html': 'html',
      '.sh': 'shell',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.toml': 'toml',
      '.xml': 'xml',
      '.sql': 'sql',
    };
    return map[ext.toLowerCase()];
  }
}
