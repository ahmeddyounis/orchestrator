import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolManager } from './tool_manager';
import { ToolRunRequest, ToolPolicy } from '@orchestrator/shared';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

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

    // Verify Manifest Update
    // We mocked fs.readFile to return empty log paths
    // We expect writeManifest to be called
    const { writeManifest } = await import('@orchestrator/shared');
    expect(writeManifest).toHaveBeenCalled();
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
});
