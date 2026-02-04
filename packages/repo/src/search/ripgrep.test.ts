import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RipgrepSearch } from './ripgrep';
import { EventEmitter, Readable } from 'node:stream';
import * as childProcess from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(childProcess.spawn);

function createMockChildProcess(
  stdout: string | string[] = '',
  exitCode: number = 0,
  emitError: Error | null = null,
): childProcess.ChildProcess {
  const stdoutStream = new Readable({
    read() {
      const lines = Array.isArray(stdout) ? stdout : [stdout];
      for (const line of lines) {
        if (line) this.push(line + '\n');
      }
      this.push(null);
    },
  });

  const stderrStream = new Readable({
    read() {
      this.push(null);
    },
  });

  const mockProcess = new EventEmitter() as childProcess.ChildProcess;
  mockProcess.stdout = stdoutStream as childProcess.ChildProcess['stdout'];
  mockProcess.stderr = stderrStream as childProcess.ChildProcess['stderr'];
  mockProcess.stdin = null;
  mockProcess.stdio = [null, stdoutStream, stderrStream, null, null];
  mockProcess.pid = 12345;
  mockProcess.killed = false;
  mockProcess.connected = false;
  mockProcess.exitCode = null;
  mockProcess.signalCode = null;
  mockProcess.spawnargs = [];
  mockProcess.spawnfile = '';

  // Emit close/error after a short delay
  setImmediate(() => {
    if (emitError) {
      mockProcess.emit('error', emitError);
    } else {
      mockProcess.emit('close', exitCode);
    }
  });

  return mockProcess;
}

