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
});
