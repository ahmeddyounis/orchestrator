import { Command } from 'commander';
import {
  ConfigLoader,
  ProviderRegistry,
  CostTracker,
  parseBudget,
  Orchestrator,
} from '@orchestrator/core';
import { findRepoRoot, GitService } from '@orchestrator/repo';
import { ClaudeCodeAdapter } from '@orchestrator/adapters';
import {
  ProviderCapabilities,
  ProviderConfig,
} from '@orchestrator/shared';
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

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .argument('<goal>', 'The goal to run')
    .description('Run an agentic task to achieve a goal')
    .option('--think <level>', 'Think level: L0, L1, or auto', 'auto')
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
    .option('--verify <mode>', 'Verification mode: on, off, auto')
    .option('--verify-scope <scope>', 'Verification scope: targeted, full')
    .option('--no-lint', 'Disable automatic linting')
    .option('--no-typecheck', 'Disable automatic typechecking')
    .option('--no-tests', 'Disable automatic testing')
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      if (globalOpts.verbose) renderer.log(`Running goal: "${goal}"`);

      try {
        const repoRoot = await findRepoRoot();

        let thinkLevel = options.think;
        if (thinkLevel === 'auto') {
          thinkLevel = 'L1';
        }
        if (thinkLevel !== 'L0' && thinkLevel !== 'L1') {
          renderer.error(`Invalid think level "${options.think}". Must be L0, L1, or auto.`);
          process.exit(2);
        }

        // Handle verification flags
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const verification: any = {};
        if (options.verify) {
          if (options.verify === 'off') {
            verification.enabled = false;
          } else {
            verification.enabled = true;
            if (options.verify === 'auto') {
              verification.mode = 'auto';
            }
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const autoVerification: any = {};
        if (options.verifyScope) {
          autoVerification.testScope = options.verifyScope;
        }
        if (options.lint === false) {
          autoVerification.enableLint = false;
        }
        if (options.typecheck === false) {
          autoVerification.enableTypecheck = false;
        }
        if (options.tests === false) {
          autoVerification.enableTests = false;
        }

        if (Object.keys(autoVerification).length > 0) {
          verification.auto = autoVerification;
        }

        const config = ConfigLoader.load({
          configPath: globalOpts.config,
          flags: {
            thinkLevel,
            budget: Object.keys(options.budget || {}).length > 0 ? options.budget : undefined,
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
            verification: Object.keys(verification).length > 0 ? verification : undefined,
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

        const branchName = `agent/${runId}`;
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

        // Save final diff if successful (or attempted)
        // Orchestrator already saves patches, but we might want to capture the final state relative to HEAD?
        // Orchestrator saves 'finalDiff' in runL0/runL1 implicitly via PatchStore.

        const output = {
            status: result.status,
            goal,
            runId: result.runId,
            branch: branchName,
            filesChanged: result.filesChanged || [],
            patchPaths: result.patchPaths || [],
            cost: costTracker.getSummary(),
            summary: result.summary
        };

        if (result.status === 'success') {
             renderer.render(output);
             process.exit(0);
        } else {
             renderer.error(result.summary || 'Run failed');
             // For JSON output we might want to render the error object instead of just text?
             // OutputRenderer handles structured object.
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