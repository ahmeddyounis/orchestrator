import { Command } from 'commander';

export function registerPlanCommand(program: Command) {
  program
    .command('plan')
    .argument('<goal>', 'The goal to plan')
    .description('Plan a task based on a goal')
    .action((goal) => {
      const globalOpts = program.opts();
      console.log(`Planning goal: "${goal}"`);
      if (globalOpts.verbose) console.log('Verbose mode enabled');
      if (globalOpts.config) console.log(`Config path: ${globalOpts.config}`);
      if (globalOpts.json) console.log(JSON.stringify({ status: 'planning', goal }));
    });
}
