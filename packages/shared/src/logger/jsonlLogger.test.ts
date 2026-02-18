import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { join } from '../fs/path.js';
import * as os from 'os';
import { JsonlLogger } from './jsonlLogger';
import { RunStarted } from '../types/events';

describe('JsonlLogger', () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('logs events to file in JSONL format', async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-logger-test-'));
    const logPath = join(tmpDir, 'trace.jsonl');
    const logger = new JsonlLogger(logPath);

    const event1: RunStarted = {
      schemaVersion: 1,
      timestamp: '2023-01-01T00:00:00Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: { taskId: 't1', goal: 'test' },
    };

    await logger.log(event1);

    const content = await fs.readFile(logPath, 'utf8');
    expect(content.trim()).toBe(JSON.stringify(event1));
  });

  it('appends multiple events', async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-logger-test-'));
    const logPath = join(tmpDir, 'trace.jsonl');
    const logger = new JsonlLogger(logPath);

    const event1: RunStarted = {
      schemaVersion: 1,
      timestamp: '2023-01-01T00:00:00Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: { taskId: 't1', goal: 'test' },
    };
    // Reusing same event type for simplicity, just checking append
    const event2 = { ...event1, timestamp: '2023-01-01T00:00:01Z' };

    await logger.log(event1);
    await logger.log(event2);

    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual(event1);
    expect(JSON.parse(lines[1])).toEqual(event2);
  });

  it('implements trace via log', async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-logger-test-'));
    const logPath = join(tmpDir, 'trace.jsonl');
    const logger = new JsonlLogger(logPath);

    const event: RunStarted = {
      schemaVersion: 1,
      timestamp: '2023-01-01T00:00:00Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: { taskId: 't1', goal: 'test' },
    };

    await logger.trace(event, 'ignored');

    const content = await fs.readFile(logPath, 'utf8');
    expect(content.trim()).toBe(JSON.stringify(event));
  });

  it('prefixes messages for child loggers', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const logger = new JsonlLogger('/dev/null');
    logger.child({ a: 1 }).debug('d');
    logger.child({ a: 1 }).child({ b: 'x' }).info('i');
    logger.child({}).warn('w');

    expect(debugSpy).toHaveBeenCalledWith('[a=1] d');
    expect(infoSpy).toHaveBeenCalledWith('[a=1 b=x] i');
    expect(warnSpy).toHaveBeenCalledWith('w');
  });

  it('logs errors with and without messages', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new JsonlLogger('/dev/null', { scope: 't' });
    logger.error(new Error('boom'));
    logger.error(new Error('boom'), 'msg');

    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
    expect(errorSpy).toHaveBeenCalledWith('[scope=t] msg', expect.any(Error));
  });

  it('does not throw if appending to the file fails', async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-logger-test-'));
    // Use a directory path so appendFile fails deterministically (EISDIR).
    const logPath = tmpDir;
    const logger = new JsonlLogger(logPath);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      logger.log({
        schemaVersion: 1,
        timestamp: '2023-01-01T00:00:00Z',
        runId: 'run-1',
        type: 'RunStarted',
        payload: { taskId: 't1', goal: 'test' },
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to write to log file at ${logPath}`),
      expect.any(Error),
    );
  });
});
