import { Command } from 'commander';
import { registerIndexBuildCommand } from './index/build';
import { registerIndexStatusCommand } from './index/status';
import { registerIndexUpdateCommand } from './index/update';

export function registerIndexCommand(program: Command) {
  const indexCommand = program.command('index').description('Manage repository index');

  registerIndexBuildCommand(indexCommand);
  registerIndexStatusCommand(indexCommand);
  registerIndexUpdateCommand(indexCommand);
}
