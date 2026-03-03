import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const { mockRepoSearch } = vi.hoisted(() => ({
  mockRepoSearch: vi.fn(),
}));

vi.mock('@orchestrator/repo', () => ({
  findRepoRoot: vi.fn().mockResolvedValue('/fake/repo/root'),
  SearchService: class MockSearchService {
    search = mockRepoSearch;
  },
  SemanticIndexStore: vi.fn(),
  SemanticSearchService: vi.fn(),
}));

import { registerSearchCommand } from './search';

describe('registerSearchCommand', () => {
  beforeEach(() => {
    mockRepoSearch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the search command', () => {
    const program = new Command();
    registerSearchCommand(program);
    const command = program.commands.find((c) => c.name() === 'search');
    expect(command).toBeDefined();
    expect(command?.description()).toBe('Search the repository index');
  });

  it('performs lexical search by default', async () => {
    mockRepoSearch.mockResolvedValue({
      matches: [],
      stats: {
        durationMs: 1,
        matchesFound: 0,
        engine: 'js-fallback',
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = new Command();
    registerSearchCommand(program);

    await program.parseAsync(['node', 'search', 'search', 'hello']);

    expect(mockRepoSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'hello',
        cwd: '/fake/repo/root',
        fixedStrings: true,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('No results found.');
  });
});
