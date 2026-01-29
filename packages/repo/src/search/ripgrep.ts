import { spawn } from 'node:child_process';
import { SearchEngine, SearchOptions, SearchResult, SearchMatch } from './types';
import * as readline from 'node:readline';

export class RipgrepSearch implements SearchEngine {
  private _isAvailable: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this._isAvailable !== null) return this._isAvailable;

    try {
      const p = spawn('rg', ['--version']);
      this._isAvailable = await new Promise<boolean>((resolve) => {
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
      });
    } catch {
      this._isAvailable = false;
    }
    return this._isAvailable;
  }

  async search(options: SearchOptions): Promise<SearchResult> {
    const startTime = Date.now();
    const args = ['--json', '--no-heading', '--line-number', '--column', '--max-columns', '200'];

    if (options.fixedStrings) {
      args.push('--fixed-strings');
    }

    // Add query
    args.push(options.query);

    // Add path (cwd is implied to be search root, or we pass it as arg)
    // rg [OPTIONS] PATTERN [PATH ...]
    // We run it in cwd

    // We should probably explicitly ignore .git if not already done by rg defaults (which it usually does)
    // rg respects .gitignore by default.

    const child = spawn('rg', args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const matches: SearchMatch[] = [];
    let matchesCount = 0;

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'match') {
          const data = event.data;
          const filePath = data.path.text;
          const lineText = data.lines.text;
          const lineNumber = data.line_number;

          // rg can return multiple submatches per line, but usually we just care about the line.
          // However, if we want to be precise about the column of the *first* match:
          const firstSubmatch = data.submatches[0];
          const column = firstSubmatch ? firstSubmatch.start : 0;
          const matchText = firstSubmatch ? firstSubmatch.match.text : '';

          // Deduplication handling (maxMatchesPerFile) should happen here or after.
          // Since we want to stream and be fast, maybe post-process?
          // But accumulating everything in memory is fine for typical code search usage (limit 20k matches usually).

          matches.push({
            path: filePath,
            line: lineNumber,
            column: column + 1, // 1-based index usually preferred for editors
            lineText: lineText.trimEnd(), // remove trailing newline
            matchText,
          });
          matchesCount++;
        }
      } catch {
        // ignore parse error
      }
    }

    return new Promise((resolve, reject) => {
      child.on('close', () => {
        resolve({
          matches,
          stats: {
            durationMs: Date.now() - startTime,
            matchesFound: matchesCount,
            engine: 'ripgrep',
          },
        });
      });
      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}
