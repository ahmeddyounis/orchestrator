import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { Config } from '@orchestrator/shared';
import { createRunDir, writeManifest, JsonlLogger } from '@orchestrator/shared';
import { RepoScanner, SearchService, PatchApplier, GitService } from '@orchestrator/repo';
import { PatchStore } from './exec/patch_store';
import fs from 'fs/promises';

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

describe('Orchestrator', () => {
    let orchestrator: Orchestrator;
    const mockGit = {};
    const mockRegistry = {
        getProvider: vi.fn(),
    };
    const config: Config = {
        configVersion: 1,
        defaults: { executor: 'mock' },
        patch: {},
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

        mockRegistry.getProvider.mockResolvedValue({
            generate: vi.fn().mockResolvedValue({
                text: 'BEGIN_DIFF\ndiff --git a/test.ts b/test.ts\nEND_DIFF'
            })
        });

        // Reset prototypes if needed, but vi.fn() mocks persist.
        // We can access instances by spying on the class constructor or checking invocations.
        
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
        expect(mockRegistry.getProvider).toHaveBeenCalledWith('mock', 'executor');
        
        // Verify artifact writing
        expect(fs.writeFile).toHaveBeenCalledWith(
            expect.stringContaining('executor_output.txt'),
            expect.any(String)
        );

        // Verify patch store
        expect(PatchStore).toHaveBeenCalled();

        // Verify application
        expect(PatchApplier).toHaveBeenCalled();
        
        // Verify manifest
        expect(writeManifest).toHaveBeenCalled();
    });

    it('should search when keywords are present', async () => {
        const goal = 'update user profile controller';
        await orchestrator.runL0(goal, runId);
        
        // Verify search service called
        // Since we mock the class, we can check if prototype method was called
        // But better to check instances.
        
        const searchInstances = (SearchService as unknown as ReturnType<typeof vi.fn>).mock.instances;
        expect(searchInstances.length).toBeGreaterThan(0);
        const searchInstance = searchInstances[0];
        expect(searchInstance.search).toHaveBeenCalled();
    });

    it('should fail if executor returns invalid output', async () => {
        mockRegistry.getProvider.mockResolvedValue({
            generate: vi.fn().mockResolvedValue({
                text: 'No diff here'
            })
        });

        await expect(orchestrator.runL0('goal', runId)).rejects.toThrow('Failed to extract diff');
    });
});