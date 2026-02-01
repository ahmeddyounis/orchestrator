import { Command } from 'commander';
import { promises as fs } from 'fs';
import { which } from 'which';
import { isWindows, isWSL } from '@orchestrator/shared';
import chalk from 'chalk';

const CHECKS = {
  OK: chalk.green('✔'),
  WARN: chalk.yellow('!'),
  FAIL: chalk.red('✖'),
};

async function checkExecutable(name: string): Promise<[string, string]> {
  try {
    const path = await which(name);
    return [CHECKS.OK, `${name} found at: ${path}`];
  } catch (e) {
    return [CHECKS.FAIL, `${name} not found in PATH.`];
  }
}

async function checkWSL() {
  if (isWSL()) {
    return [CHECKS.OK, 'Running inside WSL. This is a supported environment.'];
  }
  if (isWindows()) {
    return [
      CHECKS.WARN,
      'Running on native Windows. Full support is experimental. Please use WSL for the best experience.',
    ];
  }
  return [CHECKS.OK, `Running on ${process.platform}. This is a supported environment.`];
}

export const registerDoctorCommand = (program: Command) => {
  const command = new Command('doctor');

  command
    .description('Run checks to diagnose issues with the environment.')
    .action(async () => {
      console.log(chalk.bold('Orchestrator Environment Checkup'));
      console.log('---------------------------------');

      const results: [string, string][] = [];

      results.push(await checkWSL());
      results.push(await checkExecutable('git'));
      results.push(await checkExecutable('rg'));

      results.forEach(([status, message]) => {
        console.log(`${status} ${message}`);
      });

      console.log('---------------------------------');

      const hasFailures = results.some(([status]) => status === CHECKS.FAIL);
      if (hasFailures) {
        console.log(
          chalk.red.bold('Doctor checks failed.') +
            ' Please resolve the issues marked with ' +
            CHECKS.FAIL,
        );
        console.log(
          'See documentation for setup instructions: <https://docs.orchestrator.dev/quickstart>',
        );
      } else {
        console.log(chalk.green.bold('All checks passed. Your environment looks good!'));
      }
    });
  
  program.addCommand(command);
};