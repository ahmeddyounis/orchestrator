import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { Config, ConfigSchema } from '@orchestrator/shared';
import { createRunDir, writeManifest } from '@orchestrator/shared';
import { GitService, SnippetExtractor, SimpleContextPacker } from '@orchestrator/repo';
import fs from 'fs/promises';
import path from 'path';

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

  const MockSnippetExtractor = vi.fn();
  MockSnippetExtractor.prototype.extractSnippets = vi.fn().mockResolvedValue([]);

  const MockSimpleContextPacker = vi.fn();
  MockSimpleContextPacker.prototype.pack = vi.fn().mockReturnValue({
    items: [],
    totalChars: 0,
    estimatedTokens: 0,
  });

  return {
    ...actual,
    GitService: vi.fn(),
    RepoScanner: MockRepoScanner,
    SearchService: MockSearchService,
    PatchApplier: MockPatchApplier,
    SnippetExtractor: MockSnippetExtractor,
    SimpleContextPacker: MockSimpleContextPacker,
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

describe('Orchestrator Context Integration', () => {
  let orchestrator: Orchestrator;
  const mockGit = {};
  const mockRegistry = {
    getAdapter: vi.fn(),
    resolveRoleProviders: vi.fn(),
  };
  const memory = ConfigSchema.parse({}).memory;
  const config: Config = {
    verification: {} as any,
    configVersion: 1,
    thinkLevel: 'L1',
    memory,
    defaults: { executor: 'mock' },
    context: {
      tokenBudget: 1000,
    },
  };
  const repoRoot = '/test/repo';
  const runId = 'test-run-context';

  beforeEach(() => {
    vi.clearAllMocks();

    (createRunDir as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      root: '/tmp/run',
      trace: '/tmp/run/trace.jsonl',
      summary: '/tmp/run/summary.json',
      manifest: '/tmp/run/manifest.json',
      patchesDir: '/tmp/run/patches',
    });

    mockRegistry.resolveRoleProviders.mockResolvedValue({
      planner: { generate: vi.fn() },
      executor: { generate: vi.fn().mockResolvedValue({ text: 'BEGIN_DIFF\ndiff...\nEND_DIFF' }) },
      reviewer: {},
    });

    orchestrator = new Orchestrator({
      config,
      git: mockGit as unknown as GitService,
      registry: mockRegistry as unknown as ProviderRegistry,
      repoRoot,
    });
  });

  it('should generate, save, and use fused context in L1 run', async () => {
    // Setup mock context pack
    const mockContextPack = {
      items: [
        {
          path: 'src/file.ts',
          startLine: 10,
          endLine: 20,
          content: 'function test() {}',
          score: 10,
          reason: 'Relevant keyword match',
        },
      ],
      totalChars: 100,
      estimatedTokens: 25,
    };

    (SimpleContextPacker as unknown as ReturnType<typeof vi.fn>).prototype.pack.mockReturnValue(
      mockContextPack,
    );

    await orchestrator.runL1('some goal', runId);

    // 1. Verify ContextPacker was used to get repo context
    expect(SimpleContextPacker).toHaveBeenCalled();
    expect(SnippetExtractor).toHaveBeenCalled();

    // 2. Verify Fused Artifacts were saved
    const expectedJsonPath = path.join('/tmp/run', 'fused_context_step_0_step_1.json');
    const expectedTxtPath = path.join('/tmp/run', 'fused_context_step_0_step_1.txt');

    const writeFileCalls = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls;

    const jsonCall = writeFileCalls.find((call) => call[0] === expectedJsonPath);
    expect(jsonCall).toBeDefined();
    const writtenMetadata = JSON.parse(jsonCall[1]);
    expect(writtenMetadata.repoItems[0].path).toBe('src/file.ts');
    expect(writtenMetadata.repoItems[0].truncated).toBe(false);

    const txtCall = writeFileCalls.find((call) => call[0] === expectedTxtPath);
    expect(txtCall).toBeDefined();
    const writtenPrompt = txtCall[1];

    // 3. Verify Prompt contains fused context
    expect(writtenPrompt).toContain('GOAL: Goal: some goal');
    expect(writtenPrompt).toContain('REPO CONTEXT:');
    expect(writtenPrompt).toContain('// src/file.ts:10');
    expect(writtenPrompt).toContain('function test() {}');

    const executor = (await mockRegistry.resolveRoleProviders()).executor;
    const generateCall = (executor.generate as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = generateCall[0].messages;
    const systemPrompt = messages[0].content;
    expect(systemPrompt).toContain(writtenPrompt);

    // 4. Verify Manifest includes context paths
    const manifestCalls = (writeManifest as ReturnType<typeof vi.fn>).mock.calls;
    const lastManifestCall = manifestCalls[manifestCalls.length - 1];

    expect(lastManifestCall).toBeDefined();
    expect(lastManifestCall[1].contextPaths).toEqual(
      expect.arrayContaining([expectedJsonPath, expectedTxtPath]),
    );
  });
});
