import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationRunner } from './runner';
import { VerificationProfile } from './types';
import * as fs from 'fs';
import path from 'path';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      // @ts-expect-error - we are mocking
      ...actual.promises,
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    },
  };
});

const fsMock = vi.mocked(fs);

// Hoist mocks to ensure they are available in factory
const mocks = vi.hoisted(() => {
  return {
    detect: vi.fn(),
    resolveTouchedPackages: vi.fn(),
    generateTargetedCommand: vi.fn(),
    run: vi.fn(),
    checkPolicy: vi.fn(),
    memoryFind: vi.fn(),
    updateManifest: vi.fn(),
  };
});

vi.mock('@orchestrator/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/shared')>();
  return {
    ...actual,
    updateManifest: mocks.updateManifest,
  };
});

vi.mock('@orchestrator/repo', () => ({
  ToolchainDetector: class {
    detect = mocks.detect;
  },
  TargetingManager: class {
    resolveTouchedPackages = mocks.resolveTouchedPackages;
    generateTargetedCommand = mocks.generateTargetedCommand;
  },
}));

vi.mock('@orchestrator/exec', () => ({
  SafeCommandRunner: class {
    run = mocks.run;
    checkPolicy = mocks.checkPolicy;
  },
  UserInterface: class {},
  RunnerContext: class {},
}));

vi.mock('@orchestrator/memory', async (importOriginal) => {
  const original = await importOriginal<typeof import('@orchestrator/memory')>();
  return {
    ...original,
    ProceduralMemory: class {
      find = mocks.memoryFind;
    },
  };
});

