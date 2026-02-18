import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolManager } from './tool_manager';
import {
  MANIFEST_VERSION,
  ToolRunRequest,
  ToolPolicy,
  UsageError,
  ToolError,
} from '@orchestrator/shared';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { SafeCommandRunner } from '@orchestrator/exec';

// Mock fs/promises
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  };
});

// Mock fs (sync) because SafeCommandRunner uses sync fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
    })),
    readFileSync: vi.fn(() => ''),
  };
});

vi.mock('child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: { spawn },
  };
});

// Mock shared writeManifest
vi.mock('@orchestrator/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/shared')>();
  return {
    ...actual,
    updateManifest: vi.fn(),
    writeManifest: vi.fn(),
  };
});

describe('ToolManager', () => {
  let toolManager: ToolManager;
  let mockEventBus: { emit: ReturnType<typeof vi.fn> };
  let mockUi: { confirm: ReturnType<typeof vi.fn> };
  const manifestPath = '/tmp/manifest.json';

  beforeEach(() => {
    mockEventBus = { emit: vi.fn() };
    mockUi = { confirm: vi.fn().mockResolvedValue(true) };
    toolManager = new ToolManager(mockEventBus as any, manifestPath);

    vi.clearAllMocks();

    // Mock fs.readFile for manifest
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        schemaVersion: MANIFEST_VERSION,
        runId: 'run-1',
        startedAt: new Date().toISOString(),
        command: 'test',
        repoRoot: '/tmp',
        artifactsDir: '/tmp',
        tracePath: '/tmp/trace.jsonl',
        summaryPath: '/tmp/summary.json',
        effectiveConfigPath: '/tmp/effective-config.json',
        patchPaths: [],
        toolLogPaths: [],
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should emit lifecycle events and update manifest on successful run', async () => {
    const req: ToolRunRequest = { command: 'echo hello', reason: 'test', cwd: '/tmp' };
    const policy: ToolPolicy = {
      enabled: true,
      requireConfirmation: false,
      allowlistPrefixes: [],
      denylistPatterns: [],
      allowNetwork: false,
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    };
    const ctx = { runId: 'run-1' };

    // Mock Child Process
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.pid = 123;
    vi.mocked(spawn).mockReturnValue(mockChild);

    setTimeout(() => {
      mockChild.emit('close', 0);
    }, 10);

    await toolManager.runTool(req, policy, mockUi as any, ctx);

    // Verify events
    expect(mockEventBus.emit).toHaveBeenCalledTimes(4); // Requested, Approved, Started, Finished

    const calls = mockEventBus.emit.mock.calls;
    expect(calls[0][0].type).toBe('ToolRunRequested');
    expect(calls[1][0].type).toBe('ToolRunApproved');
    expect(calls[2][0].type).toBe('ToolRunStarted');
    expect(calls[3][0].type).toBe('ToolRunFinished');

    // Verify manifest update was attempted
    const { updateManifest } = await import('@orchestrator/shared');
    expect(updateManifest).toHaveBeenCalledWith(manifestPath, expect.any(Function));
  });

  it('should emit ToolRunBlocked when policy denied', async () => {
    const req: ToolRunRequest = { command: 'rm -rf /', reason: 'test', cwd: '/tmp' };
    const policy: ToolPolicy = {
      enabled: true,
      requireConfirmation: false,
      allowlistPrefixes: [],
      denylistPatterns: ['rm -rf'],
      allowNetwork: false,
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    };
    const ctx = { runId: 'run-1' };

    await expect(toolManager.runTool(req, policy, mockUi as any, ctx)).rejects.toThrow();

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ToolRunRequested',
      }),
    );
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ToolRunBlocked',
      }),
    );
    expect(mockEventBus.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ToolRunStarted',
      }),
    );
  });

  it('uses sandbox cwd/env when not provided on request', async () => {
    const sandboxProvider = {
      prepare: vi.fn().mockResolvedValue({
        cwd: '/sandbox',
        envOverrides: { FOO: 'sandbox', BAR: '1' },
      }),
    };
    toolManager = new ToolManager(
      mockEventBus as any,
      manifestPath,
      '/repo',
      sandboxProvider as any,
    );

    const runSpy = vi
      .spyOn(SafeCommandRunner.prototype, 'run')
      .mockImplementationOnce(async (req: any) => {
        expect(req.cwd).toBe('/sandbox');
        expect(req.env).toEqual(expect.objectContaining({ FOO: 'sandbox', BAR: '1' }));
        return {
          exitCode: 0,
          durationMs: 1,
          stdoutPath: '/tmp/stdout.txt',
          stderrPath: '/tmp/stderr.txt',
          truncated: false,
        };
      });

    await toolManager.runTool(
      { command: 'echo hello', reason: 'test', env: { FOO: 'req' } },
      { enabled: false } as any,
      mockUi as any,
      { runId: 'run-1' } as any,
    );

    runSpy.mockRestore();
    expect(sandboxProvider.prepare).toHaveBeenCalledWith('/repo', 'run-1');
  });

  it('does not override explicit request cwd with sandbox cwd', async () => {
    const sandboxProvider = {
      prepare: vi.fn().mockResolvedValue({
        cwd: '/sandbox',
        envOverrides: {},
      }),
    };
    toolManager = new ToolManager(
      mockEventBus as any,
      manifestPath,
      '/repo',
      sandboxProvider as any,
    );

    const runSpy = vi
      .spyOn(SafeCommandRunner.prototype, 'run')
      .mockImplementationOnce(async (req: any) => {
        expect(req.cwd).toBe('/explicit');
        return {
          exitCode: 0,
          durationMs: 1,
          stdoutPath: '/tmp/stdout.txt',
          stderrPath: '/tmp/stderr.txt',
          truncated: false,
        };
      });

    await toolManager.runTool(
      { command: 'echo hello', reason: 'test', cwd: '/explicit' },
      { enabled: false } as any,
      mockUi as any,
      { runId: 'run-1' } as any,
    );

    runSpy.mockRestore();
  });

  it('stores relative log paths in manifest (and preserves existing)', async () => {
    const { updateManifest } = await import('@orchestrator/shared');
    const manifestState: any = { schemaVersion: 999, toolLogPaths: ['existing.log'] };
    vi.mocked(updateManifest).mockImplementationOnce(async (_path: any, updater: any) => {
      updater(manifestState);
    });

    const runSpy = vi.spyOn(SafeCommandRunner.prototype, 'run').mockResolvedValueOnce({
      exitCode: 0,
      durationMs: 1,
      stdoutPath: '/tmp/logs/stdout.txt',
      stderrPath: '/tmp/logs/stderr.txt',
      truncated: false,
    } as any);

    await toolManager.runTool(
      { command: 'echo hello', reason: 'test', cwd: '/tmp' },
      { enabled: false } as any,
      mockUi as any,
      { runId: 'run-1' } as any,
    );

    runSpy.mockRestore();
    expect(manifestState.schemaVersion).toBe(999);
    expect(manifestState.toolLogPaths).toEqual(
      expect.arrayContaining(['existing.log', 'logs/stdout.txt', 'logs/stderr.txt']),
    );
  });

  it('swallows manifest update failures', async () => {
    const { updateManifest } = await import('@orchestrator/shared');
    vi.mocked(updateManifest).mockRejectedValueOnce(new Error('boom'));

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runSpy = vi.spyOn(SafeCommandRunner.prototype, 'run').mockResolvedValueOnce({
      exitCode: 0,
      durationMs: 1,
      stdoutPath: '/tmp/stdout.txt',
      stderrPath: '/tmp/stderr.txt',
      truncated: false,
    } as any);

    await toolManager.runTool(
      { command: 'echo hello', reason: 'test', cwd: '/tmp' },
      { enabled: false } as any,
      mockUi as any,
      { runId: 'run-1' } as any,
    );

    runSpy.mockRestore();
    consoleError.mockRestore();
  });

  it('classifies block reasons from error details and message patterns', async () => {
    const runSpy = vi
      .spyOn(SafeCommandRunner.prototype, 'run')
      .mockRejectedValueOnce(new UsageError('denied', { details: { reason: 'policy' } }))
      .mockRejectedValueOnce(new ToolError('network access denied'))
      .mockRejectedValueOnce(new ToolError('shell is not allowed'))
      .mockRejectedValueOnce(new ToolError('User denied the action'));

    const req: ToolRunRequest = { command: 'echo hello', reason: 'test', cwd: '/tmp' };
    const policy = { enabled: false } as any;
    const ctx = { runId: 'run-1' } as any;

    await expect(toolManager.runTool(req, policy, mockUi as any, ctx)).rejects.toThrow();
    await expect(toolManager.runTool(req, policy, mockUi as any, ctx)).rejects.toThrow();
    await expect(toolManager.runTool(req, policy, mockUi as any, ctx)).rejects.toThrow();
    await expect(toolManager.runTool(req, policy, mockUi as any, ctx)).rejects.toThrow();

    const blockedCalls = mockEventBus.emit.mock.calls.filter(
      (c) => c[0]?.type === 'ToolRunBlocked',
    );
    expect(blockedCalls.map((c) => c[0].payload.reason)).toEqual([
      'policy',
      'network_denied',
      'shell_disallowed',
      'user_denied',
    ]);

    runSpy.mockRestore();
  });
});
