import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RipgrepSearch } from './ripgrep';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

function createMockChildProcess(stdoutLines: string[], exitCode: number = 0) {
  const child = new EventEmitter() as unknown as {
    stdout: Readable;
    stderr: Readable;
    on: (event: 'close' | 'error', cb: (...args: any[]) => void) => void;
    emit: (event: 'close' | 'error', ...args: any[]) => boolean;
  };

  // Ensure readline sees newline-delimited output.
  const withNewlines = stdoutLines.map((l) => (l.endsWith('\n') ? l : l + '\n'));
  child.stdout = Readable.from(withNewlines);
  child.stderr = Readable.from([]);

  // Emit "close" after stdout finishes and after the consumer attaches handlers.
  child.stdout.on('end', () => {
    setImmediate(() => (child as any).emit('close', exitCode));
  });

  return child as any;
}

describe('RipgrepSearch', () => {
  const mockSpawn = vi.mocked(spawn);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isAvailable returns true when rg --version exits 0 and caches the result', async () => {
    const p = new EventEmitter() as any;
    mockSpawn.mockReturnValueOnce(p);

    // Emit close after listeners are attached.
    setImmediate(() => p.emit('close', 0));

    const search = new RipgrepSearch();
    await expect(search.isAvailable()).resolves.toBe(true);
    await expect(search.isAvailable()).resolves.toBe(true);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0][1]).toEqual(['--version']);
  });

  it('parses match events from rg --json output', async () => {
    const output = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'file.ts' },
        lines: { text: 'hello world\n' },
        line_number: 10,
        submatches: [{ start: 6, end: 11, match: { text: 'world' } }],
      },
    });

    mockSpawn.mockReturnValueOnce(createMockChildProcess([output], 0));

    const search = new RipgrepSearch();
    const result = await search.search({ query: 'world', cwd: '/test' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      path: 'file.ts',
      line: 10,
      column: 7, // 6 + 1
      lineText: 'hello world',
      matchText: 'world',
    });
    expect(result.stats.engine).toBe('ripgrep');
    expect(result.stats.matchesFound).toBe(1);
  });

  it('adds --fixed-strings when fixedStrings is true', async () => {
    mockSpawn.mockReturnValueOnce(createMockChildProcess([], 0));

    const search = new RipgrepSearch('rg');
    await search.search({ query: 'literal', cwd: '/test', fixedStrings: true });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--fixed-strings');
  });

  it('ignores invalid JSON and empty lines', async () => {
    const output = [
      '',
      '   ',
      'not json',
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'file.ts' },
          lines: { text: 'hello\n' },
          line_number: 1,
          submatches: [{ start: 0, end: 5, match: { text: 'hello' } }],
        },
      }),
      '{broken',
    ];

    mockSpawn.mockReturnValueOnce(createMockChildProcess(output, 0));

    const search = new RipgrepSearch();
    const result = await search.search({ query: 'hello', cwd: '/test' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].path).toBe('file.ts');
  });
});

