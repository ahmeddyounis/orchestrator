import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { PlanService } from './service';
import { EventBus } from '../registry';
import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import { ModelResponse } from '@orchestrator/shared';
import * as fs from 'fs/promises';

vi.mock('fs/promises', () => {
  const writeFile = vi.fn();
  return { writeFile, default: { writeFile } };
});

vi.mock('@orchestrator/repo', () => ({
  RepoScanner: class {
    scan = () => Promise.resolve({ files: [] });
  },
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

  const readWrittenJson = (filePath: string) => {
    const calls = (fs.writeFile as unknown as Mock).mock.calls as Array<[string, string]>;
    const call = calls.find(([p]) => p === filePath);
    expect(call, `Expected fs.writeFile to be called for ${filePath}`).toBeTruthy();
    return JSON.parse(call![1]) as Record<string, unknown>;
  };

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
    const planJson = readWrittenJson(`${artifactsDir}/plan.json`);
    expect(planJson.steps).toEqual(mockSteps);
    expect(planJson.outline).toEqual(mockSteps);
    expect(planJson.tree).toEqual([
      { id: '1', step: 'Step 1' },
      { id: '2', step: 'Step 2' },
    ]);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PlanCreated',
        payload: { planSteps: mockSteps },
      }),
    );
  });

  it('should run planning research when enabled and inject a brief', async () => {
    (planner.generate as Mock)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          schemaVersion: 1,
          focus: 'files',
          summary: 'R1 summary',
          findings: ['F1'],
          fileHints: [{ path: 'packages/core/src/plan/service.ts', reason: 'planning entrypoint' }],
          repoSearchQueries: [],
          risks: [],
          openQuestions: [],
        }),
      } as ModelResponse)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          schemaVersion: 1,
          focus: 'prompts',
          summary: 'R2 summary',
          findings: ['F2'],
          fileHints: [{ path: 'packages/core/src/orchestrator.ts', reason: 'execution prompts' }],
          repoSearchQueries: [],
          risks: [],
          openQuestions: [],
        }),
      } as ModelResponse)
      .mockResolvedValueOnce({
        text: JSON.stringify({ steps: ['Step 1'] }),
      } as ModelResponse);

    const config = {
      planning: {
        research: {
          enabled: true,
          count: 2,
          synthesize: false,
          maxQueries: 0,
          maxBriefChars: 2000,
        },
      },
    } as any;

    const result = await service.generatePlan(
      'my goal',
      { planner },
      ctx,
      artifactsDir,
      repoRoot,
      config,
    );

    expect(result).toEqual(['Step 1']);
    expect(planner.generate).toHaveBeenCalledTimes(3);

    // Planner prompt includes the research brief.
    const lastReq = (planner.generate as Mock).mock.calls.at(-1)![0];
    const userPrompt = lastReq.messages.find((m: any) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('RESEARCH BRIEF');
    expect(userPrompt).toContain('R1 summary');

    // Research artifacts are written.
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/research_plan_brief.txt`,
      expect.any(String),
    );
  });

  it('should handle array response directly', async () => {
    const mockSteps = ['Step A', 'Step B'];
    (planner.generate as Mock).mockResolvedValue({
      text: JSON.stringify(mockSteps),
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(mockSteps);
    const planJson = readWrittenJson(`${artifactsDir}/plan.json`);
    expect(planJson.steps).toEqual(mockSteps);
  });

  it('should cleanup markdown code blocks', async () => {
    const mockSteps = ['Step X'];
    (planner.generate as Mock).mockResolvedValue({
      text: '```json\n{"steps": ["Step X"]}\n```',
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(mockSteps);
  });

  it('should parse JSON from fenced blocks even with extra text', async () => {
    const mockSteps = ['Step 1', 'Step 2'];
    (planner.generate as Mock).mockResolvedValue({
      text: `Here is the plan:\n\n\`\`\`json\n{"steps": ["Step 1", "Step 2"]}\n\`\`\`\n\nGood luck!`,
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);
    expect(result).toEqual(mockSteps);
  });

  it('should extract and parse a JSON object embedded in text', async () => {
    const mockSteps = ['Alpha', 'Beta'];
    (planner.generate as Mock).mockResolvedValue({
      text: `Preamble\n{"steps": ["Alpha", "Beta"]}\nTrailing`,
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
    const planJson = readWrittenJson(`${artifactsDir}/plan.json`);
    expect(planJson.steps).toEqual(['Step One', 'Step Two']);
  });

  it('should drop section headers when falling back to text parsing', async () => {
    const rawText = `
1. CODE QUALITY FIXES
  1.1. Do this
  1.2. Do that
`;
    (planner.generate as Mock).mockResolvedValue({
      text: rawText,
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(['Do this', 'Do that']);
  });

  it('should drop section headers and strip numbering in JSON steps', async () => {
    const rawSteps = [
      '1. CODE QUALITY FIXES',
      '  1.1. Extract newline normalization into a shared utility function',
      '  1.2. Replace direct console.log calls with proper logger usage',
      '2. SECURITY FIXES',
      '  2.1. Escape user input before RegExp construction',
    ];
    const normalizedSteps = [
      'Extract newline normalization into a shared utility function',
      'Replace direct console.log calls with proper logger usage',
      'Escape user input before RegExp construction',
    ];

    const rawText = JSON.stringify({ steps: rawSteps });
    (planner.generate as Mock).mockResolvedValue({
      text: rawText,
    } as ModelResponse);

    const result = await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(result).toEqual(normalizedSteps);
    expect(fs.writeFile).toHaveBeenCalledWith(`${artifactsDir}/plan_raw.txt`, rawText);
    const planJson = readWrittenJson(`${artifactsDir}/plan.json`);
    expect(planJson.steps).toEqual(normalizedSteps);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PlanCreated',
        payload: { planSteps: normalizedSteps },
      }),
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
    const planJson = readWrittenJson(`${artifactsDir}/plan.json`);
    expect(planJson.steps).toEqual([]);
  });

  it('should emit context events during planning', async () => {
    (planner.generate as Mock).mockResolvedValue({
      text: JSON.stringify({ steps: ['Step 1'] }),
    } as ModelResponse);

    await service.generatePlan('my goal', { planner }, ctx, artifactsDir, repoRoot);

    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'RepoScan' }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'RepoSearch' }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'ContextBuilt' }));
  });

  it('should expand outline steps when maxDepth > 1', async () => {
    (planner.generate as Mock)
      .mockResolvedValueOnce({
        text: JSON.stringify({ steps: ['Top A', 'Top B'] }),
      } as ModelResponse)
      .mockResolvedValueOnce({
        text: JSON.stringify({ steps: ['Add A', 'Test A'] }),
      } as ModelResponse)
      .mockResolvedValueOnce({
        text: JSON.stringify({ steps: ['Add B'] }),
      } as ModelResponse);

    const result = await service.generatePlan(
      'my goal',
      { planner },
      ctx,
      artifactsDir,
      repoRoot,
      undefined,
      { maxDepth: 2, maxSubstepsPerStep: 10 },
    );

    expect(result).toEqual(['Add A', 'Test A', 'Add B']);

    const planJson = readWrittenJson(`${artifactsDir}/plan.json`);
    expect(planJson.outline).toEqual(['Top A', 'Top B']);
    expect(planJson.steps).toEqual(['Add A', 'Test A', 'Add B']);
    expect(planJson.execution).toEqual([
      { id: '1.1', step: 'Add A', ancestors: ['Top A'] },
      { id: '1.2', step: 'Test A', ancestors: ['Top A'] },
      { id: '2.1', step: 'Add B', ancestors: ['Top B'] },
    ]);

    expect(fs.writeFile).toHaveBeenCalledWith(`${artifactsDir}/plan_expand_1_raw.txt`, expect.any(String));
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan_expand_1.json`,
      JSON.stringify({ steps: ['Add A', 'Test A'] }, null, 2),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(`${artifactsDir}/plan_expand_2_raw.txt`, expect.any(String));
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan_expand_2.json`,
      JSON.stringify({ steps: ['Add B'] }, null, 2),
    );
  });

  it('should review and apply revised outline steps when enabled', async () => {
    const reviewer = {
      id: () => 'mock-reviewer',
      capabilities: () => ({
        supportsStreaming: false,
        supportsToolCalling: false,
        supportsJsonMode: true,
        modality: 'text',
        latencyClass: 'medium',
      }),
      generate: vi.fn(),
    } as unknown as ProviderAdapter;

    (planner.generate as Mock).mockResolvedValue({
      text: JSON.stringify({ steps: ['Old Step'] }),
    } as ModelResponse);

    (reviewer.generate as Mock).mockResolvedValue({
      text: JSON.stringify({
        verdict: 'revise',
        summary: 'Missing key details.',
        issues: ['Too vague'],
        suggestions: ['Be more specific'],
        revisedSteps: ['New Step 1', 'New Step 2'],
      }),
    } as ModelResponse);

    const result = await service.generatePlan(
      'my goal',
      { planner, reviewer },
      ctx,
      artifactsDir,
      repoRoot,
      undefined,
      { reviewPlan: true, applyReview: true },
    );

    expect(result).toEqual(['New Step 1', 'New Step 2']);

    const planJson = readWrittenJson(`${artifactsDir}/plan.json`);
    expect(planJson.outline).toEqual(['New Step 1', 'New Step 2']);
    expect(planJson.steps).toEqual(['New Step 1', 'New Step 2']);
    expect(planJson.review).toEqual(
      expect.objectContaining({
        verdict: 'revise',
        summary: 'Missing key details.',
      }),
    );

    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan_review_raw.txt`,
      expect.any(String),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      `${artifactsDir}/plan_review.json`,
      expect.stringContaining('"verdict": "revise"'),
    );
  });
});
