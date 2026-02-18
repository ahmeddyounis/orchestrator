import { describe, it, expect, vi } from 'vitest';
import { ProcessManager } from './process-manager';
import type { Logger } from '@orchestrator/shared';

type ProcessManagerInternals = ProcessManager & {
  killed: boolean;
  isPty: boolean;
  buffer: string;
  childProcess?: { stdin?: { end: () => void; write: (input: string) => void } } | undefined;
  ptyProcess?: { write: (input: string) => void; kill: (signal: string) => void } | undefined;
  pid?: number;
  runId?: string;
  logger?: Logger;
  handleOutput: (chunk: string, stream: 'stdout' | 'stderr') => void;
  handleExit: (code: number | null, signal: string | number | null, errorMsg?: string) => void;
};

describe('ProcessManager (coverage)', () => {
  it('write throws when the process is not running', () => {
    const pm = new ProcessManager();
    expect(() => pm.write('x')).toThrow(/Process not running/);
  });

  it('endInput is a no-op when killed or PTY, and ends stdin when available', () => {
    const pm1 = new ProcessManager() as unknown as ProcessManagerInternals;
    pm1.killed = true;
    pm1.endInput(); // Should not throw

    const pm2 = new ProcessManager() as unknown as ProcessManagerInternals;
    pm2.isPty = true;
    pm2.endInput(); // Should not throw

    const stdinEnd = vi.fn();
    const pm3 = new ProcessManager() as unknown as ProcessManagerInternals;
    pm3.childProcess = { stdin: { end: stdinEnd, write: vi.fn() } };
    pm3.endInput();
    expect(stdinEnd).toHaveBeenCalledTimes(1);
  });

  it('spawn throws if a process is already running', async () => {
    const pm = new ProcessManager() as unknown as ProcessManagerInternals;
    pm.childProcess = { stdin: { end: vi.fn(), write: vi.fn() } };

    await expect(pm.spawn(['node', '-e', ''], process.cwd(), {}, false)).rejects.toThrow(
      /Process already running/,
    );
  });

  it('readUntil resolves immediately when the predicate already matches and clears the buffer', async () => {
    const pm = new ProcessManager() as unknown as ProcessManagerInternals;
    pm.buffer = 'already there';

    await expect(pm.readUntil((t) => t.includes('already'))).resolves.toBe('already there');
    expect(pm.buffer).toBe('');
  });

  it('readUntil rejects if the process exits while waiting', async () => {
    const pm = new ProcessManager();
    const p = pm.readUntil(() => false, 10_000);

    pm.emit('exit');

    await expect(p).rejects.toThrow(/Process exited while waiting/);
  });

  it('readUntilHeuristic resolves on output when predicate matches', async () => {
    const pm = new ProcessManager() as unknown as ProcessManagerInternals;
    const p = pm.readUntilHeuristic(10, (t) => t.includes('match'), 1000);

    pm.buffer = 'match';
    pm.emit('output');

    await expect(p).resolves.toBe('match');
    expect(pm.buffer).toBe('');
  });

  it('readUntilHeuristic resolves with buffered output on exit', async () => {
    const pm = new ProcessManager() as unknown as ProcessManagerInternals;
    pm.buffer = 'partial';

    const p = pm.readUntilHeuristic(10, () => false, 1000);
    pm.emit('exit');

    await expect(p).resolves.toBe('partial');
    expect(pm.buffer).toBe('');
  });

  it('readStream yields queued output and completes', async () => {
    const pm = new ProcessManager();

    const collected = (async () => {
      const out: Array<{ type: string; chunk: string }> = [];
      for await (const item of pm.readStream()) {
        out.push(item);
      }
      return out;
    })();

    await Promise.resolve();
    pm.emit('output', 'a', 'stdout');
    pm.emit('output', 'b', 'stderr');
    pm.emit('exit', { error: undefined });

    await expect(collected).resolves.toEqual([
      { type: 'stdout', chunk: 'a' },
      { type: 'stderr', chunk: 'b' },
    ]);
  });

  it('readStream throws when exit includes an error', async () => {
    const pm = new ProcessManager();

    const collected = (async () => {
      const out: Array<{ type: string; chunk: string }> = [];
      for await (const item of pm.readStream()) {
        out.push(item);
      }
      return out;
    })();

    await Promise.resolve();
    pm.emit('output', 'a', 'stdout');
    pm.emit('exit', { error: 'boom' });

    await expect(collected).rejects.toThrow('boom');
  });

  it('kill is idempotent and handles PTY kill failures with debug logging', () => {
    const debug = vi.fn();
    const logger = { debug, log: vi.fn() } as unknown as Logger;

    const pm = new ProcessManager({ logger }) as unknown as ProcessManagerInternals;
    pm.pid = 123;
    pm.isPty = true;
    pm.ptyProcess = {
      write: vi.fn(),
      kill: () => {
        throw new Error('nope');
      },
    };

    pm.kill();
    expect(debug).toHaveBeenCalledTimes(1);

    pm.kill();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('emits structured output/exit events to a logger when available', () => {
    const log = vi.fn();
    const logger = { log } as unknown as Logger;

    const pm = new ProcessManager({ logger }) as unknown as ProcessManagerInternals;
    pm.pid = 123;
    pm.runId = '';

    pm.handleOutput('hello', 'stdout');
    pm.handleExit(0, null);

    expect(log).toHaveBeenCalled();
  });
});

