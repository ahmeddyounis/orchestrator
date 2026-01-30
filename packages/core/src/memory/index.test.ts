import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryWriter } from './index';
import { RepoState, ToolRunMeta } from './types';
import { ToolRunResult } from '@orchestrator/shared';

describe('MemoryWriter', () => {
  let memoryWriter: MemoryWriter;

  beforeEach(() => {
    memoryWriter = new MemoryWriter();
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

    const firstMemory = await memoryWriter.extractProcedural(toolRunMeta1, toolRunResult1, repoState1);
    const firstCreationTime = firstMemory?.createdAt;

    // Ensure there's a delay for the updated at time check
    await new Promise(resolve => setTimeout(resolve, 10));

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

    const updatedMemory = await memoryWriter.extractProcedural(toolRunMeta2, toolRunResult2, repoState2);

    expect(memoryWriter.getMemoryStore().size).toBe(1);
    expect(updatedMemory?.id).toBe(firstMemory?.id);
    expect(updatedMemory?.evidence.toolRunId).toBe('run-2');
    expect(updatedMemory?.gitSha).toBe('sha-2');
    expect(updatedMemory?.createdAt).toEqual(firstCreationTime);
    expect(updatedMemory?.updatedAt).not.toEqual(firstCreationTime);
  });

  it('should redact secrets from the command', async () => {
    const toolRunMeta: ToolRunMeta = {
      request: { command: 'pnpm test --secret=supersecret', cwd: '/tmp', reason: 'test' },
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
    expect(memory?.content).toBe('pnpm test --REDACTED=superREDACTED');
  });
});
