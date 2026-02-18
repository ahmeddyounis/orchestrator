import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { JsonlEventWriter } from './jsonl-event-writer';
import type { RunStarted } from '../types/events';

describe('JsonlEventWriter', () => {
  it('writes JSONL events and is safe to close multiple times', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-evt-'));
    const logPath = path.join(tmpDir, 'events.jsonl');

    const writer = new JsonlEventWriter(logPath);
    const event: RunStarted = {
      schemaVersion: 1,
      timestamp: '2026-02-18T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: { taskId: 't1', goal: 'test' },
    };

    writer.write(event);
    await writer.close();
    await writer.close();

    const content = await fs.readFile(logPath, 'utf8');
    expect(content.trim()).toBe(JSON.stringify(event));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('warns and does not write after being closed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-evt-'));
    const logPath = path.join(tmpDir, 'events.jsonl');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writer = new JsonlEventWriter(logPath);
    await writer.close();

    writer.write({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: '2026-02-18T00:00:00.000Z',
      runId: 'run-1',
      payload: { taskId: 't1', goal: 'test' },
    } as RunStarted);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Attempted to write to closed trace writer:/),
    );

    warnSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
