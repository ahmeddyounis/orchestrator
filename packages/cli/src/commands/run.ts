import { Command } from 'commander';
import { ConfigLoader, ProviderRegistry } from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';
import {
  createRunDir,
  writeManifest,
  JsonlLogger,
  ProviderCapabilities,
  ProviderConfig,
} from '@orchestrator/shared';
import path from 'path';
import { OutputRenderer } from '../output/renderer';

function parseBudgets(value: string, previous: Record<string, number>): Record<string, number> {
  const [key, val] = value.split('=');
  if (key && val) {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      previous[key] = num;
    }
  }
  return previous;
}

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .argument('<goal>', 'The goal to run')
    .description('Run an agentic task to achieve a goal')
    .option('--budget <key=value>', 'Set budget overrides (e.g. gpt4=100)', parseBudgets, {})
    .option('--planner <providerId>', 'Override planner provider')
    .option('--executor <providerId>', 'Override executor provider')
    .option('--reviewer <providerId>', 'Override reviewer provider')
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      if (globalOpts.verbose) renderer.log(`Running goal: "${goal}"`);

      try {
        const repoRoot = await findRepoRoot();

        const config = ConfigLoader.load({
          configPath: globalOpts.config,
          flags: {
            budgets: options.budget,
            defaults: {
              planner: options.planner,
              executor: options.executor,
              reviewer: options.reviewer,
            },
          },
        });

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

        const runId = Date.now().toString();
        const artifacts = await createRunDir(repoRoot, runId);
        const logger = new JsonlLogger(artifacts.trace);

        ConfigLoader.writeEffectiveConfig(config, artifacts.root);

        // Initialize Registry and wiring
        const registry = new ProviderRegistry(config);

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

        if (config.defaults?.planner && config.defaults?.executor && config.defaults?.reviewer) {
          await registry.resolveRoleProviders(
            {
              plannerId: config.defaults.planner,
              executorId: config.defaults.executor,
              reviewerId: config.defaults.reviewer,
            },
            { eventBus: { emit: (e) => logger.log(e) }, runId },
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

        renderer.render({
          status: 'running',
          goal,
          runId,
          artifactsDir: artifacts.root,
          providers: config.defaults,
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
