import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandidateGenerator, StepContext } from './candidate_generator';
import type { ProviderAdapter } from '@orchestrator/adapters';
import type { EventBus, Logger } from '@orchestrator/shared';
import type { CostTracker } from '../../cost/tracker';
import type { FusedContext } from '../../context';
import * as fs from 'fs/promises';

vi.mock('fs/promises');
vi.mock('../../exec/patch_store', () => ({
  PatchStore: class {
    saveCandidate = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('CandidateGenerator', () => {
  const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
  } as unknown as EventBus;

  const mockLogger = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => mockLogger,
  } as unknown as Logger;

  const mockCostTracker = {
    getSummary: vi.fn().mockReturnValue({ total: { estimatedCostUsd: 0 } }),
  } as unknown as CostTracker;

  const mockFusedContext: FusedContext = {
    prompt: 'Test context for generation',
    sources: [],
  };

  let mockExecutor: ProviderAdapter;
  let mockReviewer: ProviderAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    mockExecutor = {
      generate: vi.fn(),
      id: () => 'mock-executor',
      capabilities: () => ({ supportsStreaming: false, supportsToolCalling: false }),
    } as unknown as ProviderAdapter;

    mockReviewer = {
      generate: vi.fn(),
      id: () => 'mock-reviewer',
      capabilities: () => ({ supportsStreaming: false, supportsToolCalling: false }),
    } as unknown as ProviderAdapter;
  });

  it('should generate candidates with valid patches', async () => {
    const generator = new CandidateGenerator();

    const mockResponse = {
      text: `
<BEGIN_DIFF>
diff --git a/src/file.ts b/src/file.ts
index 1234567..abcdefg 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
+import { newDep } from 'dep';
 const x = 1;
 const y = 2;
<END_DIFF>
`,
    };

    (mockExecutor.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const stepContext: StepContext = {
      runId: 'test-run',
      goal: 'Test goal',
      step: 'Test step',
      stepIndex: 0,
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      executor: mockExecutor,
      reviewer: mockReviewer,
      artifactsRoot: '/tmp/artifacts',
      budget: {} as any,
      logger: mockLogger,
    };

    const candidates = await generator.generateCandidates(stepContext, 1);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        index: 0,
        valid: true,
        providerId: 'mock-executor',
        patchStats: { filesChanged: 1, linesAdded: 1, linesDeleted: 0 },
      }),
    );
    expect(candidates[0]?.patch).toContain('diff --git a/src/file.ts b/src/file.ts');

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/artifacts/patches/iter_0_candidate_0_raw.txt',
      mockResponse.text,
    );

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CandidateGenerated',
        payload: expect.objectContaining({
          iteration: 0,
          candidateIndex: 0,
          valid: true,
          providerId: 'mock-executor',
          patchStats: { filesChanged: 1, linesAdded: 1, linesDeleted: 0 },
        }),
      }),
    );
  });

  it('stops generating when the cost budget is exceeded', async () => {
    const generator = new CandidateGenerator();

    const costTracker = {
      getSummary: vi.fn().mockReturnValue({ total: { estimatedCostUsd: 2 } }),
    } as unknown as CostTracker;

    const stepContext: StepContext = {
      runId: 'test-run',
      goal: 'Test goal',
      step: 'Test step',
      stepIndex: 0,
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker,
      executor: mockExecutor,
      reviewer: mockReviewer,
      artifactsRoot: '/tmp/artifacts',
      budget: { cost: 1 } as any,
      logger: mockLogger,
    };

    const candidates = await generator.generateCandidates(stepContext, 3);
    expect(candidates).toEqual([]);
    expect(mockExecutor.generate).not.toHaveBeenCalled();
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RunStopped' }),
    );
  });

  it('marks candidates invalid when no unified diff is present', async () => {
    const generator = new CandidateGenerator();

    (mockExecutor.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'no diff here',
    });

    const stepContext: StepContext = {
      runId: 'test-run',
      goal: 'Test goal',
      step: 'Test step',
      stepIndex: 0,
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      executor: mockExecutor,
      reviewer: mockReviewer,
      artifactsRoot: '/tmp/artifacts',
      budget: {} as any,
      logger: mockLogger,
    };

    const candidates = await generator.generateCandidates(stepContext, 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        index: 0,
        valid: false,
        patch: undefined,
        patchStats: undefined,
      }),
    );
  });

  it('reviews candidates only when there are multiple valid patches', async () => {
    const generator = new CandidateGenerator();

    expect(
      await generator.reviewCandidates({} as any, [
        { index: 0, valid: true, patch: 'diff --git a/a b/a', rawOutput: '', providerId: 'p', durationMs: 1 },
      ] as any),
    ).toEqual([]);

    const reviewSpy = vi.fn().mockResolvedValue({
      rankings: [
        { candidateId: '0', score: 0.1, reasons: [], riskFlags: [] },
        { candidateId: '1', score: 0.9, reasons: [], riskFlags: [] },
      ],
    });
    (generator as any).reviewer.review = reviewSpy;

    const stepContext: StepContext = {
      runId: 'test-run',
      goal: 'Test goal',
      step: 'Test step',
      stepIndex: 0,
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      executor: mockExecutor,
      reviewer: mockReviewer,
      artifactsRoot: '/tmp/artifacts',
      budget: {} as any,
      logger: mockLogger,
    };

    const rankings = await generator.reviewCandidates(stepContext, [
      {
        index: 0,
        valid: true,
        patch: 'diff --git a/a b/a',
        rawOutput: '',
        providerId: 'p',
        durationMs: 1,
      },
      {
        index: 1,
        valid: true,
        patch: 'diff --git a/b b/b',
        rawOutput: '',
        providerId: 'p',
        durationMs: 1,
      },
    ]);

    expect(reviewSpy).toHaveBeenCalled();
    expect(rankings[0]?.candidateId).toBe('0');
  });

  it('selects the best reviewed candidate when rankings are available', async () => {
    const generator = new CandidateGenerator();
    vi.spyOn(generator, 'generateAndReviewCandidates').mockResolvedValue({
      candidates: [
        { index: 0, valid: true, patch: 'p0', rawOutput: '', providerId: 'p', durationMs: 1 },
        { index: 1, valid: true, patch: 'p1', rawOutput: '', providerId: 'p', durationMs: 1 },
      ],
      reviews: [
        { candidateId: '1', score: 0.9, reasons: [], riskFlags: [] },
        { candidateId: '0', score: 0.1, reasons: [], riskFlags: [] },
      ],
    } as any);

    const selected = await generator.generateAndSelectCandidate({} as any, 2);
    expect(selected?.index).toBe(1);
  });

  it('falls back to the first candidate when reviews are missing or no candidates are produced', async () => {
    const generator = new CandidateGenerator();
    vi.spyOn(generator, 'generateAndReviewCandidates')
      .mockResolvedValueOnce({ candidates: [], reviews: [] } as any)
      .mockResolvedValueOnce({
        candidates: [{ index: 0, valid: true, patch: 'p0', rawOutput: '', providerId: 'p', durationMs: 1 }],
        reviews: [],
      } as any)
      .mockResolvedValueOnce({
        candidates: [
          { index: 0, valid: true, patch: 'p0', rawOutput: '', providerId: 'p', durationMs: 1 },
          { index: 1, valid: true, patch: 'p1', rawOutput: '', providerId: 'p', durationMs: 1 },
        ],
        reviews: [],
      } as any);

    expect(await generator.generateAndSelectCandidate({} as any, 2)).toBeNull();
    expect((await generator.generateAndSelectCandidate({} as any, 1))?.index).toBe(0);
    expect((await generator.generateAndSelectCandidate({} as any, 2))?.index).toBe(0);
  });

  it('includes stepId, ancestors, and researchBrief in the system prompt', async () => {
    const generator = new CandidateGenerator();

    (mockExecutor.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: `BEGIN_DIFF\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@\n+ok\nEND_DIFF`,
    });

    const stepContext: StepContext = {
      runId: 'test-run',
      goal: 'Test goal',
      step: 'Test step',
      stepId: '1.1',
      ancestors: ['Parent step'],
      researchBrief: 'Some brief',
      stepIndex: 0,
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      executor: mockExecutor,
      reviewer: mockReviewer,
      artifactsRoot: '/tmp/artifacts',
      budget: {} as any,
      logger: mockLogger,
    };

    await generator.generateCandidates(stepContext, 1);

    const req = (mockExecutor.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const systemPrompt = req.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('- Step ID: 1.1');
    expect(systemPrompt).toContain('Ancestors (outer → inner)');
    expect(systemPrompt).toContain('RESEARCH BRIEF');
  });

  it('continues generating when the cost budget is set but estimated cost is missing/zero', async () => {
    const generator = new CandidateGenerator();

    const costTracker = {
      getSummary: vi.fn().mockReturnValue({ total: { estimatedCostUsd: 0 } }),
    } as unknown as CostTracker;

    (mockExecutor.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'BEGIN_DIFF\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@\n+ok\nEND_DIFF',
    });

    const stepContext: StepContext = {
      runId: 'test-run',
      goal: 'Test goal',
      step: 'Test step',
      stepIndex: 0,
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker,
      executor: mockExecutor,
      reviewer: mockReviewer,
      artifactsRoot: '/tmp/artifacts',
      budget: { cost: 1 } as any,
      logger: mockLogger,
    };

    const candidates = await generator.generateCandidates(stepContext, 1);
    expect(candidates).toHaveLength(1);
    expect(mockExecutor.generate).toHaveBeenCalledTimes(1);
  });

  it('treats provider responses without text as invalid candidates', async () => {
    const generator = new CandidateGenerator();
    (mockExecutor.generate as ReturnType<typeof vi.fn>).mockResolvedValue({} as any);

    const stepContext: StepContext = {
      runId: 'test-run',
      goal: 'Test goal',
      step: 'Test step',
      stepIndex: 0,
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      executor: mockExecutor,
      reviewer: mockReviewer,
      artifactsRoot: '/tmp/artifacts',
      budget: {} as any,
      logger: mockLogger,
    };

    const candidates = await generator.generateCandidates(stepContext, 1);
    expect(candidates[0]?.valid).toBe(false);
    expect(candidates[0]?.patch).toBeUndefined();
  });

  it('falls back to the first candidate when the best candidateId is not found', async () => {
    const generator = new CandidateGenerator();
    vi.spyOn(generator, 'generateAndReviewCandidates').mockResolvedValue({
      candidates: [
        { index: 0, valid: true, patch: 'p0', rawOutput: '', providerId: 'p', durationMs: 1 },
        { index: 1, valid: true, patch: 'p1', rawOutput: '', providerId: 'p', durationMs: 1 },
      ],
      reviews: [{ candidateId: '999', score: 1, reasons: [], riskFlags: [] }],
    } as any);

    const selected = await generator.generateAndSelectCandidate({} as any, 2);
    expect(selected?.index).toBe(0);
  });

  it('returns empty when no valid candidates are produced', async () => {
    const generator = new CandidateGenerator();
    vi.spyOn(generator, 'generateCandidates').mockResolvedValue([
      { index: 0, valid: false, patch: undefined, rawOutput: '', providerId: 'p', durationMs: 1 },
    ] as any);

    const result = await generator.generateAndReviewCandidates({} as any, 1);
    expect(result).toEqual({ candidates: [], reviews: [] });
  });

  it('returns the single valid candidate without reviews', async () => {
    const generator = new CandidateGenerator();
    vi.spyOn(generator, 'generateCandidates').mockResolvedValue([
      { index: 0, valid: false, patch: undefined, rawOutput: '', providerId: 'p', durationMs: 1 },
      { index: 1, valid: true, patch: 'p1', rawOutput: '', providerId: 'p', durationMs: 1 },
    ] as any);

    const result = await generator.generateAndReviewCandidates({} as any, 2);
    expect(result).toEqual({
      candidates: [{ index: 1, valid: true, patch: 'p1', rawOutput: '', providerId: 'p', durationMs: 1 }],
      reviews: [],
    });
  });
});
