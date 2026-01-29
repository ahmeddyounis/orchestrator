import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { RepoSnapshot, RepoFileMeta } from './types';
import { isBinaryFile, DEFAULT_IGNORES } from './utils';

export class RepoScanner {
  async scan(repoRoot: string, options: { excludes?: string[] } = {}): Promise<RepoSnapshot> {
    const ig = ignore();

    // 1. Add default ignores
    ig.add(DEFAULT_IGNORES);

    // 2. Add .gitignore
    try {
      const gitignorePath = path.join(repoRoot, '.gitignore');
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      ig.add(gitignoreContent);
    } catch {
      // ignore missing .gitignore
    }

    // 3. Add .orchestratorignore
    try {
      const orchIgnorePath = path.join(repoRoot, '.orchestratorignore');
      const orchIgnoreContent = await fs.readFile(orchIgnorePath, 'utf-8');
      ig.add(orchIgnoreContent);
    } catch {
      // ignore missing .orchestratorignore
    }

    // 4. Add config excludes
    if (options.excludes && options.excludes.length > 0) {
      ig.add(options.excludes);
    }

    const files: RepoFileMeta[] = [];

    // Walker function
    const walk = async (dir: string, relativeDir: string) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        // Access denied or deleted during scan
        return;
      }

      for (const entry of entries) {
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
            stats = await fs.stat(absPath);
          } catch {
            continue; // Skip if stat fails
          }
          const isText = !(await isBinaryFile(absPath));
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

    return {
      repoRoot,
      files,
    };
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
