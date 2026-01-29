import { Command } from 'commander';
import { ConfigLoader, ProviderRegistry, CostTracker, PlanService } from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';
import { createRunDir, writeManifest, JsonlLogger, OrchestratorEvent } from '@orchestrator/shared';
import { OpenAIAdapter, AnthropicAdapter } from '@orchestrator/adapters';
import { OutputRenderer } from '../output/renderer';
import * as fs from 'fs/promises';
import path from 'path';

export function registerPlanCommand(program: Command) {
  program
    .command('plan')
    .argument('<goal>', 'The goal to plan')
    .description('Plan a task based on a goal')
    .option('--planner <providerId>', 'Override planner provider')
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      if (globalOpts.verbose) renderer.log(`Planning goal: "${goal}"`);

      try {
        const repoRoot = await findRepoRoot();

        const config = ConfigLoader.load({
          configPath: globalOpts.config,
          flags: {
            defaults: {
              planner: options.planner,
            },
          },
        });

        const plannerId = config.defaults?.planner;
        if (!plannerId) {
          throw new Error(
            'No planner provider configured. Please set defaults.planner in your config or use --planner.',
          );
        }

        // Validate planner existence
        if (!config.providers?.[plannerId]) {
          throw new Error(`Planner provider '${plannerId}' not found in configuration.`);
        }

        const runId = Date.now().toString();
        const artifacts = await createRunDir(repoRoot, runId);
        const logger = new JsonlLogger(artifacts.trace);

        ConfigLoader.writeEffectiveConfig(config, artifacts.root);

        const costTracker = new CostTracker(config);
        const registry = new ProviderRegistry(config, costTracker);

        // Register adapters
        registry.registerFactory('openai', (cfg) => new OpenAIAdapter(cfg));
        registry.registerFactory('anthropic', (cfg) => new AnthropicAdapter(cfg));

        const eventBus = {
          emit: async (event: OrchestratorEvent) => {
            await logger.log(event);
          },
        };

        const planner = registry.getAdapter(plannerId);

        // Emit ProviderSelected for planner
        await eventBus.emit({
          type: 'ProviderSelected',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            role: 'planner',
            providerId: plannerId,
            capabilities: planner.capabilities(),
          },
        });

        const planService = new PlanService(eventBus);

        const ctx = {
          runId,
          logger,
          retryOptions: { maxRetries: 3 },
        };

        const planSteps = await planService.generatePlan(goal, { planner }, ctx);

        // Write plan.json
        const planPath = path.join(artifacts.root, 'plan.json');
        await fs.writeFile(planPath, JSON.stringify({ steps: planSteps }, null, 2));

        // Write manifest
        await writeManifest(artifacts.manifest, {
          runId,
          startedAt: new Date().toISOString(),
          command: `plan ${goal}`,
          repoRoot,
          artifactsDir: artifacts.root,
          tracePath: artifacts.trace,
          summaryPath: artifacts.summary,
          effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
          patchPaths: [],
          toolLogPaths: [],
        });

        const costSummary = costTracker.getSummary();
        await fs.writeFile(artifacts.summary, JSON.stringify(costSummary, null, 2));

        renderer.render({
          status: 'success',
          goal,
          runId,
          artifactsDir: artifacts.root,
          providers: { planner: plannerId },
          plan: planSteps,
          cost: costSummary,
          nextSteps: [
            `Review plan at ${planPath}`,
            `Run with: orchestrator run "${goal}"`,
          ],
        });
      } catch (err: unknown) {
        if (err instanceof Error) {
          renderer.error(err.message);
          if (globalOpts.verbose) console.error(err.stack);
        } else {
          renderer.error('An unknown error occurred');
          console.error(err);
        }
        process.exit(1);
      }
    });
}