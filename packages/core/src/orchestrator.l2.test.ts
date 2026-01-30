import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { Config, ConfigSchema } from '@orchestrator/shared';
import { createRunDir, writeManifest, JsonlLogger } from '@orchestrator/shared';
import { RepoScanner, SearchService, PatchApplier, GitService } from '@orchestrator/repo';
import { PatchStore } from './exec/patch_store';
import { ExecutionService } from './exec/service';
import { UserInterface } from '@orchestrator/exec';
import { VerificationRunner } from './verify/runner';
import fs from 'fs/promises';

// Mocks
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    readFile: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('@orchestrator/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/shared')>();
  const MockJsonlLogger = vi.fn();
  MockJsonlLogger.prototype.log = vi.fn();
  return {
    ...actual,
    createRunDir: vi.fn(),
    writeManifest: vi.fn(),
    JsonlLogger: MockJsonlLogger,
  };
});

vi.mock('@orchestrator/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/repo')>();

  const MockRepoScanner = vi.fn();
  MockRepoScanner.prototype.scan = vi.fn().mockResolvedValue({ files: [] });

  const MockSearchService = vi.fn();
  MockSearchService.prototype.on = vi.fn();
  MockSearchService.prototype.search = vi.fn().mockResolvedValue({ matches: [] });

  const MockPatchApplier = vi.fn();
  MockPatchApplier.prototype.applyUnifiedDiff = vi
    .fn()
    .mockResolvedValue({ applied: true, filesChanged: ['test.ts'] });

  return {
    ...actual,
    GitService: vi.fn(),
    RepoScanner: MockRepoScanner,
    SearchService: MockSearchService,
    PatchApplier: MockPatchApplier,
  };
});

vi.mock('./exec/patch_store', () => {
  const MockPatchStore = vi.fn();
  MockPatchStore.prototype.saveSelected = vi.fn().mockResolvedValue('/path/to/patch');
  MockPatchStore.prototype.saveFinalDiff = vi.fn();
  return {
    PatchStore: MockPatchStore,
  };
});

vi.mock('./plan/service', () => {
  const MockPlanService = vi.fn();
  MockPlanService.prototype.generatePlan = vi.fn().mockResolvedValue(['step 1']);
  return {
    PlanService: MockPlanService,
  };
});

vi.mock('./exec/service', () => {
  const MockExecutionService = vi.fn();
  MockExecutionService.prototype.applyPatch = vi
    .fn()
    .mockResolvedValue({ success: true, filesChanged: ['file.ts'] });
  return {
    ExecutionService: MockExecutionService,
  };
});

vi.mock('./verify/runner', () => {
  const MockVerificationRunner = vi.fn();
  MockVerificationRunner.prototype.run = vi.fn();
  return {
    VerificationRunner: MockVerificationRunner,
  };
});

