import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerFixCommand } from './fix';
import { UsageError } from '@orchestrator/shared';
import { findRepoRoot, GitService } from '@orchestrator/repo';

const {
  configLoadSpy,
  parseBudgetSpy,
  orchestratorCreateSpy,
  orchestratorRunSpy,
  registryRegisterFactorySpy,
  costTrackerGetSummarySpy,
  ensureCleanWorkingTreeSpy,
  createAndCheckoutBranchSpy,
  rendererLogSpy,
  rendererRenderSpy,
  rendererErrorSpy,
  exitSpy,
} = vi.hoisted(() => ({
  configLoadSpy: vi.fn(),
  parseBudgetSpy: vi.fn(),
  orchestratorCreateSpy: vi.fn(),
  orchestratorRunSpy: vi.fn(),
  registryRegisterFactorySpy: vi.fn(),
  costTrackerGetSummarySpy: vi.fn(),
  ensureCleanWorkingTreeSpy: vi.fn(),
  createAndCheckoutBranchSpy: vi.fn(),
  rendererLogSpy: vi.fn(),
  rendererRenderSpy: vi.fn(),
  rendererErrorSpy: vi.fn(),
  exitSpy: vi.fn(),
}));

vi.mock('../output/renderer', () => ({
  OutputRenderer: class {
    constructor(_isJson: boolean) {}
    log = rendererLogSpy;
    render = rendererRenderSpy;
    error = rendererErrorSpy;
  },
}));

vi.mock('../ui/console', () => ({
  ConsoleUI: class {},
}));

vi.mock('@orchestrator/adapters', () => ({
  OpenAIAdapter: class {
    constructor(_cfg: unknown) {}
  },
  AnthropicAdapter: class {
    constructor(_cfg: unknown) {}
  },
  ClaudeCodeAdapter: class {
    constructor(_cfg: unknown) {}
  },
  GeminiCliAdapter: class {
    constructor(_cfg: unknown) {}
  },
  CodexCliAdapter: class {
    constructor(_cfg: unknown) {}
  },
  FakeAdapter: class {
    constructor(_cfg: unknown) {}
  },
}));

vi.mock('@orchestrator/core', () => ({
  ConfigLoader: {
    load: configLoadSpy,
  },
  ProviderRegistry: vi.fn().mockImplementation(function () {
    return {
      registerFactory: registryRegisterFactorySpy,
    };
  }),
  CostTracker: vi.fn().mockImplementation(function () {
    return {
      getSummary: costTrackerGetSummarySpy,
    };
  }),
  parseBudget: parseBudgetSpy,
  Orchestrator: {
    create: orchestratorCreateSpy,
  },
}));

vi.mock('@orchestrator/repo', () => ({
  findRepoRoot: vi.fn().mockResolvedValue('/fake/repo/root'),
  GitService: vi.fn().mockImplementation(function () {
    return {
      ensureCleanWorkingTree: ensureCleanWorkingTreeSpy,
      createAndCheckoutBranch: createAndCheckoutBranchSpy,
    };
  }),
}));

