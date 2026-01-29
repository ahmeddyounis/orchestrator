import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { Config } from '@orchestrator/shared';
import { createRunDir, writeManifest } from '@orchestrator/shared';
import { GitService, SnippetExtractor, SimpleContextPacker } from '@orchestrator/repo';
import fs from 'fs/promises';
import path from 'path';

// Mocks
vi.mock('fs/promises', () => ({
    default: {
        writeFile: vi.fn(),
    }
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
    MockPatchApplier.prototype.applyUnifiedDiff = vi.fn().mockResolvedValue({ applied: true, filesChanged: [] });

    const MockSnippetExtractor = vi.fn();
    MockSnippetExtractor.prototype.extractSnippets = vi.fn().mockResolvedValue([]);

    const MockSimpleContextPacker = vi.fn();
    MockSimpleContextPacker.prototype.pack = vi.fn().mockReturnValue({
        items: [],
        totalChars: 0,
        estimatedTokens: 0
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
        PlanService: MockPlanService
    };
});

vi.mock('./exec/service', () => {
    const MockExecutionService = vi.fn();
    MockExecutionService.prototype.applyPatch = vi.fn().mockResolvedValue({ success: true, filesChanged: ['file.ts'] });
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
    const config: Config = {
        configVersion: 1,
        thinkLevel: 'L1',
        defaults: { executor: 'mock' },
        context: {
            tokenBudget: 1000
        }
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
            reviewer: {}
        });

        orchestrator = new Orchestrator({
            config,
            git: mockGit as unknown as GitService,
            registry: mockRegistry as unknown as ProviderRegistry,
            repoRoot,
        });
    });

    it('should generate, save, and use context pack in L1 run', async () => {
        // Setup mock context pack
        const mockContextPack = {
            items: [
                {
                    path: 'src/file.ts',
                    startLine: 10,
                    endLine: 20,
                    content: 'function test() {}',
                    score: 10,
                    reason: 'Relevant keyword match'
                }
            ],
            totalChars: 100,
            estimatedTokens: 25
        };

        (SimpleContextPacker as unknown as ReturnType<typeof vi.fn>).prototype.pack.mockReturnValue(mockContextPack);

        await orchestrator.runL1('some goal', runId);

        // 1. Verify ContextPacker was used
        expect(SimpleContextPacker).toHaveBeenCalled();
        expect(SnippetExtractor).toHaveBeenCalled();

        // 2. Verify Artifacts were saved
        // We expect a call to fs.writeFile with the context pack JSON
        const expectedPackPath = path.join('/tmp/run', 'context_pack_step_0_step_1.json');
        expect(fs.writeFile).toHaveBeenCalledWith(
            expectedPackPath,
            JSON.stringify(mockContextPack, null, 2)
        );

        // Expect TXT artifact
        const expectedTxtPath = path.join('/tmp/run', 'context_pack_step_0_step_1.txt');
        expect(fs.writeFile).toHaveBeenCalledWith(
            expectedTxtPath,
            expect.stringContaining('Context Rationale:')
        );

        // 3. Verify Prompt contains rationale and headers
        const executor = (await mockRegistry.resolveRoleProviders()).executor;
        const generateCall = (executor.generate as ReturnType<typeof vi.fn>).mock.calls[0];
        const messages = generateCall[0].messages;
        const systemPrompt = messages[0].content;

        expect(systemPrompt).toContain('Context Rationale:');
        expect(systemPrompt).toContain('- src/file.ts:10-20 (Score: 10.00): Relevant keyword match');
        expect(systemPrompt).toContain('File: src/file.ts (Lines 10-20)');
        expect(systemPrompt).toContain('function test() {}');

        // 4. Verify Manifest includes context path
        expect(writeManifest).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                contextPaths: expect.arrayContaining([expectedPackPath])
            })
        );
    });
});
