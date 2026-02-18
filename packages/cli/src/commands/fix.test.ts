import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerFixCommand } from './fix';

vi.mock('@orchestrator/repo', () => ({
  findRepoRoot: vi.fn().mockResolvedValue('/fake/repo/root'),
  GitService: vi.fn(),
}));

describe('registerFixCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    registerFixCommand(program);

    await expect(
      program.parseAsync(['node', 'fix', 'fix', 'goal', '--think', 'L9']),
    ).rejects.toThrow(/Invalid think level/i);
  });

  it('throws UsageError for invalid --memory-topk-lexical', async () => {
    const program = new Command();
    program.exitOverride();
    registerFixCommand(program);

    await expect(
      program.parseAsync(['node', 'fix', 'fix', 'goal', '--memory-topk-lexical', '0']),
    ).rejects.toThrow(/Invalid --memory-topk-lexical/i);
  });

  it('throws UsageError for invalid --memory-vector-backend', async () => {
    const program = new Command();
    program.exitOverride();
    registerFixCommand(program);

    await expect(
      program.parseAsync(['node', 'fix', 'fix', 'goal', '--memory-vector-backend', 'nope']),
    ).rejects.toThrow(/Invalid --memory-vector-backend/i);
  });
});