describe('VerificationRunner', () => {
  let runner: VerificationRunner;
  let mockEventBus: any;
  let mockMemory: any;

  const mockProfile: VerificationProfile = {
    enabled: true,
    mode: 'auto',
    steps: [],
    auto: {
      enableLint: true,
      enableTests: true,
      enableTypecheck: true,
      testScope: 'targeted',
      maxCommandsPerIteration: 3,
    },
  };

  const mockCtx: any = { runId: 'test-run' };
  const mockUI: any = {};
  const mockPolicy: any = {};

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.run.mockResolvedValue({ exitCode: 0, durationMs: 100 });
    mocks.checkPolicy.mockReturnValue({ isAllowed: true });
    mocks.updateManifest.mockImplementation(async (_path: string, updater: (m: any) => void) => {
      const manifest: any = {};
      updater(manifest);
    });

    mocks.detect.mockResolvedValue({
      packageManager: 'pnpm',
      usesTurbo: false,
      scripts: { test: true, lint: true, typecheck: true },
      commands: {
        testCmd: 'pnpm -r test',
        lintCmd: 'pnpm -r lint',
        typecheckCmd: 'pnpm -r typecheck',
      },
    });

    mocks.resolveTouchedPackages.mockResolvedValue(new Set(['pkg-a']));
    mocks.generateTargetedCommand.mockImplementation((tc, pkgs, task) => {
      return `pnpm -r --filter ${Array.from(pkgs).join(' ')} ${task}`;
    });

    mockEventBus = { emit: vi.fn() };
    mockMemory = { find: mocks.memoryFind };
    mocks.memoryFind.mockResolvedValue([[], [], []]); // Default to no memory hits

    fsMock.existsSync.mockReturnValue(false);

    runner = new VerificationRunner(mockMemory, mockPolicy, mockUI, mockEventBus, '/app');
  });

  it('runs custom steps when mode is custom', async () => {
    const customProfile: VerificationProfile = {
      ...mockProfile,
      mode: 'custom',
      steps: [{ name: 'custom-1', command: 'echo hello', timeoutMs: 123 }],
    };

    const report = await runner.run(customProfile, 'custom', {}, mockCtx);
    expect(report.commandSources).toEqual({ 'custom-1': { source: 'custom' } });
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'echo hello' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.detect).not.toHaveBeenCalled();
    expect(mocks.memoryFind).not.toHaveBeenCalled();
  });

  it('skips disabled tasks in auto mode', async () => {
    const profile: VerificationProfile = {
      ...mockProfile,
      auto: { ...mockProfile.auto, enableLint: false },
    };

    await runner.run(profile, 'auto', {}, mockCtx);

    const commands = mocks.run.mock.calls.map((c) => c[0]?.command);
    expect(commands).not.toContain('pnpm -r lint');
  });

  it('prefers non-stale, most recently updated memory entries', async () => {
    mocks.memoryFind.mockResolvedValue([
      [
        { content: 'old', stale: true, updatedAt: 10 },
        { content: 'new', stale: false, updatedAt: 20 },
      ],
      [],
      [],
    ]);

    await runner.run(mockProfile, 'auto', {}, mockCtx);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'new' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('writes a failure summary when a check fails', async () => {
    mocks.run.mockImplementation(async ({ command }: any) => {
      const exitCode = String(command).includes('lint') ? 1 : 0;
      return { exitCode, durationMs: 100 };
    });

    const report = await runner.run(mockProfile, 'auto', {}, mockCtx);
    expect(report.passed).toBe(false);
    expect(report.failureSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(report.failureSummary).toBeTruthy();

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('failure_summary_iter_1.json'),
      expect.any(String),
    );
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('failure_summary_iter_1.txt'),
      expect.any(String),
    );
  });

  it('does not mkdir when the runs dir already exists', async () => {
    const runsDir = path.join('/app', '.orchestrator', 'runs', mockCtx.runId);
    fsMock.existsSync.mockImplementation((p: any) => p === runsDir);

    await runner.run(mockProfile, 'auto', {}, mockCtx);
    expect(fs.promises.mkdir).not.toHaveBeenCalled();
  });

  it('runs targeted commands when scope is targeted and files touched', async () => {
    const scope = { touchedFiles: ['packages/a/src/index.ts'] };
    await runner.run(mockProfile, 'auto', scope, mockCtx);
    expect(mocks.resolveTouchedPackages).toHaveBeenCalledWith('/app', scope.touchedFiles);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm -r --filter pkg-a lint' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm -r --filter pkg-a test' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('prefers commands from memory if available and allowed', async () => {
    mocks.memoryFind.mockResolvedValue([
      [{ content: 'memory-test-cmd', stale: false, updatedAt: Date.now() }],
      [{ content: 'memory-lint-cmd', stale: false, updatedAt: Date.now() }],
      [],
    ]);

    await runner.run(mockProfile, 'auto', {}, mockCtx);

    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'memory-lint-cmd' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'memory-test-cmd' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // Falls back for typecheck
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm -r typecheck' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('falls back to detected command if memory command is blocked by policy', async () => {
    mocks.memoryFind.mockResolvedValue([
      [],
      [{ content: 'memory-lint-cmd', stale: false, updatedAt: Date.now() }],
      [],
    ]);
    mocks.checkPolicy.mockImplementation(({ command }) => {
      return { isAllowed: command !== 'memory-lint-cmd' };
    });

    await runner.run(mockProfile, 'auto', {}, mockCtx);

    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm -r lint' }), // fallback
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('falls back to detected command if memory command is stale', async () => {
    mocks.memoryFind.mockResolvedValue([
      [],
      [{ content: 'memory-lint-cmd', stale: true, updatedAt: Date.now() }],
      [],
    ]);

    await runner.run(mockProfile, 'auto', {}, mockCtx);

    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm -r lint' }), // fallback
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('writes command sources to an artifact', async () => {
    mocks.memoryFind.mockResolvedValue([
      [],
      [{ content: 'memory-lint-cmd', stale: false, updatedAt: Date.now() }],
      [],
    ]);

    const report = await runner.run(mockProfile, 'auto', {}, mockCtx);

    expect(report.commandSources).toEqual({
      lint: { source: 'memory' },
      tests: { source: 'detected' },
      typecheck: { source: 'detected' },
    });

    const expectedPath = path.join(
      '/app',
      '.orchestrator',
      'runs',
      mockCtx.runId,
      'verification_command_source.json',
    );

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expectedPath,
      JSON.stringify(report.commandSources, null, 2),
    );
  });

  it('falls back to toolchain commands when targeted command generation returns undefined', async () => {
    mocks.generateTargetedCommand.mockReturnValue(undefined as any);
    const scope = { touchedFiles: ['packages/a/src/index.ts'] };

    await runner.run(mockProfile, 'auto', scope, mockCtx);

    const commands = mocks.run.mock.calls.map((c) => c[0]?.command);
    expect(commands).toContain('pnpm -r lint');
    expect(commands).toContain('pnpm -r test');
    expect(commands).toContain('pnpm -r typecheck');
  });

  it('adds a fallback reason when a memory command is empty but allowed', async () => {
    mocks.memoryFind.mockResolvedValue([
      [],
      [{ content: '', stale: false, updatedAt: Date.now() }],
      [],
    ]);
    mocks.checkPolicy.mockReturnValue({ isAllowed: true });

    const report = await runner.run(mockProfile, 'auto', {}, mockCtx);
    expect(report.commandSources.lint.source).toBe('memory');
    expect(report.commandSources.lint.fallbackReason).toContain('Falling back to detected command');
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm -r lint' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('skips a task when neither memory nor detected command is available', async () => {
    mocks.detect.mockResolvedValue({
      packageManager: 'pnpm',
      usesTurbo: false,
      scripts: { test: true, lint: true, typecheck: true },
      commands: {
        testCmd: 'pnpm -r test',
        lintCmd: 'pnpm -r lint',
        typecheckCmd: undefined,
      },
    });

    const report = await runner.run(mockProfile, 'auto', {}, mockCtx);
    expect(report.commandSources.typecheck).toBeUndefined();

    const commands = mocks.run.mock.calls.map((c) => c[0]?.command);
    expect(commands).not.toContain('pnpm -r typecheck');
  });

  it('does not mkdir for failure summary when the runs dir already exists', async () => {
    const runsDir = path.join('/app', '.orchestrator', 'runs', mockCtx.runId);
    fsMock.existsSync.mockImplementation((p: any) => p === runsDir);

    mocks.run.mockImplementation(async ({ command }: any) => {
      const exitCode = String(command).includes('lint') ? 1 : 0;
      return { exitCode, durationMs: 100 };
    });

    await runner.run(mockProfile, 'auto', {}, mockCtx);
    expect(fs.promises.mkdir).not.toHaveBeenCalled();
  });

  it('generates an empty failure signature when no checks failed', async () => {
    const signature = await (runner as any).generateFailureSignature([
      { name: 'lint', passed: true },
      { name: 'tests', passed: true },
    ]);
    expect(signature).toBe('');
  });
});
