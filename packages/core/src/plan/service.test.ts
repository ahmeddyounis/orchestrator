import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { PlanService } from './service';
import { EventBus } from '../registry';
import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import { ModelResponse } from '@orchestrator/shared';

describe('PlanService', () => {
  let eventBus: EventBus;
  let planner: ProviderAdapter;
  let ctx: AdapterContext;
  let service: PlanService;

  beforeEach(() => {
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

    const result = await service.generatePlan('my goal', { planner }, ctx);

    expect(result).toEqual(mockSteps);
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PlanRequested',
        payload: { goal: 'my goal' },
      }),
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

    const result = await service.generatePlan('my goal', { planner }, ctx);

    expect(result).toEqual(mockSteps);
  });

  it('should cleanup markdown code blocks', async () => {
    const mockSteps = ['Step X'];
    (planner.generate as Mock).mockResolvedValue({
      text: '```json\n{"steps": ["Step X"]}\n```',
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx);

    expect(result).toEqual(mockSteps);
  });

  it('should throw if response is invalid json', async () => {
    (planner.generate as Mock).mockResolvedValue({
      text: 'Not JSON',
    } as ModelResponse);

    await expect(service.generatePlan('my goal', { planner }, ctx)).rejects.toThrow(
      'Failed to parse planner response',
    );
  });

  it('should throw if response does not contain steps', async () => {
    (planner.generate as Mock).mockResolvedValue({
      text: JSON.stringify({ something: 'else' }),
    } as ModelResponse);

    await expect(service.generatePlan('my goal', { planner }, ctx)).rejects.toThrow(
      'Response does not contain "steps" array',
    );
  });
});
