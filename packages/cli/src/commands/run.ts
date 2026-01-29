import { Command } from 'commander';
import { ConfigLoader } from '@orchestrator/core';
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
    .action((goal, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      if (globalOpts.verbose) renderer.log(`Running goal: "${goal}"`);

      try {
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
        const runDir = path.join(process.cwd(), '.runs', runId);
        ConfigLoader.writeEffectiveConfig(config, runDir);

        if (globalOpts.verbose) {
          renderer.log(`Effective config written to ${runDir}`);
        }

        renderer.render({
          status: 'running',
          goal,
          runId,
          artifactsDir: runDir,
          providers: config.defaults,
          nextSteps: [
            `View detailed logs in ${path.join(runDir, 'run.log')}`, // Example next step
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
