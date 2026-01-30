import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryWriter } from './index';
import { RepoState, RunSummary, ToolRunMeta } from './types';
import { ToolRunResult } from '@orchestrator/shared';
import { VerificationReport } from '../verify/types';

describe('MemoryWriter', () => {
  let memoryWriter: MemoryWriter;

  beforeEach(() => {
    const mockEventBus = { emit: vi.fn() };
    memoryWriter = new MemoryWriter(mockEventBus, 'test-run');
    memoryWriter.getMemoryStore().clear();
  });

  it('should extract procedural memory for a successful test run', async () => {
    const toolRunMeta: ToolRunMeta = {
      request: { command: 'pnpm test', cwd: '/tmp', reason: 'test' },
      classification: 'test',
      toolRunId: 'run-1',
    };
    const toolRunResult: ToolRunResult = {
      exitCode: 0,
      durationMs: 1000,
      stdoutPath: '',
      stderrPath: '',
      truncated: false,
    };
    const repoState: RepoState = { gitSha: 'sha-1' };

    const memory = await memoryWriter.extractProcedural(toolRunMeta, toolRunResult, repoState);

    expect(memory).not.toBeNull();
    expect(memory?.title).toBe('How to run tests');
    expect(memory?.content).toBe('pnpm test');
    expect(memory?.evidence.exitCode).toBe(0);
    expect(memoryWriter.getMemoryStore().size).toBe(1);
  });

  it('should not extract procedural memory for a failed run', async () => {
    const toolRunMeta: ToolRunMeta = {
      request: { command: 'pnpm test', cwd: '/tmp', reason: 'test' },
      classification: 'test',
      toolRunId: 'run-1',
    };
    const toolRunResult: ToolRunResult = {
      exitCode: 1,
      durationMs: 1000,
      stdoutPath: '',
      stderrPath: '',
      truncated: false,
    };
    const repoState: RepoState = { gitSha: 'sha-1' };

    const memory = await memoryWriter.extractProcedural(toolRunMeta, toolRunResult, repoState);

    expect(memory).toBeNull();
    expect(memoryWriter.getMemoryStore().size).toBe(0);
  });

  it('should not extract procedural memory for a non-applicable classification', async () => {
    const toolRunMeta: ToolRunMeta = {
      request: { command: 'pnpm install', cwd: '/tmp', reason: 'install' },
      classification: 'install',
      toolRunId: 'run-1',
    };
    const toolRunResult: ToolRunResult = {
      exitCode: 0,
      durationMs: 1000,
      stdoutPath: '',
      stderrPath: '',
      truncated: false,
    };
    const repoState: RepoState = { gitSha: 'sha-1' };

    const memory = await memoryWriter.extractProcedural(toolRunMeta, toolRunResult, repoState);

    expect(memory).toBeNull();
    expect(memoryWriter.getMemoryStore().size).toBe(0);
  });

  it('should update existing memory on repeated command', async () => {
    const toolRunMeta1: ToolRunMeta = {
      request: { command: 'pnpm test', cwd: '/tmp', reason: 'test' },
      classification: 'test',
      toolRunId: 'run-1',
    };
    const toolRunResult1: ToolRunResult = {
      exitCode: 0,
      durationMs: 1000,
      stdoutPath: '',
      stderrPath: '',
      truncated: false,
    };
    const repoState1: RepoState = { gitSha: 'sha-1' };

    const firstMemory = await memoryWriter.extractProcedural(
      toolRunMeta1,
      toolRunResult1,
      repoState1,
    );
    const firstCreationTime = firstMemory?.createdAt;

    // Ensure there's a delay for the updated at time check
    await new Promise((resolve) => setTimeout(resolve, 10));

    const toolRunMeta2: ToolRunMeta = {
      request: { command: ' pnpm test ', cwd: '/tmp', reason: 'test' },
      classification: 'test',
      toolRunId: 'run-2',
    };
    const toolRunResult2: ToolRunResult = {
      exitCode: 0,
      durationMs: 1200,
      stdoutPath: '',
      stderrPath: '',
      truncated: false,
    };
    const repoState2: RepoState = { gitSha: 'sha-2' };

    const updatedMemory = await memoryWriter.extractProcedural(
      toolRunMeta2,
      toolRunResult2,
      repoState2,
    );

    expect(memoryWriter.getMemoryStore().size).toBe(1);
    expect(updatedMemory?.id).toBe(firstMemory?.id);
    expect(updatedMemory?.evidence.toolRunId).toBe('run-2');
    expect(updatedMemory?.gitSha).toBe('sha-2');
    expect(updatedMemory?.createdAt).toEqual(firstCreationTime);
    expect(updatedMemory?.updatedAt).not.toEqual(firstCreationTime);
  });

  it('should redact secrets from the command', async () => {
    const toolRunMeta: ToolRunMeta = {
      request: {
        command: 'pnpm test --token=sk-k6zXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        cwd: '/tmp',
        reason: 'test',
      },
      classification: 'test',
      toolRunId: 'run-1',
    };
    const toolRunResult: ToolRunResult = {
      exitCode: 0,
      durationMs: 1000,
      stdoutPath: '',
      stderrPath: '',
      truncated: false,
    };
    const repoState: RepoState = { gitSha: 'sha-1' };

    const memory = await memoryWriter.extractProcedural(toolRunMeta, toolRunResult, repoState);
    expect(memory?.content).toBe('pnpm test --token=[REDACTED]');
  });

  describe('extractEpisodic', () => {
    it('should extract episodic memory for a successful run', async () => {
      const runSummary: RunSummary = {
        runId: 'run-1',
        goal: 'Implement a new feature',
        status: 'success',
        stopReason: 'Finished',
      };
      const repoState: RepoState = { gitSha: 'sha-1' };

      const memory = await memoryWriter.extractEpisodic(runSummary, repoState);

      expect(memory).not.toBeNull();
      expect(memory.type).toBe('episodic');
      expect(memory.title).toBe('Run run-1: success - Implement a new feature');
      expect(memory.content).toContain('"goal": "Implement a new feature"');
      expect(memory.content).toContain('"status": "success"');
      expect(memoryWriter.getMemoryStore().size).toBe(1);
    });

    it('should extract episodic memory for a failed run with verification report', async () => {
      const runSummary: RunSummary = {
        runId: 'run-2',
        goal: 'Fix a critical bug',
        status: 'failure',
        stopReason: 'Verification failed',
      };
      const repoState: RepoState = { gitSha: 'sha-2' };
      const verificationReport: VerificationReport = {
        passed: false,
        summary: 'Tests failed',
        failureSignature: 'SIG-TEST-FAIL',
        checks: [],
      };

      const memory = await memoryWriter.extractEpisodic(runSummary, repoState, verificationReport);

      expect(memory.title).toBe('Run run-2: failure - Fix a critical bug');
      expect(memory.content).toContain('"status": "failure"');
      expect(memory.content).toContain('"failureSignature": "SIG-TEST-FAIL"');
      expect(memory.evidence.failureSignature).toBe('SIG-TEST-FAIL');
    });

    it('should truncate content that exceeds the size limit', async () => {
      const longGoal = 'a'.repeat(9000);
      const runSummary: RunSummary = {
        runId: 'run-3',
        goal: longGoal,
        status: 'success',
        stopReason: 'Finished',
      };
      const repoState: RepoState = { gitSha: 'sha-3' };

      const memory = await memoryWriter.extractEpisodic(runSummary, repoState);

      expect(memory.content.length).toBeLessThanOrEqual(8192 + 50);
      expect(memory.content.endsWith('... (truncated due to size limit)'));
    });
  });
});
