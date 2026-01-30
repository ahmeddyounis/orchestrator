import { Command } from 'commander';
import {
  ConfigLoader,
  ProviderRegistry,
  CostTracker,
  parseBudget,
  Orchestrator,
  type DeepPartial,
} from '@orchestrator/core';
import { findRepoRoot, GitService } from '@orchestrator/repo';
import { ClaudeCodeAdapter } from '@orchestrator/adapters';
import { ProviderCapabilities, ProviderConfig, type Config } from '@orchestrator/shared';
import { OutputRenderer } from '../output/renderer';

function parseBudgetFlag(value: string, previous: unknown) {
  try {
    const parsed = parseBudget(value);
    const prevObj = typeof previous === 'object' && previous !== null ? previous : {};
    return { ...prevObj, ...parsed };
  } catch (e: unknown) {
    if (e instanceof Error) {
      throw new Error(e.message);
    }
    throw new Error(String(e));
  }
}

export function registerFixCommand(program: Command) {
  program
    .command('fix')
    .argument('<goal>', 'The goal to fix')
    .description('Fix an issue based on a goal')
    .option('--think <level>', 'Think level: L0, L1', 'L1')
    .option(
      '--budget <limits>',
      'Set budget limits (e.g. cost=5,iter=6,tool=10,time=20m)',
      parseBudgetFlag,
      {},
    )
    .option('--planner <providerId>', 'Override planner provider')
    .option('--executor <providerId>', 'Override executor provider')
    .option('--reviewer <providerId>', 'Override reviewer provider')
    .option('--sandbox <mode>', 'Sandbox mode: none, docker, devcontainer')
    .option('--allow-large-diff', 'Allow large diffs without confirmation')
    .option('--no-tools', 'Force tools disabled')
    .option('--yes', 'Auto-approve confirmations except denylist')
    .option('--non-interactive', 'Deny by default if confirmation required')
    .option('--memory <mode>', 'Memory: on|off')
    .option('--memory-path <path>', 'Override memory storage path')
    .option('--memory-topk <n>', 'Override memory retrieval topK (integer >= 1)')
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      if (globalOpts.verbose) renderer.log(`Fixing goal: "${goal}"`);

      try {
        const repoRoot = await findRepoRoot();

        const thinkLevel = options.think;
        if (thinkLevel !== 'L0' && thinkLevel !== 'L1') {
          renderer.error(`Invalid think level "${options.think}". Must be L0 or L1.`);
          process.exit(2);
        }

        const memory: DeepPartial<Config['memory']> = {};
        if (options.memory) {
          if (options.memory !== 'on' && options.memory !== 'off') {
            renderer.error(`Invalid --memory "${options.memory}". Must be on or off.`);
            process.exit(2);
          }
          memory.enabled = options.memory === 'on';
        }
        if (options.memoryPath) {
          memory.storage = { path: options.memoryPath };
        }
        if (options.memoryTopk !== undefined) {
          const topK = Number(options.memoryTopk);
          if (!Number.isInteger(topK) || topK < 1) {
            renderer.error(
              `Invalid --memory-topk "${options.memoryTopk}". Must be an integer >= 1.`,
            );
            process.exit(2);
          }
          memory.retrieval = { topK };
        }

        const config = ConfigLoader.load({
          configPath: globalOpts.config,
          flags: {
            thinkLevel,
            budget: Object.keys(options.budget || {}).length > 0 ? options.budget : undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            memory: Object.keys(memory).length > 0 ? (memory as any) : undefined,
            defaults: {
              planner: options.planner,
              executor: options.executor,
              reviewer: options.reviewer,
            },
            patch: options.allowLargeDiff
              ? { maxFilesChanged: Infinity, maxLinesChanged: Infinity, allowBinary: false }
              : undefined,
            execution: {
              tools: {
                enabled: options.tools === false ? false : undefined,
                autoApprove: options.yes,
                interactive: options.nonInteractive ? false : undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
              sandbox: options.sandbox ? { mode: options.sandbox } : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          },
        });

        if (config.execution?.sandbox?.mode && config.execution.sandbox.mode !== 'none') {
          renderer.error(`Sandbox mode '${config.execution.sandbox.mode}' is not yet implemented.`);
          process.exit(2);
        }

        const runId = Date.now().toString();
        const git = new GitService({ repoRoot });

        if (config.execution?.allowDirtyWorkingTree) {
          renderer.log(
            'WARNING: execution.allowDirtyWorkingTree is enabled. Uncommitted changes may be committed or lost during rollback.',
          );
        }
        await git.ensureCleanWorkingTree({
          allowDirty: config.execution?.allowDirtyWorkingTree,
        });

        const branchName = `fix/${runId}`;
        await git.createAndCheckoutBranch(branchName);
        if (globalOpts.verbose) {
          renderer.log(`Created and checked out branch "${branchName}"`);
        }

        const costTracker = new CostTracker(config);
        const registry = new ProviderRegistry(config, costTracker);

        const stubFactory = (cfg: ProviderConfig) => ({
          id: () => cfg.type,
          capabilities: () =>
            ({
              supportsStreaming: false,
              supportsToolCalling: false,
              supportsJsonMode: false,
              modality: 'text' as const,
              latencyClass: 'medium' as const,
            }) as ProviderCapabilities,
          generate: async () => ({ text: 'Stub response' }),
        });

        registry.registerFactory('openai', stubFactory);
        registry.registerFactory('anthropic', stubFactory);
        registry.registerFactory('mock', stubFactory);
        registry.registerFactory('claude_code', (cfg) => new ClaudeCodeAdapter(cfg));

        const orchestrator = new Orchestrator({ config, git, registry, repoRoot });

        const result = await orchestrator.run(goal, { thinkLevel, runId });

        const output = {
          status: result.status,
          goal,
          runId: result.runId,
          branch: branchName,
          filesChanged: result.filesChanged || [],
          patchPaths: result.patchPaths || [],
          cost: costTracker.getSummary(),
          summary: result.summary,
        };

        if (result.status === 'success') {
          renderer.render(output);
          process.exit(0);
        } else {
          renderer.error(result.summary || 'Fix failed');
          if (globalOpts.json) {
            console.log(JSON.stringify(output, null, 2));
          }
          process.exit(1);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          renderer.error(err.message);
        } else {
          renderer.error('An unknown error occurred');
          console.error(err);
        }
        process.exit(2);
      }
    });
}
