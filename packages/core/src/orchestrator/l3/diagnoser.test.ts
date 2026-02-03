import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Diagnoser, DiagnosisContext } from './diagnoser';
import type { ProviderAdapter } from '@orchestrator/adapters';
import type { EventBus, Logger, Config } from '@orchestrator/shared';
import type { CostTracker } from '../../cost/tracker';
import type { FusedContext } from '../../context';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('Diagnoser', () => {
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
    prompt: 'Test context for debugging',
    sources: [],
  };

  const mockConfig: Config = {
    l3: {
      diagnosis: {
        maxToTBranches: 3,
      },
    },
  } as Config;

  let mockReasoner: ProviderAdapter;

  beforeEach(() => {
    vi.resetAllMocks();
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    mockReasoner = {
      generate: vi.fn(),
      id: () => 'mock-reasoner',
      capabilities: () => ({ supportsStreaming: false, supportsToolCalling: false }),
    } as unknown as ProviderAdapter;
  });

  it('should diagnose and return the highest confidence hypothesis', async () => {
    const diagnoser = new Diagnoser();

    const mockResponse = {
      text: JSON.stringify({
        hypotheses: [
          {
            hypothesis: 'Missing import statement',
            confidence: 0.8,
            repoSearchQueries: ['import.*missing'],
          },
          {
            hypothesis: 'Incorrect variable name',
            confidence: 0.6,
            repoSearchQueries: ['variable.*undefined'],
          },
        ],
      }),
    };
    (mockReasoner.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const context: DiagnosisContext = {
      runId: 'test-run',
      goal: 'Fix the bug',
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      reasoner: mockReasoner,
      artifactsRoot: '/tmp/artifacts',
      logger: mockLogger,
      config: mockConfig,
      iteration: 1,
      lastError: 'TypeError: undefined is not a function',
    };

    const result = await diagnoser.diagnose(context);

    expect(result).not.toBeNull();
    expect(result?.selectedHypothesis?.confidence).toBe(0.8);
    expect(result?.selectedHypothesis?.hypothesis).toBe('Missing import statement');
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DiagnosisCompleted',
      }),
    );
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should return null when no hypotheses are generated', async () => {
    const diagnoser = new Diagnoser();

    const mockResponse = {
      text: JSON.stringify({ hypotheses: [] }),
    };
    (mockReasoner.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const context: DiagnosisContext = {
      runId: 'test-run',
      goal: 'Fix the bug',
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      reasoner: mockReasoner,
      artifactsRoot: '/tmp/artifacts',
      logger: mockLogger,
      config: mockConfig,
      iteration: 1,
      lastError: 'Some error',
    };

    const result = await diagnoser.diagnose(context);

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith('Diagnosis model returned no hypotheses.');
  });

  it('should throw an error for empty response', async () => {
    const diagnoser = new Diagnoser();

    const mockResponse = { text: '' };
    (mockReasoner.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const context: DiagnosisContext = {
      runId: 'test-run',
      goal: 'Fix the bug',
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      reasoner: mockReasoner,
      artifactsRoot: '/tmp/artifacts',
      logger: mockLogger,
      config: mockConfig,
      iteration: 1,
      lastError: 'Some error',
    };

    await expect(diagnoser.diagnose(context)).rejects.toThrow(
      'Diagnosis model returned empty response.',
    );
  });

  it('should throw an error when response has no JSON', async () => {
    const diagnoser = new Diagnoser();

    const mockResponse = { text: 'This is not JSON at all' };
    (mockReasoner.generate as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const context: DiagnosisContext = {
      runId: 'test-run',
      goal: 'Fix the bug',
      fusedContext: mockFusedContext,
      eventBus: mockEventBus,
      costTracker: mockCostTracker,
      reasoner: mockReasoner,
      artifactsRoot: '/tmp/artifacts',
      logger: mockLogger,
      config: mockConfig,
      iteration: 1,
      lastError: 'Some error',
    };

    await expect(diagnoser.diagnose(context)).rejects.toThrow(
      'No JSON object found in diagnosis response.',
    );
  });
});
