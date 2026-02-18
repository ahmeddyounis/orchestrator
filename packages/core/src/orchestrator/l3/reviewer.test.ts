import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reviewer, ReviewerInput, ReviewerContext } from './reviewer';
import type { ProviderAdapter } from '@orchestrator/adapters';
import type { EventBus, Logger } from '@orchestrator/shared';
import type { CostTracker } from '../../cost/tracker';
import type { FusedContext } from '../../context';
import type { Candidate } from './candidate_generator';
import * as fs from 'fs/promises';
import * as shared from '@orchestrator/shared';

vi.mock('fs/promises');
vi.mock('@orchestrator/shared', async () => {
  const actual = await vi.importActual('@orchestrator/shared');
  return {
    ...actual,
    updateManifest: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Reviewer', () => {
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

  const mockCostTracker = {} as CostTracker;

  const mockFusedContext: FusedContext = {
    prompt: 'Test context for review',
    sources: [],
  };

  let mockReviewerAdapter: ProviderAdapter;

  beforeEach(() => {
    vi.resetAllMocks();
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    mockReviewerAdapter = {
      generate: vi.fn(),
      id: () => 'mock-reviewer',
      capabilities: () => ({ supportsStreaming: false, supportsToolCalling: false }),
    } as unknown as ProviderAdapter;
  });

  it('should review candidates and return rankings', async () => {
    const reviewer = new Reviewer();

    const mockResponse = {
      text: JSON.stringify({
        rankings: [
          {
            candidateId: '0',
            score: 9,
            reasons: ['Clean implementation', 'Follows best practices'],
            riskFlags: [],
          },
          {
            candidateId: '1',
            score: 6,
            reasons: ['Works but could be cleaner'],
            riskFlags: ['Potential performance issue'],
          },
        ],
        requiredFixes: [],
        suggestedTests: ['Test edge cases'],
        confidence: 'high',
      }),
    };
    (mockReviewerAdapter.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const candidates: Candidate[] = [
      {
        index: 0,
        valid: true,
        patch: 'diff --git a/a.ts b/a.ts\n+clean',
        rawOutput: '',
        providerId: 'test',
        durationMs: 100,
      },
      {
        index: 1,
        valid: true,
        patch: 'diff --git a/a.ts b/a.ts\n+messy',
        rawOutput: '',
        providerId: 'test',
        durationMs: 100,
      },
    ];

    const input: ReviewerInput = {
      goal: 'Implement feature',
      step: 'Add function',
      fusedContext: mockFusedContext,
      candidates,
    };

    const context: ReviewerContext = {
      runId: 'test-run',
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      reviewer: mockReviewerAdapter,
      artifactsRoot: '/tmp/artifacts',
      logger: mockLogger,
    };

    const result = await reviewer.review(input, context);

    expect(result.rankings).toHaveLength(2);
    expect(result.rankings[0].score).toBe(9);
    expect(result.confidence).toBe('high');
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should throw an error for empty response', async () => {
    const reviewer = new Reviewer();

    const mockResponse = { text: '' };
    (mockReviewerAdapter.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const candidates: Candidate[] = [
      { index: 0, valid: true, patch: 'diff', rawOutput: '', providerId: 'test', durationMs: 100 },
    ];

    const input: ReviewerInput = {
      goal: 'Fix bug',
      step: 'Apply patch',
      fusedContext: mockFusedContext,
      candidates,
    };

    const context: ReviewerContext = {
      runId: 'test-run',
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      reviewer: mockReviewerAdapter,
      artifactsRoot: '/tmp/artifacts',
      logger: mockLogger,
    };

    await expect(reviewer.review(input, context)).rejects.toThrow(
      'Reviewer returned empty response.',
    );
  });

  it('should throw an error when response has no JSON', async () => {
    const reviewer = new Reviewer();

    const mockResponse = { text: 'Not JSON content here' };
    (mockReviewerAdapter.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const context: ReviewerContext = {
      runId: 'test-run',
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      reviewer: mockReviewerAdapter,
      artifactsRoot: '/tmp/artifacts',
      logger: mockLogger,
    };

    const candidates: Candidate[] = [
      { index: 0, valid: true, patch: 'diff', rawOutput: '', providerId: 'test', durationMs: 100 },
    ];

    await expect(
      reviewer.review(
        { goal: 'test', step: 'test', fusedContext: mockFusedContext, candidates },
        context,
      ),
    ).rejects.toThrow('No JSON object found in reviewer response.');
  });
});
