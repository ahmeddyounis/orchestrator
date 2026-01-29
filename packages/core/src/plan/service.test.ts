import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { PlanService } from './service';
import { EventBus } from '../registry';
import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import { ModelResponse } from '@orchestrator/shared';
import * as fs from 'fs/promises';

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
}));

vi.mock('@orchestrator/repo', () => ({
  SearchService: class {
    search = () => Promise.resolve({ matches: [] });
  },
  SnippetExtractor: class {
    extractSnippets = () => Promise.resolve([]);
  },
  SimpleContextPacker: class {
    pack = () => ({ items: [], estimatedTokens: 0 });
  },
}));

describe('PlanService', () => {
  let eventBus: EventBus;
  let planner: ProviderAdapter;
  let ctx: AdapterContext;
  let service: PlanService;
  const artifactsDir = '/mock/artifacts';
  const repoRoot = '/mock/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = {
      emit: vi.fn(),
    };
    planner = {
      id: () => 'mock-planner',
      capabilities: () => ({
        supportsStreaming: false,
        supportsToolCalling: false,
        supportsJsonMode: true,
        modality: 'text',
        latencyClass: 'medium',
      }),
      generate: vi.fn(),
    } as unknown as ProviderAdapter;
    ctx = {
      runId: 'test-run-id',
      logger: { log: vi.fn() },
    } as unknown as AdapterContext;
    service = new PlanService(eventBus);
  });

  it('should generate a plan successfully', async () => {
    const mockSteps = ['Step 1', 'Step 2'];
    (planner.generate as Mock).mockResolvedValue({
      text: JSON.stringify({ steps: mockSteps }),
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(mockSteps);
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan_raw.txt`,
      JSON.stringify({ steps: mockSteps }),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan.json`,
      JSON.stringify({ steps: mockSteps }, null, 2),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PlanCreated',
        payload: { planSteps: mockSteps },
      }),
    );
  });

  it('should handle array response directly', async () => {
    const mockSteps = ['Step A', 'Step B'];
    (planner.generate as Mock).mockResolvedValue({
      text: JSON.stringify(mockSteps),
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(mockSteps);
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan.json`,
      JSON.stringify({ steps: mockSteps }, null, 2),
    );
  });

  it('should cleanup markdown code blocks', async () => {
    const mockSteps = ['Step X'];
    (planner.generate as Mock).mockResolvedValue({
      text: '```json\n{"steps": ["Step X"]}\n```',
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(mockSteps);
  });

  it('should fallback to text parsing if JSON is invalid', async () => {
    const rawText = '1. Step One\n2. Step Two';
    (planner.generate as Mock).mockResolvedValue({
      text: rawText,
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(['Step One', 'Step Two']);
    expect(fs.writeFile).toHaveBeenCalledWith(`${artifactsDir}/plan_raw.txt`, rawText);
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan.json`,
      JSON.stringify({ steps: ['Step One', 'Step Two'] }, null, 2),
    );
  });

  it('should return empty steps if parsing fails completely', async () => {
    const rawText = 'Just some random thoughts without structure.';
    (planner.generate as Mock).mockResolvedValue({
      text: rawText,
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual([]);
    expect(fs.writeFile).toHaveBeenCalledWith(`${artifactsDir}/plan_raw.txt`, rawText);
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan.json`,
      JSON.stringify({ steps: [] }, null, 2),
    );
  });
});