describe('RipgrepSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default rg path', () => {
      const search = new RipgrepSearch();
      // @ts-expect-error - accessing private property for testing
      expect(search.rgPath).toBe('rg');
    });

    it('should accept custom rg path', () => {
      const search = new RipgrepSearch('/custom/path/to/rg');
      // @ts-expect-error - accessing private property for testing
      expect(search.rgPath).toBe('/custom/path/to/rg');
    });
  });

  describe('isAvailable', () => {
    it('should return true when rg --version succeeds', async () => {
      mockSpawn.mockReturnValueOnce(createMockChildProcess('', 0));

      const search = new RipgrepSearch();
      const result = await search.isAvailable();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('rg', ['--version']);
    });

    it('should return false when rg --version fails', async () => {
      mockSpawn.mockReturnValueOnce(createMockChildProcess('', 1));

      const search = new RipgrepSearch();
      const result = await search.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when spawn emits error', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess('', 0, new Error('Command not found')),
      );

      const search = new RipgrepSearch();
      const result = await search.isAvailable();

      expect(result).toBe(false);
    });

    it('should cache the availability result', async () => {
      mockSpawn.mockReturnValueOnce(createMockChildProcess('', 0));

      const search = new RipgrepSearch();

      const result1 = await search.isAvailable();
      const result2 = await search.isAvailable();

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('should use custom rg path when checking availability', async () => {
      mockSpawn.mockReturnValueOnce(createMockChildProcess('', 0));

      const search = new RipgrepSearch('/usr/local/bin/rg');
      await search.isAvailable();

      expect(mockSpawn).toHaveBeenCalledWith('/usr/local/bin/rg', ['--version']);
    });

    it('should return false when spawn throws synchronously', async () => {
      mockSpawn.mockImplementationOnce(() => {
        throw new Error('spawn ENOENT');
      });

      const search = new RipgrepSearch();
      const result = await search.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('search', () => {
    describe('process spawning', () => {
      it('should spawn rg with correct arguments', async () => {
        mockSpawn.mockReturnValueOnce(createMockChildProcess('', 0));

        const search = new RipgrepSearch();
        await search.search({
          query: 'test-query',
          cwd: '/test/dir',
        });

        expect(mockSpawn).toHaveBeenCalledWith(
          'rg',
          ['--json', '--no-heading', '--line-number', '--column', '--max-columns', '200', 'test-query'],
          {
            cwd: '/test/dir',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
      });

      it('should add --fixed-strings flag when fixedStrings option is true', async () => {
        mockSpawn.mockReturnValueOnce(createMockChildProcess('', 0));

        const search = new RipgrepSearch();
        await search.search({
          query: 'test-query',
          cwd: '/test/dir',
          fixedStrings: true,
        });

        expect(mockSpawn).toHaveBeenCalledWith(
          'rg',
          expect.arrayContaining(['--fixed-strings', 'test-query']),
          expect.any(Object),
        );
      });

      it('should reject when process emits error', async () => {
        const mockProcess = createMockChildProcess('', 0, new Error('Process failed'));
        mockSpawn.mockReturnValueOnce(mockProcess);

        const search = new RipgrepSearch();

        await expect(
          search.search({
            query: 'test',
            cwd: '/test',
          }),
        ).rejects.toThrow('Process failed');
      });
    });

    describe('JSON parsing', () => {
      it('should parse valid ripgrep JSON match output', async () => {
        const rgOutput = JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'src/file.ts' },
            lines: { text: 'const hello = "world";\n' },
            line_number: 42,
            submatches: [{ start: 6, end: 11, match: { text: 'hello' } }],
          },
        });

        mockSpawn.mockReturnValueOnce(createMockChildProcess(rgOutput, 0));

        const search = new RipgrepSearch();
        const result = await search.search({
          query: 'hello',
          cwd: '/test',
        });

        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]).toEqual({
          path: 'src/file.ts',
          line: 42,
          column: 7, // start + 1 for 1-based index
          lineText: 'const hello = "world";',
          matchText: 'hello',
        });
      });

      it('should parse multiple matches', async () => {
        const outputs = [
          JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'file1.ts' },
              lines: { text: 'hello world\n' },
              line_number: 1,
              submatches: [{ start: 0, end: 5, match: { text: 'hello' } }],
            },
          }),
          JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'file2.ts' },
              lines: { text: 'say hello\n' },
              line_number: 10,
              submatches: [{ start: 4, end: 9, match: { text: 'hello' } }],
            },
          }),
        ];

        mockSpawn.mockReturnValueOnce(createMockChildProcess(outputs, 0));

        const search = new RipgrepSearch();
        const result = await search.search({
          query: 'hello',
          cwd: '/test',
        });

        expect(result.matches).toHaveLength(2);
        expect(result.matches[0].path).toBe('file1.ts');
        expect(result.matches[1].path).toBe('file2.ts');
      });

      it('should ignore non-match JSON events', async () => {
        const outputs = [
          JSON.stringify({ type: 'begin', data: { path: { text: 'file.ts' } } }),
          JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'file.ts' },
              lines: { text: 'hello\n' },
              line_number: 1,
              submatches: [{ start: 0, end: 5, match: { text: 'hello' } }],
            },
          }),
          JSON.stringify({ type: 'end', data: { path: { text: 'file.ts' } } }),
          JSON.stringify({ type: 'summary', data: { elapsed_total: { human: '1ms' } } }),
        ];

        mockSpawn.mockReturnValueOnce(createMockChildProcess(outputs, 0));

        const search = new RipgrepSearch();
        const result = await search.search({
          query: 'hello',
          cwd: '/test',
        });

        expect(result.matches).toHaveLength(1);
      });

      it('should handle match with no submatches gracefully', async () => {
        const rgOutput = JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'file.ts' },
            lines: { text: 'test line\n' },
            line_number: 5,
            submatches: [],
          },
        });

        mockSpawn.mockReturnValueOnce(createMockChildProcess(rgOutput, 0));

        const search = new RipgrepSearch();
        const result = await search.search({
          query: 'test',
          cwd: '/test',
        });

        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].column).toBe(1); // Default 0 + 1
        expect(result.matches[0].matchText).toBe('');
      });

      it('should ignore invalid JSON lines', async () => {
        const outputs = [
          'not valid json',
          JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'file.ts' },
              lines: { text: 'hello\n' },
              line_number: 1,
              submatches: [{ start: 0, end: 5, match: { text: 'hello' } }],
            },
          }),
          '{broken json',
        ];

        mockSpawn.mockReturnValueOnce(createMockChildProcess(outputs, 0));

        const search = new RipgrepSearch();
        const result = await search.search({
          query: 'hello',
          cwd: '/test',
        });

        expect(result.matches).toHaveLength(1);
      });

      it('should skip empty lines', async () => {
        const outputs = [
          '',
          '   ',
          JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'file.ts' },
              lines: { text: 'hello\n' },
              line_number: 1,
              submatches: [{ start: 0, end: 5, match: { text: 'hello' } }],
            },
          }),
