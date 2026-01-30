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
      process.cwd(),
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
});
