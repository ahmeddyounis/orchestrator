import { Command } from 'commander';
import { ConfigLoader } from '@orchestrator/core';
import path from 'path';

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
      if (globalOpts.verbose) console.log(`Running goal: "${goal}"`);

      try {
        const config = ConfigLoader.load({
          configPath: globalOpts.config,
          flags: {
            budgets: options.budget,
            defaults: {
              planner: options.planner,
              executor: options.executor,
              reviewer: options.reviewer
            }
          }
        });

        // Validate providers
        const validateProvider = (role: string, providerId?: string) => {
          if (providerId) {
            if (!config.providers || !config.providers[providerId]) {
              const available = config.providers ? Object.keys(config.providers).join(', ') : 'none';
              throw new Error(`Unknown ${role} provider: "${providerId}". Available providers: ${available}`);
            }
          }
        };

        validateProvider('planner', config.defaults?.planner);
        validateProvider('executor', config.defaults?.executor);
        validateProvider('reviewer', config.defaults?.reviewer);

        const runDir = path.join(process.cwd(), '.runs', Date.now().toString());
        ConfigLoader.writeEffectiveConfig(config, runDir);

        if (globalOpts.verbose) {
           console.log(`Effective config written to ${runDir}`);
        }
        
        if (globalOpts.json) {
           console.log(JSON.stringify({ 
             status: 'running', 
             goal, 
             runDir,
             providers: config.defaults
           }));
        } else {
           console.log(`Run started in ${runDir}`);
           if (config.defaults?.planner) console.log(`Planner: ${config.defaults.planner}`);
           if (config.defaults?.executor) console.log(`Executor: ${config.defaults.executor}`);
           if (config.defaults?.reviewer) console.log(`Reviewer: ${config.defaults.reviewer}`);
        }

      } catch (err: unknown) {
        if (err instanceof Error) {
            console.error(err.message);
        } else {
            console.error('An unknown error occurred', err);
        }
        process.exit(2);
      }
    });
}