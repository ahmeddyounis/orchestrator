import fs from 'node:fs/promises';
import { SearchEngine, SearchOptions, SearchResult, SearchMatch } from './types';
import { RepoScanner } from '../scanner';

export class JsFallbackSearch implements SearchEngine {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async search(options: SearchOptions): Promise<SearchResult> {
    const startTime = Date.now();
    if (options.query.trim().length === 0) {
      return {
        matches: [],
        stats: {
          durationMs: Date.now() - startTime,
          matchesFound: 0,
          engine: 'js-fallback',
        },
      };
    }
    const scanner = new RepoScanner();
    const snapshot = await scanner.scan(options.cwd);

    const matches: SearchMatch[] = [];
    let matchesFound = 0;
    
    // Counter map to track matches per file (avoids O(n²) filtering)
    const matchesPerFile = new Map<string, number>();

    // JS fallback intentionally performs *fixed string* search for safety.
    // Regex search is delegated to ripgrep when available.
    const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');

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
            // Check if we've hit the per-file limit before adding
            const currentFileMatches = matchesPerFile.get(file.path) ?? 0;
            if (
              options.maxMatchesPerFile &&
              currentFileMatches >= options.maxMatchesPerFile
            ) {
              break;
            }
            matches.push({
              path: file.path,
              line: i + 1, // 1-based
              column: match.index + 1, // 1-based
              lineText: lineText,
              matchText: match[0],
            });
            matchesFound++;
            
            // Update the counter map
            matchesPerFile.set(file.path, currentFileMatches + 1);
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