describe('Orchestrator L2', () => {
  let orchestrator: Orchestrator;
  const mockGit = {};
  const mockRegistry = {
    getAdapter: vi.fn(),
    resolveRoleProviders: vi.fn(),
  };
  const mockUI = {
    confirm: vi.fn().mockResolvedValue(true),
  } as unknown as UserInterface;

  const mockToolPolicy = {
    enabled: true,
    requireConfirmation: false,
    allowlistPrefixes: [],
    denylistPatterns: [],
    allowNetwork: false,
    maxOutputBytes: 1000,
    timeoutMs: 1000,
  };

  const memory = ConfigSchema.parse({}).memory;
  const config: Config = {
    verification: {
      enabled: true,
      mode: 'auto',
      steps: [],
      auto: {
        enableLint: true,
        enableTypecheck: true,
        enableTests: true,
        testScope: 'targeted',
        maxCommandsPerIteration: 3,
      },
    },
    configVersion: 1,
    thinkLevel: 'L2',
    memory,
    defaults: { executor: 'mock' },
    patch: {
      maxFilesChanged: 10,
      maxLinesChanged: 100,
      allowBinary: false,
    },
  };
  const repoRoot = '/test/repo';
  const runId = 'test-run-l2';

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    (createRunDir as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      root: '/tmp/run',
      trace: '/tmp/run/trace.jsonl',
      summary: '/tmp/run/summary.json',
      manifest: '/tmp/run/manifest.json',
      patchesDir: '/tmp/run/patches',
    });

    mockRegistry.getAdapter.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        text: 'BEGIN_DIFF\ndiff --git a/test.ts b/test.ts\nEND_DIFF',
      }),
      capabilities: () => ({}),
    });

    mockRegistry.resolveRoleProviders.mockResolvedValue({
      planner: { generate: vi.fn() },
      executor: { generate: vi.fn().mockResolvedValue({ text: 'BEGIN_DIFF\ndiff...\nEND_DIFF' }) },
      reviewer: {},
    });

    // Reset ExecutionService mock
    (ExecutionService as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        applyPatch: vi.fn().mockResolvedValue({ success: true, filesChanged: ['file.ts'] }),
      };
    });

    // Default verification: pass
    (VerificationRunner as unknown as ReturnType<typeof vi.fn>).prototype.run.mockResolvedValue({
      passed: true,
      checks: [],
      summary: 'Verification Passed',
    });

    orchestrator = new Orchestrator({
      config,
      git: mockGit as unknown as GitService,
      registry: mockRegistry as unknown as ProviderRegistry,
      repoRoot,
      ui: mockUI,
      toolPolicy: mockToolPolicy,
    });
  });

  it('should run L2 successfully when verification passes immediately', async () => {
    const result = await orchestrator.runL2('goal', runId);

    expect(result.status).toBe('success');
    expect(result.summary).toContain('L2 Verified Success');
    
    expect(result.verification).toBeDefined();
    expect(result.verification?.enabled).toBe(true);
    expect(result.verification?.passed).toBe(true);
    expect(result.verification?.summary).toBe('Verification Passed');
    expect(result.verification?.reportPaths).toHaveLength(1);

    // Check verification run was called once
    const runnerMock = (VerificationRunner as unknown as ReturnType<typeof vi.fn>).prototype.run;
    expect(runnerMock).toHaveBeenCalledTimes(1);
  });

  it('should verify and repair if initial verification fails', async () => {
    // Setup verification to fail first, then pass
    const runnerMock = (VerificationRunner as unknown as ReturnType<typeof vi.fn>).prototype.run;

    runnerMock
      .mockResolvedValueOnce({
        passed: false,
        checks: [{ name: 'test', passed: false, command: 'npm test' }],
        summary: 'Verification Failed',
        failureSignature: 'sig1',
      })
      .mockResolvedValueOnce({
        passed: true,
        checks: [],
        summary: 'Verification Passed',
      });

    const result = await orchestrator.runL2('goal', runId);

    expect(result.status).toBe('success');
    expect(result.summary).toContain('L2 Verified Success after 1 iterations');
    expect(runnerMock).toHaveBeenCalledTimes(2);

    // Verify Executor was called for repair
    expect(mockRegistry.getAdapter).toHaveBeenCalled(); // L1 calls executor too, but L2 repair loop calls it again.
    // L1 (mocked) calls executor for step.
    // L2 repair loop calls executor for repair.
    // Total should be >= 2 calls to generate (L1 + Repair) if mocks align.
  });

  it('should stop if verification keeps failing with same signature', async () => {
    const runnerMock = (VerificationRunner as unknown as ReturnType<typeof vi.fn>).prototype.run;

    runnerMock.mockResolvedValue({
      passed: false,
      checks: [{ name: 'test', passed: false, command: 'npm test' }],
      summary: 'Verification Failed',
      failureSignature: 'sig1',
    });

    const result = await orchestrator.runL2('goal', runId);

    expect(result.status).toBe('failure');
    expect(result.stopReason).toBe('non_improving');
    
    expect(result.verification).toBeDefined();
    expect(result.verification?.enabled).toBe(true);
    expect(result.verification?.passed).toBe(false);
    expect(result.verification?.failedChecks).toContain('test');
    
    // Iterations:
    // 0: Initial fail (sig1)
    // 1: Repair 1 fail (sig1) -> consecutive=1
    // 2: Repair 2 fail (sig1) -> consecutive=2 -> Stop
    // run calls: Initial, then Iter 1 verify (after repair), then Iter 2 verify (after repair)
    // Actually:
    // Initial verification: fail (sig1)
    // Loop Iter 1:
    //   Repair
    //   Verify: fail (sig1) -> checks vs 'sig1'. consecutive=1.
    // Loop Iter 2:
    //   Repair
    //   Verify: fail (sig1) -> checks vs 'sig1'. consecutive=2. -> Stop.

    // Wait, verification is checked at TOP of loop? No, signature check is top of loop.
    // Initial: verification set.
    // Loop 1 start: check signature. verification.sig vs failureSignature (initial).
    // They match. consecutive=1.
    // ... Repair ...
    // Verify again (updates verification).

    // Loop 2 start: check signature.
    // Match. consecutive=2. -> STOP.

    // So it stops at start of Iteration 2.
    // Total verify calls: Initial + Iter 1 verify.
    // Wait, does Iter 1 verify happen? Yes.

    expect(runnerMock).toHaveBeenCalledTimes(2);
  });
});
