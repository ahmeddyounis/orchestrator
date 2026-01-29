import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import { RepoScanner } from './scanner';
import { SearchService } from './search/service';
import { RipgrepSearch } from './search/ripgrep';
import { SnippetExtractor } from './snippets/extractor';
import { SimpleContextPacker } from './context/packer';
import { ContextSignal } from './context/types';

// Resolve fixture path relative to this test file
const FIXTURE_ROOT = path.resolve(__dirname, '__fixtures__/ts-monorepo');

describe('Repo Context Pipeline Integration', () => {
  describe('Scanner', () => {
    it('scans fixture and excludes ignored directories', async () => {
      const scanner = new RepoScanner();
      const snapshot = await scanner.scan(FIXTURE_ROOT);

      const paths = snapshot.files.map((f) => f.path).sort();

      // Should NOT contain node_modules or dist
      expect(paths).not.toContain(expect.stringMatching(/node_modules/));
      expect(paths).not.toContain(expect.stringMatching(/dist/));

      // Should contain source files
      expect(paths).toContain('packages/a/src/index.ts');
      expect(paths).toContain('packages/b/src/util.ts');
      expect(paths).toContain('packages/a/package.json');
      expect(paths).toContain('packages/b/package.json');
      expect(paths).toContain('package.json');
      expect(paths).toContain('tsconfig.json');
      expect(paths).toContain('.gitignore');
    });
  });

  describe('Search & Snippets', () => {
    let searchService: SearchService;
    let snippetExtractor: SnippetExtractor;

    beforeEach(() => {
      searchService = new SearchService();
      snippetExtractor = new SnippetExtractor();
      vi.restoreAllMocks();
    });

    it('searches with JS fallback (rg missing)', async () => {
      vi.spyOn(RipgrepSearch.prototype, 'isAvailable').mockResolvedValue(false);

      const result = await searchService.search({
        cwd: FIXTURE_ROOT,
        query: 'hello',
        caseSensitive: false,
      });

      expect(result.matches.length).toBeGreaterThan(0);

      // Should find usage in index.ts and definition in util.ts
      const files = new Set(result.matches.map((m) => m.path));
      expect(files.has('packages/a/src/index.ts')).toBe(true);
      expect(files.has('packages/b/src/util.ts')).toBe(true);
    });

    it('searches with Ripgrep (rg available)', async () => {
      // Mock rg availability to true, but we might not have rg installed in this environment.
      // If we don't have rg, the actual execution will fail if we don't mock the execution too.
      // However, the SearchService calls `engine.search`.
      // If we want to test the *logic* of choosing rg, we can spy on RipgrepSearch.search.

      const isAvailableSpy = vi
        .spyOn(RipgrepSearch.prototype, 'isAvailable')
        .mockResolvedValue(true);
      const rgSearchSpy = vi.spyOn(RipgrepSearch.prototype, 'search').mockResolvedValue({
        matches: [
          {
            path: 'packages/b/src/util.ts',
            line: 1,
            lineText: "export const hello = () => 'world';",
            matchText: 'hello',
            score: 10,
          },
        ],
        stats: { durationMs: 1, matchedFiles: 1 },
      });

      const result = await searchService.search({
        cwd: FIXTURE_ROOT,
        query: 'hello',
      });

      expect(isAvailableSpy).toHaveBeenCalled();
      expect(rgSearchSpy).toHaveBeenCalled();
      expect(result.matches[0].path).toBe('packages/b/src/util.ts');
    });

    it('extracts snippets from search results', async () => {
      vi.spyOn(RipgrepSearch.prototype, 'isAvailable').mockResolvedValue(false);

      // Use JS search to get real matches
      const searchResult = await searchService.search({
        cwd: FIXTURE_ROOT,
        query: 'secret', // "export const secret = 'hidden';" in util.ts
      });

      const snippets = await snippetExtractor.extractSnippets(searchResult.matches, {
        cwd: FIXTURE_ROOT,
        windowSize: 1,
      });

      expect(snippets).toHaveLength(1);
      const snippet = snippets[0];
      expect(snippet.path).toBe('packages/b/src/util.ts');
      expect(snippet.content).toContain('export const secret');
      // line 3 is where secret is defined (line 1: hello, line 2: empty, line 3: secret)
      // With windowSize 1, it should capture lines around it.
    });
  });

  describe('Packer', () => {
    it('packs context within budget', () => {
      const packer = new SimpleContextPacker();

      const snippets = [
        {
          path: 'a.ts',
          content: 'A'.repeat(100),
          score: 10,
          startLine: 1,
          endLine: 10,
          reason: 'test',
        },
        {
          path: 'b.ts',
          content: 'B'.repeat(100),
          score: 20,
          startLine: 1,
          endLine: 10,
          reason: 'test',
        },
        {
          path: 'c.ts',
          content: 'C'.repeat(100),
          score: 5,
          startLine: 1,
          endLine: 10,
          reason: 'test',
        },
      ];

      // Budget for approx 150 chars (assuming 1 char = 1 char cost for simplicity in test config if possible,
      // but packer uses tokens. charsPerToken default 4.
      // 100 chars = 25 tokens.
      // Total 300 chars = 75 tokens.
      // Limit to 150 chars.
      // Should pick B (score 20).
      // A (score 10) won't fit (needs 100 more, only 50 left).
      // C (score 5) won't fit.

      const pack = packer.pack('goal', [], snippets, {
        tokenBudget: 150,
        charsPerToken: 1, // Simplify calculation
      });

      expect(pack.items).toHaveLength(1);
      expect(pack.items[0].path).toBe('b.ts');
      expect(pack.totalChars).toBe(100);
    });

    it('boosts signals', () => {
      const packer = new SimpleContextPacker();

      const snippets = [
        { path: 'a.ts', content: 'A', score: 10, startLine: 1, endLine: 1, reason: '' },
        { path: 'b.ts', content: 'B', score: 10, startLine: 1, endLine: 1, reason: '' },
      ];

      const signals: ContextSignal[] = [{ type: 'file_change', data: 'a.ts' }];

      // Large budget
      const pack = packer.pack('goal', signals, snippets, { tokenBudget: 100, charsPerToken: 1 });

      const itemA = pack.items.find((i) => i.path === 'a.ts');
      const itemB = pack.items.find((i) => i.path === 'b.ts');

      expect(itemA).toBeDefined();
      expect(itemB).toBeDefined();

      // A should be boosted
      expect(itemA!.score).toBeGreaterThan(itemB!.score);
      expect(itemA!.reason).toContain('Boosted');
    });
  });
});
