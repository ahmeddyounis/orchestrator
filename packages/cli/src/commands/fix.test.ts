import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerFixCommand } from './fix';
import { UsageError } from '@orchestrator/shared';

vi.mock('@orchestrator/repo', () => ({
  findRepoRoot: vi.fn().mockResolvedValue('/fake/repo/root'),
  GitService: vi.fn().mockImplementation(() => ({
    ensureCleanWorkingTree: vi.fn().mockResolvedValue(undefined),
    createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@orchestrator/core', () => ({
  ConfigLoader: {
    load: vi.fn().mockReturnValue({
      execution: { sandbox: { mode: 'none' } },
    }),
  },
  ProviderRegistry: vi.fn().mockImplementation(() => ({
    registerFactory: vi.fn(),
  })),
  CostTracker: vi.fn().mockImplementation(() => ({
    getSummary: vi.fn().mockReturnValue({}),
  })),
  parseBudget: vi.fn().mockImplementation((value: string) => {
    const result: Record<string, unknown> = {};
    const parts = value.split(',');
    for (const part of parts) {
      const [key, val] = part.split('=');
      if (key === 'cost') result.cost = parseFloat(val);
      else if (key === 'iter') result.iter = parseInt(val, 10);
      else if (key === 'tool') result.tool = parseInt(val, 10);
      else if (key === 'time') result.time = val;
    }
    return result;
  }),
  Orchestrator: {
    create: vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({
        status: 'success',
        runId: 'test-run-id',
        filesChanged: [],
      }),
    }),
  },
}));

vi.mock('@orchestrator/adapters', () => ({
  AnthropicAdapter: vi.fn(),
  ClaudeCodeAdapter: vi.fn(),
  CodexCliAdapter: vi.fn(),
  FakeAdapter: vi.fn(),
  GeminiCliAdapter: vi.fn(),
  OpenAIAdapter: vi.fn(),
}));

vi.mock('@orchestrator/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@orchestrator/shared')>();
  return {
    ...original,
    getRunArtifactPaths: vi.fn().mockReturnValue({ root: '/fake/artifacts' }),
  };
});

vi.mock('../output/renderer', () => ({
  OutputRenderer: vi.fn().mockImplementation(() => ({
    log: vi.fn(),
    render: vi.fn(),
  })),
}));

vi.mock('../ui/console', () => ({
  ConsoleUI: vi.fn().mockImplementation(() => ({})),
}));

