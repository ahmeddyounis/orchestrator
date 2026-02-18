import { describe, it, expect } from 'vitest';
import { ToolRunTracker } from './tool_tracker';
import type { OrchestratorEvent } from '@orchestrator/shared';

describe('ToolRunTracker', () => {
  it('tracks tool runs across requested/finished events', () => {
    const tracker = new ToolRunTracker();

    tracker.handleEvent({
      type: 'ToolRunFinished',
      schemaVersion: 1,
      timestamp: 't',
      runId: 'r',
      payload: {
        toolRunId: 'missing',
        exitCode: 0,
        durationMs: 1,
        stdoutPath: '',
        stderrPath: '',
        truncated: false,
      },
    } as OrchestratorEvent);
    expect(tracker.getSummary()).toEqual([]);

    tracker.handleEvent({
      type: 'ToolRunRequested',
      schemaVersion: 1,
      timestamp: 't',
      runId: 'r',
      payload: {
        toolRunId: 't1',
        command: 'echo hi',
        classification: 'read_only',
        reason: 'test',
      },
    } as OrchestratorEvent);
    expect(tracker.getSummary()).toEqual([]);

    tracker.handleEvent({
      type: 'ToolRunFinished',
      schemaVersion: 1,
      timestamp: 't',
      runId: 'r',
      payload: {
        toolRunId: 't1',
        exitCode: 2,
        durationMs: 10,
        stdoutPath: 'out',
        stderrPath: 'err',
        truncated: false,
      },
    } as OrchestratorEvent);

    expect(tracker.getSummary()).toEqual([
      expect.objectContaining({
        toolRunId: 't1',
        command: 'echo hi',
        exitCode: 2,
        durationMs: 10,
      }),
    ]);
  });
});