describe('registerFixCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(exitSpy as any);
    configLoadSpy.mockReturnValue({
      execution: { sandbox: { mode: 'none' } },
    } as any);
    parseBudgetSpy.mockReturnValue({});
    costTrackerGetSummarySpy.mockReturnValue({ total: { totalTokens: 0 } });
    orchestratorCreateSpy.mockResolvedValue({
      run: orchestratorRunSpy,
    });
    orchestratorRunSpy.mockResolvedValue({
      status: 'success',
      runId: 'run-1',
      summary: 'ok',
      verification: { enabled: true, passed: true },
      lastFailureSignature: undefined,
      filesChanged: ['src/a.ts'],
    });
    ensureCleanWorkingTreeSpy.mockResolvedValue(undefined);
    createAndCheckoutBranchSpy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the fix command', () => {
    const program = new Command();
    registerFixCommand(program);
    const cmd = program.commands.find((c) => c.name() === 'fix');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('Fix an issue');
  });

  it('throws UsageError for invalid --think', async () => {
    const program = new Command();
    program.exitOverride(); // prevent commander from exiting the process
    program.option('--config <path>');
    program.option('--json');
    program.option('--verbose');
    registerFixCommand(program);

    await expect(
      program.parseAsync(['node', 'fix', 'fix', 'goal', '--think', 'L9']),
    ).rejects.toThrow(/Invalid think level/i);
  });

  it('throws UsageError for invalid --memory-topk-lexical', async () => {
    const program = new Command();
    program.exitOverride();
    program.option('--config <path>');
    program.option('--json');
    program.option('--verbose');
    registerFixCommand(program);

    await expect(
      program.parseAsync(['node', 'fix', 'fix', 'goal', '--memory-topk-lexical', '0']),
    ).rejects.toThrow(/Invalid --memory-topk-lexical/i);
  });

  it('throws UsageError for invalid --memory-vector-backend', async () => {
    const program = new Command();
    program.exitOverride();
    program.option('--config <path>');
    program.option('--json');
    program.option('--verbose');
    registerFixCommand(program);

    await expect(
      program.parseAsync(['node', 'fix', 'fix', 'goal', '--memory-vector-backend', 'nope']),
    ).rejects.toThrow(/Invalid --memory-vector-backend/i);
  });

  it('runs the fix command end-to-end and exits 0 on success', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);

    configLoadSpy.mockReturnValue({
      execution: {
        sandbox: { mode: 'none' },
        allowDirtyWorkingTree: true,
      },
    } as any);

    parseBudgetSpy.mockReturnValueOnce({ maxCostUsd: 5 }).mockReturnValueOnce({ maxIterations: 2 });

    const program = new Command();
    program.exitOverride();
    program.option('--config <path>');
    program.option('--json');
    program.option('--verbose');
    registerFixCommand(program);

    await program.parseAsync([
      'node',
      'cli',
      '--config',
      '/cfg.yml',
      '--verbose',
      'fix',
      'ship it',
      '--think',
      'L1',
      '--budget',
      'cost=5',
      '--budget',
      'iter=2',
      '--planner',
      'p1',
      '--executor',
      'p2',
      '--reviewer',
      'p3',
      '--allow-large-diff',
      '--no-tools',
      '--yes',
      '--non-interactive',
      '--memory',
      'on',
      '--memory-path',
      'memory.sqlite',
      '--memory-mode',
      'hybrid',
      '--memory-topk-lexical',
      '2',
      '--memory-topk-vector',
      '3',
      '--memory-vector-backend',
      'sqlite',
      '--memory-remote-opt-in',
    ]);

    // Execute the registered factory functions at least once to ensure they stay valid.
    for (const [, factory] of registryRegisterFactorySpy.mock.calls) {
      if (typeof factory === 'function') {
        factory({} as any);
      }
    }

    expect(vi.mocked(findRepoRoot)).toHaveBeenCalled();
    expect(vi.mocked(GitService)).toHaveBeenCalledWith({ repoRoot: '/fake/repo/root' });
    expect(ensureCleanWorkingTreeSpy).toHaveBeenCalledWith({ allowDirty: true });
    expect(createAndCheckoutBranchSpy).toHaveBeenCalledWith('fix/123');

    expect(configLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: '/cfg.yml',
        flags: expect.objectContaining({
          thinkLevel: 'L1',
          budget: { maxCostUsd: 5, maxIterations: 2 },
          defaults: { planner: 'p1', executor: 'p2', reviewer: 'p3' },
          patch: expect.objectContaining({
            maxFilesChanged: Infinity,
            maxLinesChanged: Infinity,
          }),
          execution: expect.objectContaining({
            tools: expect.objectContaining({
              enabled: false,
              autoApprove: true,
              interactive: false,
            }),
          }),
          memory: expect.any(Object),
        }),
      }),
    );

    expect(orchestratorCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: '/fake/repo/root',
      }),
    );
    expect(orchestratorRunSpy).toHaveBeenCalledWith('ship it', {
      thinkLevel: 'L1',
      runId: '123',
    });
    expect(rendererRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCESS',
        goal: 'ship it',
        runId: 'run-1',
        changedFiles: ['src/a.ts'],
      }),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 1 when the orchestrator reports failure', async () => {
    orchestratorRunSpy.mockResolvedValueOnce({
      status: 'failure',
      runId: 'run-2',
      summary: 'nope',
      verification: { enabled: true, passed: false },
      lastFailureSignature: 'E_FAIL',
      filesChanged: undefined,
    });

    const program = new Command();
    program.exitOverride();
    program.option('--config <path>');
    program.option('--json');
    program.option('--verbose');
    registerFixCommand(program);

    await program.parseAsync(['node', 'cli', '--json', 'fix', 'goal']);

    expect(rendererRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILURE',
        goal: 'goal',
        runId: 'run-2',
        changedFiles: [],
        lastFailureSignature: 'E_FAIL',
      }),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('throws UsageError when a sandbox mode other than none is configured', async () => {
    configLoadSpy.mockReturnValueOnce({
      execution: { sandbox: { mode: 'docker' } },
    } as any);

    const program = new Command();
    program.exitOverride();
    program.option('--config <path>');
    program.option('--json');
    registerFixCommand(program);

    await expect(
      program.parseAsync(['node', 'cli', '--config', 'cfg.yml', 'fix', 'goal']),
    ).rejects.toThrow(UsageError);
  });
});
