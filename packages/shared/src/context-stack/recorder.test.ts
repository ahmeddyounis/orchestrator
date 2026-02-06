import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
import { ContextStackStore } from './store';
import { ContextStackRecorder } from './recorder';

describe('ContextStackRecorder', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (!tmpDir) return;
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('records selected events into the stack', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');

    const store = new ContextStackStore({ filePath, maxFrames: 50, maxBytes: 50_000 });
    await store.load();

    const recorder = new ContextStackRecorder(store, {
      repoRoot: tmpDir,
      runId: 'run-1',
      enabled: true,
    });

    await recorder.onEvent({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:00.000Z',
      runId: 'run-1',
      payload: { taskId: 'run-1', goal: 'Do the thing' },
    });

    await recorder.onEvent({
      type: 'ToolRunRequested',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:01.000Z',
      runId: 'run-1',
      payload: {
        toolRunId: 'tool-1',
        command: 'echo hi',
        classification: 'safe',
        reason: 'test',
      },
    });

    await recorder.onEvent({
      type: 'ToolRunFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:02.000Z',
      runId: 'run-1',
      payload: {
        toolRunId: 'tool-1',
        exitCode: 0,
        durationMs: 10,
        stdoutPath: 'stdout.txt',
        stderrPath: 'stderr.txt',
        truncated: false,
      },
    });

    const frames = store.getAllFrames();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(
      expect.objectContaining({
        kind: 'RunStarted',
        title: 'Run started',
        summary: 'Do the thing',
      }),
    );
    expect(frames[1]).toEqual(
      expect.objectContaining({
        kind: 'ToolRunFinished',
      }),
    );
    expect(frames[1].summary).toContain('echo hi');
    expect(frames[1].summary).toContain('exitCode=0');
  });
});

