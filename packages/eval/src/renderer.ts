
import {
  type EvalResult,
  type EvalTask,
  type EvalTaskResult,
} from '@orchestrator/shared';
import chalk from 'chalk';

export class SimpleRenderer {
  logSuiteStarted(suiteName: string) {
    console.log(chalk.bold.cyan(`\nRunning evaluation suite: "${suiteName}"`));
    console.log('='.repeat(80));
  }

  logTaskStarted(task: EvalTask, index: number, total: number, baseline = false) {
    const baselineTag = baseline ? chalk.yellow('[BASELINE] ') : '';
    console.log(
      chalk.gray(`\n(${index + 1}/${total})`) + 
        ` ${baselineTag}Starting task: ${chalk.bold(task.id)} - ${task.title}`,
    );
  }

  logTaskFinished(result: EvalTaskResult, baseline = false) {
    const baselineTag = baseline ? chalk.yellow('[BASELINE] ') : '';
    let statusBadge: string;
    switch (result.status) {
      case 'pass':
        statusBadge = chalk.green.bold('PASS');
        break;
      case 'fail':
        statusBadge = chalk.red.bold('FAIL');
        break;
      case 'error':
        statusBadge = chalk.red.bold('ERROR');
        break;
      default:
        statusBadge = chalk.gray.bold('SKIP');
    }
    console.log(
      `  ${baselineTag}Finished task: ${chalk.bold(result.taskId)} in ` +
        result.durationMs +
        `ms. Status: ${statusBadge}`,
    );

    if (result.status === 'error' && result.failure) {
        console.log(chalk.red(`    Error: ${result.failure.message}`));
    }
  }

  logSuiteFinished(result: EvalResult, reportPath: string) {
    const { aggregates: ag } = result;
    console.log('='.repeat(80));
    console.log(chalk.bold.cyan('Evaluation Summary'));
    console.log('='.repeat(80));

    const successRate = ag.passRate * 100;
    const rateColor =
      successRate > 80 ? chalk.green : successRate > 50 ? chalk.yellow : chalk.red;

    console.log(`
      Suite:          ${chalk.bold(result.suiteName)}
      Start Time:     ${new Date(result.startedAt).toLocaleString()}
      Duration:       ${(ag.totalDurationMs / 1000).toFixed(2)}s
      
      Tasks:          ${ag.totalTasks}
      - Passed:       ${chalk.green(ag.passed)}
      - Failed:       ${chalk.red(ag.failed)}
      - Errors:       ${chalk.red(ag.error)}
      
      Success Rate:   ${rateColor(`${successRate.toFixed(2)}%`)}
      Avg Duration:   ${(ag.avgDurationMs / 1000).toFixed(2)}s
      Total Cost:     $${(ag.totalCostUsd ?? 0).toFixed(4)}
    `);

    console.log(chalk.cyan(`\nFull report available at: ${reportPath}`));
  }
}
