import { Command } from 'commander';
import { EvalRunner } from '@orchestrator/eval';
import { OutputRenderer } from '../output/renderer';

export function registerEvalCommand(program: Command) {
  program
    .command('eval')
    .argument('<suitePath>', 'Path to the evaluation suite')
    .description('Run an evaluation suite')
    .action(async (suitePath, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      renderer.log(`Evaluating suite: "${suitePath}"`);
      if (globalOpts.verbose) renderer.log('Verbose mode enabled');
      if (globalOpts.config) renderer.log(`Config path: ${globalOpts.config}`);

      try {
        const runner = new EvalRunner();
        const result = await runner.runSuite(suitePath, options);
        renderer.render(result);
      } catch (err: unknown) {
        if (err instanceof Error) {
          renderer.error(err.message);
        } else {
          renderer.error('An unknown error occurred during evaluation');
          console.error(err);
        }
        process.exit(2);
      }
    });
}