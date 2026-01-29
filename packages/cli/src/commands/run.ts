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
    .action((goal, options) => {
      const globalOpts = program.opts();
      if (globalOpts.verbose) console.log(`Running goal: "${goal}"`);

      try {
        const config = ConfigLoader.load({
          configPath: globalOpts.config,
          flags: {
            budgets: options.budget
          }
        });

        const runDir = path.join(process.cwd(), '.runs', Date.now().toString());
        ConfigLoader.writeEffectiveConfig(config, runDir);

        if (globalOpts.verbose) {
           console.log(`Effective config written to ${runDir}`);
        }
        
        if (globalOpts.json) {
           console.log(JSON.stringify({ status: 'running', goal, runDir }));
        } else {
           console.log(`Run started in ${runDir}`);
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