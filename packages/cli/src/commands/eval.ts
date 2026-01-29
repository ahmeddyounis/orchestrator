import { Command } from 'commander';
import { OutputRenderer } from '../output/renderer';

export function registerEvalCommand(program: Command) {
  program
    .command('eval')
    .requiredOption('--suite <path>', 'Path to the evaluation suite')
    .description('Run an evaluation suite')
    .action((options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      renderer.log(`Evaluating suite: "${options.suite}"`);
      if (globalOpts.verbose) renderer.log('Verbose mode enabled');
      if (globalOpts.config) renderer.log(`Config path: ${globalOpts.config}`);

      renderer.render({ status: 'evaluating', suite: options.suite });
    });
}