describe('registerFixCommand', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeErr: () => {},
      writeOut: () => {},
    });
    registerFixCommand(program);
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  describe('command registration', () => {
    it('should register the fix command', () => {
      const command = program.commands.find((c) => c.name() === 'fix');
      expect(command).toBeDefined();
      expect(command?.description()).toBe('Fix an issue based on a goal');
    });

    it('should require a goal argument', () => {
      const command = program.commands.find((c) => c.name() === 'fix');
      const args = command?.registeredArguments || [];
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('goal');
      expect(args[0].required).toBe(true);
    });

    it('should register all expected options', () => {
      const command = program.commands.find((c) => c.name() === 'fix');
      const optionFlags = command?.options.map((o) => o.long) || [];

      expect(optionFlags).toContain('--think');
      expect(optionFlags).toContain('--budget');
      expect(optionFlags).toContain('--planner');
      expect(optionFlags).toContain('--executor');
      expect(optionFlags).toContain('--reviewer');
      expect(optionFlags).toContain('--sandbox');
      expect(optionFlags).toContain('--allow-large-diff');
      expect(optionFlags).toContain('--no-tools');
      expect(optionFlags).toContain('--yes');
      expect(optionFlags).toContain('--non-interactive');
      expect(optionFlags).toContain('--memory');
      expect(optionFlags).toContain('--memory-path');
      expect(optionFlags).toContain('--memory-mode');
      expect(optionFlags).toContain('--memory-topk-lexical');
      expect(optionFlags).toContain('--memory-topk-vector');
      expect(optionFlags).toContain('--memory-vector-backend');
      expect(optionFlags).toContain('--memory-remote-opt-in');
    });
  });

  describe('--think option validation', () => {
    it('should accept L0 as a valid think level', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--think', 'L0']),
      ).resolves.not.toThrow();
    });

    it('should accept L1 as a valid think level', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--think', 'L1']),
      ).resolves.not.toThrow();
    });

    it('should throw UsageError for invalid think level', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--think', 'L2']),
      ).rejects.toThrow(UsageError);
    });

    it('should throw UsageError with descriptive message for invalid think level', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--think', 'invalid']),
      ).rejects.toThrow(/Invalid think level.*Must be L0 or L1/);
    });

    it('should default to L1 when --think is not provided', async () => {
      const { ConfigLoader } = await import('@orchestrator/core');
      await program.parseAsync(['node', 'fix', 'fix', 'test goal']);
      expect(ConfigLoader.load).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.objectContaining({
            thinkLevel: 'L1',
          }),
        }),
      );
    });
  });

  describe('--memory option validation', () => {
    it('should accept "on" as a valid memory value', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory', 'on']),
      ).resolves.not.toThrow();
    });

    it('should accept "off" as a valid memory value', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory', 'off']),
      ).resolves.not.toThrow();
    });

    it('should throw UsageError for invalid memory value', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory', 'yes']),
      ).rejects.toThrow(UsageError);
    });

    it('should throw UsageError with descriptive message for invalid memory value', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory', 'invalid']),
      ).rejects.toThrow(/Invalid --memory.*Must be on or off/);
    });
  });

  describe('--memory-mode option validation', () => {
    it('should accept "lexical" as a valid memory mode', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-mode', 'lexical']),
      ).resolves.not.toThrow();
    });

    it('should accept "vector" as a valid memory mode', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-mode', 'vector']),
      ).resolves.not.toThrow();
    });

    it('should accept "hybrid" as a valid memory mode', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-mode', 'hybrid']),
      ).resolves.not.toThrow();
    });

    it('should throw UsageError for invalid memory mode', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-mode', 'invalid']),
      ).rejects.toThrow(UsageError);
    });

    it('should throw UsageError with descriptive message for invalid memory mode', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-mode', 'semantic']),
      ).rejects.toThrow(/Invalid --memory-mode.*Must be lexical, vector, or hybrid/);
    });
  });

  describe('--memory-topk-lexical option validation', () => {
    it('should accept valid integer >= 1', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-lexical', '5']),
      ).resolves.not.toThrow();
    });

    it('should accept 1 as valid value', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-lexical', '1']),
      ).resolves.not.toThrow();
    });

    it('should throw UsageError for 0', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-lexical', '0']),
      ).rejects.toThrow(/Invalid --memory-topk-lexical.*Must be an integer >= 1/);
    });

    it('should throw UsageError for negative numbers', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-lexical', '-1']),
      ).rejects.toThrow(/Invalid --memory-topk-lexical.*Must be an integer >= 1/);
    });

    it('should throw UsageError for non-integer values', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-lexical', '2.5']),
      ).rejects.toThrow(/Invalid --memory-topk-lexical.*Must be an integer >= 1/);
    });

    it('should throw UsageError for non-numeric values', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-lexical', 'abc']),
      ).rejects.toThrow(/Invalid --memory-topk-lexical.*Must be an integer >= 1/);
    });
  });

  describe('--memory-topk-vector option validation', () => {
    it('should accept valid integer >= 1', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-vector', '10']),
      ).resolves.not.toThrow();
    });

    it('should throw UsageError for 0', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-vector', '0']),
      ).rejects.toThrow(/Invalid --memory-topk-vector.*Must be an integer >= 1/);
    });

    it('should throw UsageError for non-integer values', async () => {
      await expect(
        program.parseAsync(['node', 'fix', 'fix', 'test goal', '--memory-topk-vector', '3.14']),
      ).rejects.toThrow(/Invalid --memory-topk-vector.*Must be an integer >= 1/);
    });
  });

  describe('--memory-vector-backend option validation', () => {
    it.each(['sqlite', 'qdrant', 'chroma', 'pgvector'])(
      'should accept "%s" as a valid backend',
      async (backend) => {
        await expect(
          program.parseAsync([
            'node',
            'fix',
            'fix',
            'test goal',
            '--memory-vector-backend',
            backend,
          ]),
        ).resolves.not.toThrow();
      },
    );

    it('should throw UsageError for invalid backend', async () => {
      await expect(
        program.parseAsync([
          'node',
