#!/usr/bin/env node
import { Command } from 'commander';
import { version } from '../package.json';
import { registerRunCommand } from './commands/run';
import { registerFixCommand } from './commands/fix';
import { registerPlanCommand } from './commands/plan';
import { registerEvalCommand } from './commands/eval';
import { registerMemoryCommand } from './commands/memory';
import { registerIndexCommand } from './commands/index';
import { registerDoctorCommand } from './commands/doctor';
import { registerInitCommand } from './commands/init';

import { AppError, ConfigError, UsageError } from '@orchestrator/shared';

const program = new Command();

program
  .name('orchestrator')
  .description('Orchestrator CLI')
  .version(version)
  .option('--json', 'Output results as JSON')
  .option('--config <path>', 'Path to configuration file')
  .option('--verbose', 'Enable verbose logging')
  .option('--yes', 'Automatically answer "yes" to all prompts')
  .option('--non-interactive', 'Disable interactive prompts (fail if prompt needed)');

registerRunCommand(program);
registerFixCommand(program);
registerPlanCommand(program);
registerEvalCommand(program);
registerMemoryCommand(program);
registerIndexCommand(program);
registerDoctorCommand(program);
registerInitCommand(program);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    const opts = program.opts();

    if (opts.json) {
      if (e instanceof AppError) {
        console.log(
          JSON.stringify({
            error: {
              code: e.code,
              message: e.message,
              details: e.details,
            },
          }),
        );
      } else {
        console.log(
          JSON.stringify({
            error: {
              code: 'UnknownError',
              message: e instanceof Error ? e.message : String(e),
            },
          }),
        );
      }
    } else {
      // Human-readable output
      console.error(`❌ Error: ${(e instanceof Error && e.message) || String(e)}`);
      if (e instanceof AppError && e.details) {
        console.error(
          `  Details: ${typeof e.details === 'string' ? e.details : JSON.stringify(e.details, null, 2)}`,
        );
      }
      if (opts.verbose && e instanceof Error && e.stack) {
        console.error(`\nStack Trace:\n${e.stack}`);
      } else {
        console.error(`\nFor more details, run with the --verbose flag.`);
      }
    }

    if (e instanceof ConfigError || e instanceof UsageError) {
      process.exit(2);
    } else {
      process.exit(1);
    }
  }
}

main();
