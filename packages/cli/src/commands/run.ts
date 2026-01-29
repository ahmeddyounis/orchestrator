import { Command } from 'commander';
import {
  ConfigLoader,
  ProviderRegistry,
  CostTracker,
  PatchStore,
  ToolRunTracker,
  parseBudget,
} from '@orchestrator/core';
import { findRepoRoot, GitService } from '@orchestrator/repo';
import { ClaudeCodeAdapter } from '@orchestrator/adapters';
import {
  createRunDir,
  writeManifest,
  JsonlLogger,
  ProviderCapabilities,
  ProviderConfig,
  OrchestratorEvent,
} from '@orchestrator/shared';
import path from 'path';
import * as fs from 'fs/promises';
import { OutputRenderer } from '../output/renderer';

function parseBudgetFlag(value: string, previous: unknown) {
  try {
    const parsed = parseBudget(value);
    const prevObj = typeof previous === 'object' && previous !== null ? previous : {};
    return { ...prevObj, ...parsed };
  } catch (e: unknown) {
    // commander catches errors thrown here and exits 2 (invalid argument)
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
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      if (globalOpts.verbose) renderer.log(`Running goal: "${goal}"`);

      try {
        const repoRoot = await findRepoRoot();

        // Validate think level
        let thinkLevel = options.think;
        if (thinkLevel === 'auto') {
          thinkLevel = 'L1';
        }
        if (thinkLevel !== 'L0' && thinkLevel !== 'L1') {
          renderer.error(`Invalid think level "${options.think}". Must be L0, L1, or auto.`);
          process.exit(2);
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
          },
        });

        // Validate sandbox mode (MVP limitation)
        if (config.execution?.sandbox?.mode && config.execution.sandbox.mode !== 'none') {
          renderer.error(`Sandbox mode '${config.execution.sandbox.mode}' is not yet implemented.`);
          process.exit(2);
        }

        // Initialize Git and branch
        const runId = Date.now().toString();
        const git = new GitService({ repoRoot });

        // Ensure clean state (unless allowed)
        if (config.execution?.allowDirtyWorkingTree) {
          renderer.log(
            'WARNING: execution.allowDirtyWorkingTree is enabled. Uncommitted changes may be committed or lost during rollback.',
          );
        }
        await git.ensureCleanWorkingTree({
          allowDirty: config.execution?.allowDirtyWorkingTree,
        });

        // Create and switch to agent branch
        const branchName = `agent/${runId}`;
        await git.createAndCheckoutBranch(branchName);
        if (globalOpts.verbose) {
          renderer.log(`Created and checked out branch "${branchName}"`);
        }

        // Validate providers
        const validateProvider = (role: string, providerId?: string) => {
          if (providerId) {
            if (!config.providers || !config.providers[providerId]) {
              const available = config.providers
                ? Object.keys(config.providers).join(', ')
                : 'none';
              throw new Error(
                `Unknown ${role} provider: "${providerId}". Available providers: ${available}`,
              );
            }
          }
        };

        validateProvider('planner', config.defaults?.planner);
        validateProvider('executor', config.defaults?.executor);
        validateProvider('reviewer', config.defaults?.reviewer);

        const artifacts = await createRunDir(repoRoot, runId);
        const logger = new JsonlLogger(artifacts.trace);

        ConfigLoader.writeEffectiveConfig(config, artifacts.root);

        const costTracker = new CostTracker(config);
        const toolTracker = new ToolRunTracker();

        // Initialize Registry and wiring
        const registry = new ProviderRegistry(config, costTracker);

        // TODO: Move this to a central adapter registration location
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

        const emitEvent = async (e: OrchestratorEvent) => {
          await logger.log(e);
          toolTracker.handleEvent(e);
        };

        if (config.defaults?.planner && config.defaults?.executor && config.defaults?.reviewer) {
          await registry.resolveRoleProviders(
            {
              plannerId: config.defaults.planner,
              executorId: config.defaults.executor,
              reviewerId: config.defaults.reviewer,
            },
            { eventBus: { emit: emitEvent }, runId },
          );
        } else {
          // If missing roles, we might want to warn or error, but for now we follow existing logic
          // which is just to render status.
          // However, to satisfy "Run trace includes ProviderSelected events", we must resolve them if possible.
          if (globalOpts.verbose) {
            renderer.log('Skipping provider resolution: missing default roles.');
          }
        }

        if (globalOpts.verbose) {
          renderer.log(`Effective config written to ${artifacts.root}`);
        }

        await writeManifest(artifacts.manifest, {
          runId,
          startedAt: new Date().toISOString(),
          command: `run ${goal}`,
          repoRoot,
          artifactsDir: artifacts.root,
          tracePath: artifacts.trace,
          summaryPath: artifacts.summary,
          effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
          patchPaths: [],
          toolLogPaths: [],
        });

        const costSummary = costTracker.getSummary();
        const toolRunSummary = toolTracker.getSummary();
        const fullSummary = {
          ...costSummary,
          toolRuns: toolRunSummary,
        };
        await fs.writeFile(artifacts.summary, JSON.stringify(fullSummary, null, 2));

        // Save final diff
        const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);

        try {
          const finalDiff = await git.diffToHead();
          // Always write final diff patch if we have diff
          if (finalDiff) {
            await patchStore.saveFinalDiff(finalDiff);
            if (globalOpts.verbose) {
              renderer.log('Saved final diff to artifacts.');
            }
          }
        } catch (err) {
          console.error('Failed to save final diff:', err);
        }

        renderer.render({
          status: 'running',
          goal,
          runId,
          artifactsDir: artifacts.root,
          providers: config.defaults,
          cost: costSummary,
          nextSteps: [
            `View detailed logs in ${path.join(artifacts.root, 'run.log')}`, // Example next step
            'Monitor progress via the dashboard (if available)',
          ],
        });
      } catch (err: unknown) {
        if (err instanceof Error) {
          renderer.error(err.message);
        } else {
          renderer.error('An unknown error occurred');
          // For unknown errors, we might want to log the object to stderr too
          console.error(err);
        }
        process.exit(2);
      }
    });
}
