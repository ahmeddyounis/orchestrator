import { Command } from 'commander';
import { EvalRunner } from '@orchestrator/eval';
import { OutputRenderer } from '../output/renderer';
import { ConfigLoader } from '@orchestrator/core';
import type { Config } from '@orchestrator/shared';
import path from 'path';
import { findRepoRoot } from '@orchestrator/repo';

export function registerEvalCommand(program: Command) {
  program
    .command('eval')
    .argument('<suitePath>', 'Path to the evaluation suite')
    .option('--baseline <name>', 'Name of the baseline to run against')
    .option('--out <dir>', 'Directory to store evaluation results')
    .description('Run an evaluation suite')
    .action(async (suitePath, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      renderer.log(`Evaluating suite: "${suitePath}"`);
      if (globalOpts.verbose) renderer.log('Verbose mode enabled');

      try {
        const repoRoot = await findRepoRoot();
        const config: Config = ConfigLoader.load({
          configPath: globalOpts.config,
          cwd: repoRoot,
        });

        const evalOutputDir = options.out
          ? path.resolve(options.out)
          : path.join(repoRoot, '.orchestrator', 'eval');

        const runner = new EvalRunner({
          config,
          outputDir: evalOutputDir,
        });

        const result = await runner.runSuite(suitePath, {
          baseline: options.baseline,
          quiet: !!globalOpts.json,
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        }

        // Exit with non-zero if any task failed
        if (result.aggregates.failed > 0 || result.aggregates.error > 0) {
          process.exit(1);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          renderer.error(err.message);
          if (globalOpts.verbose && err.stack) {
            renderer.error(err.stack);
          }
        } else {
          renderer.error('An unknown error occurred during evaluation');
          console.error(err);
        }
        process.exit(2);
      }
    });
}
