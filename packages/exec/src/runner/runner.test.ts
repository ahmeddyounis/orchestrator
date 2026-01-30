import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SafeCommandRunner, UserInterface, RunnerContext } from './runner';
import { PolicyDeniedError, ConfirmationDeniedError, TimeoutError } from './errors';
import { ToolRunRequest, ToolPolicy } from '@orchestrator/shared';
import * as fs from 'fs';
import { Mock } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mkdirSync = vi.fn();
  const createWriteStream = vi.fn();
  const readFileSync = vi.fn();

  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync,
      createWriteStream,
      readFileSync,
    },
    mkdirSync,
    createWriteStream,
    readFileSync,
  };
});

vi.mock('child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: {
      spawn,
    },
  };
});

describe('SafeCommandRunner', () => {
  let runner: SafeCommandRunner;
  let mockUi: UserInterface;
  let mockCtx: RunnerContext;
  let defaultPolicy: ToolPolicy;

  beforeEach(() => {
    runner = new SafeCommandRunner();
    mockUi = {
      confirm: vi.fn().mockResolvedValue(true),
    };
    mockCtx = {
      runId: 'test-run-id',
      cwd: '/tmp',
    };
    defaultPolicy = {
      enabled: true,
      requireConfirmation: true,
      allowlistPrefixes: ['safe-cmd'],
      denylistPatterns: ['rm -rf'],
      allowNetwork: false,
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    };

    vi.clearAllMocks();

    vi.spyOn(process, 'kill').mockImplementation(() => true);

    // Mock fs
    (fs.createWriteStream as unknown as Mock).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    });
    (fs.readFileSync as unknown as Mock).mockReturnValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw PolicyDeniedError if disabled', async () => {
    const policy = { ...defaultPolicy, enabled: false };
    const req: ToolRunRequest = { command: 'echo hello', reason: 'test', cwd: '/tmp' };

    await expect(runner.run(req, policy, mockUi, mockCtx)).rejects.toThrow(PolicyDeniedError);
  });

  it('should throw PolicyDeniedError if command is denylisted', async () => {
    const req: ToolRunRequest = { command: 'rm -rf /', reason: 'test', cwd: '/tmp' };

    await expect(runner.run(req, defaultPolicy, mockUi, mockCtx)).rejects.toThrow(
      PolicyDeniedError,
    );
  });

  it('should bypass confirmation if command is allowlisted', async () => {
    const req: ToolRunRequest = { command: 'safe-cmd run', reason: 'test', cwd: '/tmp' };

    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.pid = 123;
    vi.mocked(spawn).mockReturnValue(mockChild);

    setTimeout(() => mockChild.emit('close', 0), 10);

    await runner.run(req, defaultPolicy, mockUi, mockCtx);

    expect(mockUi.confirm).not.toHaveBeenCalled();
  });

  it('should require confirmation if not allowlisted and requireConfirmation is true', async () => {
    const req: ToolRunRequest = { command: 'other-cmd', reason: 'test', cwd: '/tmp' };

    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.pid = 123;
    vi.mocked(spawn).mockReturnValue(mockChild);

    setTimeout(() => mockChild.emit('close', 0), 10);

    await runner.run(req, defaultPolicy, mockUi, mockCtx);

    expect(mockUi.confirm).toHaveBeenCalled();
  });

  it('should throw ConfirmationDeniedError if user denies', async () => {
    vi.mocked(mockUi.confirm).mockResolvedValue(false);
    const req: ToolRunRequest = { command: 'other-cmd', reason: 'test', cwd: '/tmp' };

    await expect(runner.run(req, defaultPolicy, mockUi, mockCtx)).rejects.toThrow(
      ConfirmationDeniedError,
    );
  });

  it('should handle timeout', async () => {
    const req: ToolRunRequest = { command: 'sleep 2', reason: 'test', cwd: '/tmp' };
    const policy = { ...defaultPolicy, timeoutMs: 10 };

    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.pid = 123;
    vi.mocked(spawn).mockReturnValue(mockChild);

    // Do not emit close, let it timeout

    // Mock fs read for partial output
    (fs.readFileSync as unknown as Mock).mockReturnValue('partial output');

    await expect(runner.run(req, policy, mockUi, mockCtx)).rejects.toThrow(TimeoutError);
  });

  it('should truncate output if limit exceeded', async () => {
    const req: ToolRunRequest = { command: 'echo long', reason: 'test', cwd: '/tmp' };
    const policy = { ...defaultPolicy, maxOutputBytes: 5 };

    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.pid = 123;
    vi.mocked(spawn).mockReturnValue(mockChild);

    const promise = runner.run(req, policy, mockUi, mockCtx);

    // Wait for runner to process confirmation and spawn
    await new Promise((resolve) => setTimeout(resolve, 50));

    mockChild.stdout.emit('data', Buffer.from('123456'));
    mockChild.emit('close', 0);

    const result = await promise;
    expect(result.truncated).toBe(true);
  });
});
