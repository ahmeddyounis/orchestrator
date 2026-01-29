import { Command } from 'commander';
import { OutputRenderer } from '../output/renderer';

export function registerFixCommand(program: Command) {
  program
    .command('fix')
    .argument('<goal>', 'The goal to fix')
    .description('Fix an issue based on a goal')
    .action((goal) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      renderer.log(`Fixing goal: "${goal}"`);
      if (globalOpts.verbose) renderer.log('Verbose mode enabled');
      if (globalOpts.config) renderer.log(`Config path: ${globalOpts.config}`);

      renderer.render({ status: 'fixing', goal });
    });
}
