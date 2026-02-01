import { EventEmitter } from 'node:events';
import { SearchEngine, SearchOptions, SearchResult, SearchMatch } from './types';
import { RipgrepSearch } from './ripgrep';
import { JsFallbackSearch } from './simple';
import { objectHash } from 'ohash';
import rfdc from 'rfdc';

const deepClone = rfdc();

export class SearchService extends EventEmitter {
  private rg: RipgrepSearch;
  private js: JsFallbackSearch;
  private searchCache: Map<string, SearchResult> = new Map();

  constructor(rgPath?: string) {
    super();
    this.rg = new RipgrepSearch(rgPath);
    this.js = new JsFallbackSearch();
  }

  async search(options: SearchOptions): Promise<SearchResult> {
    const cacheKey = objectHash(options);
    if (this.searchCache.has(cacheKey)) {
      return deepClone(this.searchCache.get(cacheKey)!);
    }

    this.emit('RepoSearchStarted', { options });

    let engine: SearchEngine;
    const rgAvailable = await this.rg.isAvailable();

    if (rgAvailable) {
      engine = this.rg;
    } else {
      engine = this.js;
      this.emit('warn', 'Ripgrep not available, falling back to JS search (slower)');
    }

    const result = await engine.search(options);

    // Post-processing: Deduplication & Limiting per file
    // Note: JS fallback already implements maxMatchesPerFile optimization, but we enforce it here uniformly
    // just in case, and also for `rg` which streams all matches.

    result.matches = this.processMatches(result.matches, options);

    this.emit('RepoSearchFinished', { stats: result.stats });
    
    this.searchCache.set(cacheKey, deepClone(result));
    
    return result;
  }

  private processMatches(matches: SearchMatch[], options: SearchOptions): SearchMatch[] {
    // 1. Ranking
    matches.forEach((m) => {
      m.score = this.calculateScore(m, options);
    });

    // 2. Sort by score (descending)
    matches.sort((a, b) => (b.score || 0) - (a.score || 0));

    // 3. Deduplicate / Group by file and limit
    const processed: SearchMatch[] = [];
    const fileCounts = new Map<string, number>();
    const maxPerFile = options.maxMatchesPerFile ?? 10;

    for (const m of matches) {
      const currentCount = fileCounts.get(m.path) || 0;
      if (currentCount >= maxPerFile) {
        continue;
      }
      fileCounts.set(m.path, currentCount + 1);
      processed.push(m);
    }

    // Sort again by score? They are already sorted.
    // But we might want to group by file in the final output if that was the requirement?
    // "Return ranked, deduplicated matches". Usually global ranking is better.

    return processed;
  }

  private calculateScore(match: SearchMatch, options: SearchOptions): number {
    let score = 10; // Base score

    // Exact line match boost
    // If the entire line is exactly the query
    if (match.lineText.trim() === options.query) {
      score += 20;
    } else if (match.matchText === options.query) {
      // The match text itself is exactly the query (it usually is for literal search),
      // but let's check if it's a distinct word?
      // For now, give a smaller boost if it's just the matchText
      score += 5;
    }

    // Path proximity
    if (options.targetDir && match.path.startsWith(options.targetDir)) {
      score += 15;
    }

    // Shallow path boost (fewer slashes = better)
    // e.g. src/index.ts (1 slash) vs src/utils/helpers/foo.ts (3 slashes)
    // We want to penalize depth slightly.
    const depth = match.path.split('/').length;
    score -= depth * 0.5;

    return score;
  }
}
