import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
import { ContextStackStore } from './store';
import { ContextStackRecorder } from './recorder';
import { CONTEXT_STACK_FRAME_SCHEMA_VERSION } from './types';

describe('ContextStackRecorder', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it('does nothing when disabled', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');

    const store = new ContextStackStore({ filePath, maxFrames: 50, maxBytes: 50_000 });
    await store.load();

    const recorder = new ContextStackRecorder(store, {
      repoRoot: tmpDir,
      runId: 'run-1',
      enabled: false,
    });

    await recorder.onEvent({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:00.000Z',
      runId: 'run-1',
      payload: { taskId: 'run-1', goal: 'Do the thing' },
    });

    expect(store.getAllFrames()).toEqual([]);
  });

  it('records planning/patch/verification/run lifecycle events', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');

    const store = new ContextStackStore({ filePath, maxFrames: 50, maxBytes: 50_000 });
    await store.load();

    const artifactsRoot = path.join(tmpDir, 'artifacts');
    const recorder = new ContextStackRecorder(store, {
      repoRoot: tmpDir,
      runId: 'run-1',
      runArtifactsRoot: artifactsRoot,
      enabled: true,
    });

    await recorder.onEvent({
      type: 'PlanCreated',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:00.000Z',
      runId: 'run-1',
      payload: {
        planSteps: [' one ', '', 'two', 'three', 'four', 'five', 'six'],
      },
    });

    await recorder.onEvent({
      type: 'StepFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:01.000Z',
      runId: 'run-1',
      payload: { step: 'Do X', success: true },
    });

    await recorder.onEvent({
      type: 'StepFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:02.000Z',
      runId: 'run-1',
      payload: { step: 'Do Y', success: false, error: 'nope' },
    });

    await recorder.onEvent({
      type: 'PatchApplied',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:03.000Z',
      runId: 'run-1',
      payload: { success: true, filesChanged: ['a.ts', 'b.ts'] },
    });

    await recorder.onEvent({
      type: 'PatchApplied',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:04.000Z',
      runId: 'run-1',
      payload: { success: false, filesChanged: [], description: 'no changes' },
    });

    await recorder.onEvent({
      type: 'VerificationFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:05.000Z',
      runId: 'run-1',
      payload: { passed: true, failedChecks: [] },
    });

    await recorder.onEvent({
      type: 'VerificationFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:06.000Z',
      runId: 'run-1',
      payload: { passed: false, failedChecks: [] },
    });

    await recorder.onEvent({
      type: 'RunStopped',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:07.000Z',
      runId: 'run-1',
      payload: { reason: 'cancelled', details: 'user request' },
    });

    await recorder.onEvent({
      type: 'RunEscalated',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:08.000Z',
      runId: 'run-1',
      payload: { from: 'L1', to: 'L2', reason: 'non_improving' },
    });

    await recorder.onEvent({
      type: 'RunFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:09.000Z',
      runId: 'run-1',
      payload: { status: 'success' },
    });

    const frames = store.getAllFrames();
    expect(frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'PlanCreated',
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          title: 'Plan created',
        }),
        expect.objectContaining({
          kind: 'StepFinished',
          title: 'Step finished',
          summary: 'Do X',
        }),
        expect.objectContaining({
          kind: 'StepFinished',
          title: 'Step failed',
          summary: 'Do Y — nope',
        }),
        expect.objectContaining({
          kind: 'PatchApplied',
          title: 'Patch applied',
        }),
        expect.objectContaining({
          kind: 'PatchApplied',
          title: 'Patch failed',
          summary: 'no changes',
        }),
        expect.objectContaining({
          kind: 'VerificationFinished',
          title: 'Verification passed',
          summary: 'All checks passed',
        }),
        expect.objectContaining({
          kind: 'VerificationFinished',
          title: 'Verification failed',
          summary: 'Failed checks not provided',
        }),
        expect.objectContaining({
          kind: 'RunStopped',
          title: 'Run stopped',
          summary: 'cancelled',
          details: 'user request',
        }),
        expect.objectContaining({
          kind: 'RunEscalated',
          title: 'Run escalated',
          summary: 'L1 → L2 (non_improving)',
        }),
        expect.objectContaining({
          kind: 'RunFinished',
          title: 'Run success',
          summary: '(no summary)',
        }),
      ]),
    );

    const planFrame = frames.find((f) => f.kind === 'PlanCreated');
    expect(planFrame?.summary).toContain('...(+1 more)');
    expect(planFrame?.artifacts).toEqual(['artifacts/plan.json']);
  });

  it('records tool run results with artifacts and reasons', async () => {
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
      type: 'ToolRunRequested',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:00.000Z',
      runId: 'run-1',
      payload: { toolRunId: 'tool-1', command: 'echo hi', reason: 'test', classification: 'safe' },
    });

    await recorder.onEvent({
      type: 'ToolRunFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:01.000Z',
      runId: 'run-1',
      payload: {
        toolRunId: 'tool-1',
        exitCode: 2,
        durationMs: 10,
        stdoutPath: 'stdout.txt',
        stderrPath: 'stderr.txt',
        truncated: true,
      },
    });

    await recorder.onEvent({
      // Not previously requested; should still be recorded.
      type: 'ToolRunFinished',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:02.000Z',
      runId: 'run-1',
      payload: {
        toolRunId: 'tool-unknown',
        exitCode: 0,
        durationMs: 10,
        stdoutPath: '',
        stderrPath: '',
        truncated: false,
      },
    });

    const frames = store.getAllFrames().filter((f) => f.kind === 'ToolRunFinished');
    expect(frames).toHaveLength(2);

    expect(frames[0]).toEqual(
      expect.objectContaining({
        title: 'Tool failed',
        details: 'Reason: test',
        artifacts: ['stdout.txt', 'stderr.txt'],
      }),
    );
    expect(frames[0].summary).toContain('echo hi');
    expect(frames[0].summary).toContain('exitCode=2');
    expect(frames[0].summary).toContain('output=truncated');

    expect(frames[1]).toEqual(
      expect.objectContaining({
        title: 'Tool succeeded',
      }),
    );
    expect(frames[1].summary).toContain('exitCode=0');
    expect(frames[1].summary).not.toContain('echo hi');
    expect(frames[1]).not.toHaveProperty('details');
    expect(frames[1]).not.toHaveProperty('artifacts');
  });

  it('ignores unhandled events and swallows store errors', async () => {
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
      // Unhandled by frameFromEvent()'s switch.
      type: 'PlanRequested',
      schemaVersion: 1,
      timestamp: '2026-02-06T00:00:00.000Z',
      runId: 'run-1',
      payload: { goal: 'hi' },
    });

    expect(store.getAllFrames()).toEqual([]);

    const appendSpy = vi
      .spyOn(store, 'append')
      .mockRejectedValueOnce(new Error('append is non-fatal'));

    await expect(
      recorder.onEvent({
        type: 'RunStarted',
        schemaVersion: 1,
        timestamp: '2026-02-06T00:00:01.000Z',
        runId: 'run-1',
        payload: { taskId: 'run-1', goal: 'Do the thing' },
      }),
    ).resolves.toBeUndefined();

    expect(appendSpy).toHaveBeenCalled();
  });
});
