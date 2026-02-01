import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { join } from '../fs/path.js';
import * as os from 'os';
import { JsonlLogger } from './jsonlLogger';
import { RunStarted } from '../types/events';

describe('JsonlLogger', () => {
  let tmpDir: string;

  afterEach(async () => {
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
});
