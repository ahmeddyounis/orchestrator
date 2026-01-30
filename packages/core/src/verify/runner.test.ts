import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationRunner } from './runner';
import { VerificationProfile } from './types';

// Hoist mocks to ensure they are available in factory
const mocks = vi.hoisted(() => {
  return {
    detect: vi.fn(),
    resolveTouchedPackages: vi.fn(),
    generateTargetedCommand: vi.fn(),
    run: vi.fn(),
  };
});

vi.mock('@orchestrator/repo', () => {
  return {
    ToolchainDetector: class {
      detect = mocks.detect;
    },
    TargetingManager: class {
      resolveTouchedPackages = mocks.resolveTouchedPackages;
      generateTargetedCommand = mocks.generateTargetedCommand;
    },
  };
});

vi.mock('@orchestrator/exec', () => {
  return {
    SafeCommandRunner: class {
      run = mocks.run;
    },
    UserInterface: class {},
    RunnerContext: class {},
  };
});

describe('VerificationRunner', () => {
  let runner: VerificationRunner;
  let mockEventBus: any;

  const mockProfile: VerificationProfile = {
    enabled: true,
    mode: 'auto',
    steps: [],
    auto: {
      enableLint: true,
      enableTests: true,
      enableTypecheck: true,
      testScope: 'targeted',
      maxCommandsPerIteration: 1,
    },
  };

  const mockCtx: any = { runId: 'test-run' };
  const mockUI: any = {};
  const mockPolicy: any = {};

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.run.mockResolvedValue({ exitCode: 0, durationMs: 100 });

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

    runner = new VerificationRunner(mockPolicy, mockUI, mockEventBus, '/app');
  });

  it('runs targeted commands when scope is targeted and files touched', async () => {
    const scope = { touchedFiles: ['packages/a/src/index.ts'] };

    await runner.run(mockProfile, 'auto', scope, mockCtx);

    // Verify resolveTouchedPackages called
    expect(mocks.resolveTouchedPackages).toHaveBeenCalledWith('/app', scope.touchedFiles);

    // Verify runner executed targeted commands
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'pnpm -r --filter pkg-a lint',
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'pnpm -r --filter pkg-a test',
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('falls back to root commands if targeting returns null', async () => {
    mocks.generateTargetedCommand.mockReturnValue(null);
    const scope = { touchedFiles: ['packages/a/src/index.ts'] };

    await runner.run(mockProfile, 'auto', scope, mockCtx);

    // Should run root commands from toolchain
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'pnpm -r lint',
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('does not use targeting if scope is not targeted', async () => {
    const fullProfile = {
      ...mockProfile,
      auto: { ...mockProfile.auto, testScope: 'full' as const },
    };
    const scope = { touchedFiles: ['packages/a/src/index.ts'] };

    await runner.run(fullProfile, 'auto', scope, mockCtx);

    expect(mocks.resolveTouchedPackages).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'pnpm -r lint',
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
