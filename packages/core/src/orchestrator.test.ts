import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { Config, ConfigSchema } from '@orchestrator/shared';
import { createRunDir, writeManifest, JsonlLogger } from '@orchestrator/shared';
import { RepoScanner, SearchService, PatchApplier, GitService } from '@orchestrator/repo';
import { MemoryWriter } from './memory';
import { PatchStore } from './exec/patch_store';
import { ExecutionService } from './exec/service';
import fs from 'fs/promises';
import * as fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mocks
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
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
    updateManifest: vi.fn(),
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
    .mockResolvedValue({ applied: true, filesChanged: [] });

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
  MockPatchStore.prototype.saveSelected = vi.fn();
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

vi.mock('@orchestrator/memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/memory')>();
  const mockStore = {
    init: vi.fn(),
    search: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  };
  return {
    ...actual,
    createMemoryStore: vi.fn(() => mockStore),
  };
});

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  const mockGit = {
    getHeadSha: vi.fn().mockResolvedValue('HEAD'),
    diff: vi.fn().mockResolvedValue(''),
  };
  const mockRegistry = {
    getAdapter: vi.fn(),
    resolveRoleProviders: vi.fn(),
  };
  const memory = ConfigSchema.parse({}).memory;
  const config: Config = {
    verification: {} as any,
    configVersion: 1,
    thinkLevel: 'L0',
    memory,
    defaults: { executor: 'mock' },
    patch: {
      maxFilesChanged: 10,
      maxLinesChanged: 100,
      allowBinary: false,
    },
  };
  const repoRoot = '/test/repo';
  const runId = 'test-run';

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

    orchestrator = new Orchestrator({
      config,
      git: mockGit as unknown as GitService,
      registry: mockRegistry as unknown as ProviderRegistry,
      repoRoot,
    });
  });

  it('should run L0 successfully', async () => {
    await orchestrator.runL0('simple goal', runId);

    // Verify setup
    expect(createRunDir).toHaveBeenCalledWith(repoRoot, runId);
    expect(JsonlLogger).toHaveBeenCalled();

    // Verify scanning
    expect(RepoScanner).toHaveBeenCalled();
    expect(SearchService).toHaveBeenCalled();

    // Verify execution
    expect(mockRegistry.getAdapter).toHaveBeenCalledWith('mock');

    // Verify artifact writing
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('executor_output.txt'),
      expect.any(String),
    );

    // Verify patch store
    expect(PatchStore).toHaveBeenCalled();

    // Verify application
    expect(PatchApplier).toHaveBeenCalled();

    // Verify manifest
    expect(writeManifest).toHaveBeenCalled();
  });

  it('should write episodic memory when enabled', async () => {
    const spy = vi.spyOn(MemoryWriter.prototype, 'extractEpisodic').mockResolvedValue({} as any);

    orchestrator = new Orchestrator({
      config: {
        ...config,
        memory: {
          ...ConfigSchema.parse({}).memory,
          enabled: true,
          writePolicy: {
            ...ConfigSchema.parse({}).memory.writePolicy,
            enabled: true,
            storeEpisodes: true,
          },
          storage: {
            ...ConfigSchema.parse({}).memory.storage,
            path: '/tmp/memory.sqlite',
          },
        },
      },
      git: mockGit as unknown as GitService,
      registry: mockRegistry as unknown as ProviderRegistry,
      repoRoot,
    });

    await orchestrator.runL0('simple goal', runId);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should run L1 successfully', async () => {
    await orchestrator.runL1('complex goal', runId);

    expect(createRunDir).toHaveBeenCalledWith(repoRoot, runId);
    expect(mockRegistry.resolveRoleProviders).toHaveBeenCalled();
    // PlanService and ExecutionService are mocked, so we assume they are called if runL1 completes without error.
    expect(ExecutionService).toHaveBeenCalled();
  });

  it('should search when keywords are present', async () => {
    const goal = 'update user profile controller';
    await orchestrator.runL0(goal, runId);

    // Verify search service called
    const searchInstances = (SearchService as unknown as ReturnType<typeof vi.fn>).mock.instances;
    expect(searchInstances.length).toBeGreaterThan(0);
    const searchInstance = searchInstances[0];
    expect(searchInstance.search).toHaveBeenCalled();
  });

  it('should fail if executor returns invalid output', async () => {
    mockRegistry.getAdapter.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        text: 'No diff here',
      }),
    });

    const result = await orchestrator.runL0('goal', runId);
    expect(result.status).toBe('failure');
    expect(result.summary).toContain('Failed to extract diff');
  });

  it('should stop runL1 if iteration budget exceeded', async () => {
    orchestrator = new Orchestrator({
      config: { ...config, budget: { iter: 0 } },
      git: mockGit as unknown as GitService,
      registry: mockRegistry as unknown as ProviderRegistry,
      repoRoot,
    });

    const result = await orchestrator.runL1('goal', runId);
    expect(result.status).toBe('failure');
    expect(result.stopReason).toBe('budget_exceeded');
    expect(result.summary).toContain('Iteration budget exceeded');
  });

  it('should stop runL1 if executor produces invalid output consecutively', async () => {
    mockRegistry.resolveRoleProviders.mockResolvedValue({
      planner: { generate: vi.fn() },
      executor: {
        generate: vi
          .fn()
          .mockResolvedValueOnce({ text: 'Bad output 1' })
          .mockResolvedValueOnce({ text: 'Bad output 2' }),
      },
      reviewer: {},
    });

    const result = await orchestrator.runL1('goal', runId);

    expect(result.status).toBe('failure');
    expect(result.stopReason).toBe('invalid_output');
    expect(result.summary).toContain('twice consecutively');
  });

  it('should stop runL1 if patch application fails repeatedly with same error', async () => {
    mockRegistry.resolveRoleProviders.mockResolvedValue({
      planner: { generate: vi.fn() },
      executor: {
        generate: vi.fn().mockResolvedValue({ text: 'BEGIN_DIFF\ndiff...\nEND_DIFF' }),
      },
      reviewer: {},
    });

    (ExecutionService as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        applyPatch: vi.fn().mockResolvedValue({ success: false, error: 'Same Error' }),
      };
    });

    const result = await orchestrator.runL1('goal', runId);

    expect(result.status).toBe('failure');
    expect(result.stopReason).toBe('repeated_failure');
    expect(result.summary).toContain('Repeated patch apply failure');
  });

  it('should include file context in L1 retry prompt when a hunk fails', async () => {
    const tempRepoRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-test-'));
    try {
      fsSync.mkdirSync(path.join(tempRepoRoot, 'src'), { recursive: true });
      fsSync.writeFileSync(
        path.join(tempRepoRoot, 'src', 'foo.ts'),
        ['line 1', 'line 2', 'line 3', 'line 4', 'TARGET_LINE', 'line 6', 'line 7'].join('\n'),
        'utf-8',
      );
      fsSync.writeFileSync(
        path.join(tempRepoRoot, 'src', 'bar.ts'),
        ['bar 1', 'bar 2', 'BAR_TARGET', 'bar 4'].join('\n'),
        'utf-8',
      );

      const executorGenerate = vi
        .fn()
        .mockResolvedValue({ text: 'BEGIN_DIFF\ndiff --git a/a b/b\nEND_DIFF' });
      mockRegistry.resolveRoleProviders.mockResolvedValue({
        planner: { generate: vi.fn() },
        executor: { generate: executorGenerate },
        reviewer: {},
      });

      const patchError = {
        type: 'execution',
        message: 'git apply failed with code 1',
        details: {
          errors: [
            {
              kind: 'HUNK_FAILED',
              file: 'src/foo.ts',
              line: 5,
              message: 'Hunk failed at line 5',
            },
            {
              kind: 'HUNK_FAILED',
              file: 'src/bar.ts',
              line: 3,
              message: 'Hunk failed at line 3',
            },
          ],
        },
      } as any;

      (ExecutionService as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
        return {
          applyPatch: vi
            .fn()
            .mockResolvedValueOnce({ success: false, error: 'Same Error', patchError })
            .mockResolvedValueOnce({ success: false, error: 'Same Error', patchError }),
        };
      });

      const localOrchestrator = new Orchestrator({
        config,
        git: mockGit as unknown as GitService,
        registry: mockRegistry as unknown as ProviderRegistry,
        repoRoot: tempRepoRoot,
      });

      const result = await localOrchestrator.runL1('goal', runId);
      expect(result.status).toBe('failure');

      expect(executorGenerate).toHaveBeenCalledTimes(2);
      const secondSystemPrompt = executorGenerate.mock.calls[1][0].messages[0].content;
      expect(secondSystemPrompt).toContain('CURRENT FILE CONTEXT');
      expect(secondSystemPrompt).toContain('File: src/foo.ts:5');
      expect(secondSystemPrompt).toContain('TARGET_LINE');
      expect(secondSystemPrompt).toContain('File: src/bar.ts:3');
      expect(secondSystemPrompt).toContain('BAR_TARGET');
    } finally {
      fsSync.rmSync(tempRepoRoot, { recursive: true, force: true });
    }
  });

  it('should include memory hits in L1 prompt', async () => {
    const { createMemoryStore } = await import('@orchestrator/memory');
    const mockMemoryStore = {
      init: vi.fn(),
      search: vi.fn().mockReturnValue([
        {
          id: 'mem1',
          type: 'procedural',
          title: 'How to do X',
          content: 'Run command Y',
          stale: false,
          lexicalScore: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]),
      get: vi.fn().mockImplementation((id: string) => {
        if (id !== 'mem1') return null;
        return {
          id: 'mem1',
          repoId: repoRoot,
          type: 'procedural',
          title: 'How to do X',
          content: 'Run command Y',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }),
      close: vi.fn(),
    };
    (createMemoryStore as ReturnType<typeof vi.fn>).mockReturnValue(mockMemoryStore);

    const memConfig: Config['memory'] = {
      enabled: true,
      retrieval: {
        mode: 'lexical',
        topKLexical: 5,
        topKVector: 5,
        staleDownrank: true,
      },
      maxChars: 2000,
      storage: {
        path: '/test/repo/.orchestrator/memory.sqlite',
        backend: 'sqlite',
        encryptAtRest: false,
      },
      scope: 'repo',
      writePolicy: {
        enabled: false,
        storeEpisodes: false,
        storeProcedures: false,
        requireEvidence: true,
        redactSecrets: true,
      },
    };

    orchestrator = new Orchestrator({
      config: { ...config, memory: memConfig },
      git: mockGit as unknown as GitService,
      registry: mockRegistry as unknown as ProviderRegistry,
      repoRoot,
    });

    const executorGenerate = vi.fn().mockResolvedValue({ text: 'BEGIN_DIFF\ndiff...\nEND_DIFF' });
    mockRegistry.resolveRoleProviders.mockResolvedValue({
      planner: { generate: vi.fn() },
      executor: { generate: executorGenerate },
      reviewer: {},
    });

    await orchestrator.runL1('goal that matches memory', runId);

    expect(mockMemoryStore.search).toHaveBeenCalledWith(
      repoRoot,
      'goal that matches memory step 1',
      {
        topK: 5,
      },
    );

    const systemPrompt = executorGenerate.mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain('MEMORY:\n--------------------');
    expect(systemPrompt).toContain('// MEMORY ID: mem1 (procedural)');
    expect(systemPrompt).toContain('// How to do X\nRun command Y');

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/run/memory_hits_step_0.json',
      expect.any(String),
    );
  });
});
