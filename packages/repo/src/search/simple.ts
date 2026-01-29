import fs from 'node:fs/promises';
import { SearchEngine, SearchOptions, SearchResult, SearchMatch } from './types';
import { RepoScanner } from '../scanner';

export class JsFallbackSearch implements SearchEngine {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async search(options: SearchOptions): Promise<SearchResult> {
    const startTime = Date.now();
    const scanner = new RepoScanner();
    const snapshot = await scanner.scan(options.cwd);

    const matches: SearchMatch[] = [];
    let matchesFound = 0;

    // Create regex from query
    let regex: RegExp;
    try {
      if (options.fixedStrings) {
        // Escape special regex characters
        const escaped = options.query.replace(/[.*+?^${}()|[\\]/g, '\\$&');
        regex = new RegExp(escaped, 'g');
      } else {
        regex = new RegExp(options.query, 'g');
      }
    } catch {
      // Invalid regex
      return {
        matches: [],
        stats: {
          durationMs: Date.now() - startTime,
          matchesFound: 0,
          engine: 'js-fallback',
        },
      };
    }

    // Iterate over text files
    for (const file of snapshot.files) {
      if (!file.isText) continue;

      try {
        const content = await fs.readFile(file.absPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          // Reset regex lastIndex for each line to ensure we find matches
          regex.lastIndex = 0;
          const match = regex.exec(lineText);
          if (match) {
            matches.push({
              path: file.path,
              line: i + 1, // 1-based
              column: match.index + 1, // 1-based
              lineText: lineText,
              matchText: match[0],
            });
            matchesFound++;

            // Optimization: if we have enough matches per file, skip to next file?
            // The spec says "limit per file to maxMatchesPerFile".
            // We can implement that here.
            if (
              options.maxMatchesPerFile &&
              matches.filter((m) => m.path === file.path).length >= options.maxMatchesPerFile
            ) {
              break;
            }
          }
        }
      } catch {
        // ignore read error
      }
    }

    return {
      matches,
      stats: {
        durationMs: Date.now() - startTime,
        matchesFound,
        filesSearched: snapshot.files.length,
        engine: 'js-fallback',
      },
    };
  }
}
