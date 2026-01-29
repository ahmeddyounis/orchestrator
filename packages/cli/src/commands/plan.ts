import { Command } from 'commander';
import { OutputRenderer } from '../output/renderer';

export function registerPlanCommand(program: Command) {
  program
    .command('plan')
    .argument('<goal>', 'The goal to plan')
    .description('Plan a task based on a goal')
    .action((goal) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      renderer.log(`Planning goal: "${goal}"`);
      if (globalOpts.verbose) renderer.log('Verbose mode enabled');
      if (globalOpts.config) renderer.log(`Config path: ${globalOpts.config}`);

      renderer.render({ status: 'planning', goal });
    });
}
