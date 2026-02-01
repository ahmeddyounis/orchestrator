import pc from 'picocolors';

export interface OutputResult {
  status?: 'SUCCESS' | 'FAILURE';
  goal?: string;
  suite?: string;
  runId?: string;
  artifactsDir?: string;
  providers?: Record<string, string | undefined>;
  cost?: {
    providers: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd?: number | null;
      }
    >;
    total: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd?: number | null;
    };
  };
  nextSteps?: string[];
  verification?: {
    enabled: boolean;
    passed: boolean;
    summary?: string;
    failedChecks?: string[];
    reportPaths?: string[];
  };
  changedFiles?: string[];
  stopReason?: string;
  lastFailureSignature?: string;
  [key: string]: unknown;
}

export class OutputRenderer {
  constructor(private isJson: boolean) {}

  render(data: OutputResult): void {
    if (this.isJson) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      this.renderHuman(data);
    }
  }

  private renderHuman(data: OutputResult): void {
    if (data.status === 'SUCCESS') {
      this.renderSuccess(data);
    } else if (data.status === 'FAILURE') {
      this.renderFailure(data);
    } else {
      this.renderVerbose(data);
    }
  }

  private renderSuccess(data: OutputResult): void {
    console.log(`\n${pc.green('✅ Run succeeded.')}`);

    if (data.changedFiles && data.changedFiles.length > 0) {
      console.log(pc.bold('\nChanged files:'));
      data.changedFiles.slice(0, 10).forEach((file) => console.log(`  - ${file}`));
      if (data.changedFiles.length > 10) {
        console.log(`  ... and ${data.changedFiles.length - 10} more.`);
      }
    }

    if (data.verification) {
      console.log(pc.bold('\nVerification:'));
      if (!data.verification.enabled) {
        console.log(pc.gray('  Not run.'));
      } else {
        const icon = data.verification.passed ? pc.green('✅') : pc.red('❌');
        console.log(
          `  ${icon} ${data.verification.summary ?? (data.verification.passed ? 'Verified' : 'Failed')}`,
        );
      }
    }

    this.renderCost(data);

    console.log(pc.bold('\nArtifacts:'));
    if (data.runId) {
      console.log(`  Run ID: ${data.runId}`);
    }
    if (data.artifactsDir) {
      console.log(`  Diff: ${data.artifactsDir}/run.diff`);
      console.log(`  Report: ${data.artifactsDir}/report.json`);
    }

    console.log(pc.bold('\nNext steps:'));
    if (data.runId) {
      console.log(
        `  - To review the full report, run: ${pc.cyan(`orchestrator report ${data.runId}`)}`,
      );
    }
    console.log(`  - To apply changes, commit them to your repository.`);
  }

  private renderFailure(data: OutputResult): void {
    console.log(`\n${pc.red('❌ Run failed.')}`);

    if (data.stopReason) {
      console.log(`  ${pc.bold('Reason:')} ${data.stopReason}`);
    }
    if (data.lastFailureSignature) {
      console.log(`  ${pc.bold('Error:')} ${data.lastFailureSignature}`);
    }

    if (data.artifactsDir) {
      console.log(pc.bold('\nDiagnostics:'));
      console.log(`  - Logs: ${data.artifactsDir}/logs/`);
      console.log(`  - Verification reports: ${data.artifactsDir}/verification/`);
    }

    console.log(pc.bold('\nNext steps:'));
    console.log(`  - Try increasing the budget with the ${pc.cyan('--max-total-cost')} flag.`);
    console.log(`  - Try a different executor with the ${pc.cyan('--executor')} flag.`);
    console.log(`  - Run full tests with ${pc.cyan('--verify')}.`);
  }

  private renderCost(data: OutputResult): void {
    if (data.cost?.total) {
      console.log(pc.bold('\nCost & Time:'));
      const { total } = data.cost;
      const costStr =
        typeof total.estimatedCostUsd === 'number'
          ? ` ($${total.estimatedCostUsd.toFixed(4)})`
          : '';
      console.log(`  - Total: ${total.totalTokens} tokens${costStr}`);
    }
  }

  private renderVerbose(data: OutputResult): void {
    if (data.status) console.log(`Status: ${data.status}`);
    if (data.goal) console.log(`Goal: ${data.goal}`);
    if (data.suite) console.log(`Suite: ${data.suite}`);
    if (data.runId) console.log(`Run ID: ${data.runId}`);
    if (data.artifactsDir) console.log(`Artifacts: ${data.artifactsDir}`);

    if (data.verification) {
      console.log('\nVerification:');
      if (!data.verification.enabled) {
        console.log('  Status: Not run');
      } else {
        const icon = data.verification.passed ? '✅' : '❌';
        console.log(
          `  Status: ${icon} ${data.verification.passed ? 'Verified' : 'Verification failed'}`,
        );
        if (data.verification.failedChecks && data.verification.failedChecks.length > 0) {
          console.log(`  Failed Checks: ${data.verification.failedChecks.join(', ')}`);
        }
        if (data.verification.reportPaths && data.verification.reportPaths.length > 0) {
          console.log('  Reports:');
          data.verification.reportPaths.forEach((p) => console.log(`    - ${p}`));
        }
      }
    }

    if (data.providers) {
      const activeProviders = Object.entries(data.providers).filter(([, provider]) => !!provider);

      if (activeProviders.length > 0) {
        console.log('Selected Providers:');
        activeProviders.forEach(([role, provider]) => {
          console.log(`  - ${role}: ${provider}`);
        });
      }
    }

    if (data.cost) {
      const providers = Object.entries(data.cost.providers ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      if (providers.length > 0 || data.cost.total) {
        console.log('\nCosts:');
        for (const [id, stats] of providers) {
          const costStr =
            typeof stats.estimatedCostUsd === 'number'
              ? ` ($${stats.estimatedCostUsd.toFixed(4)})`
              : '';
          console.log(
            `  - ${id}: ${stats.totalTokens} tok (in ${stats.inputTokens}, out ${stats.outputTokens})${costStr}`,
          );
        }

        if (data.cost.total) {
          const totalCostStr =
            typeof data.cost.total.estimatedCostUsd === 'number'
              ? ` ($${data.cost.total.estimatedCostUsd.toFixed(4)})`
              : '';
          console.log(
            `  Total: ${data.cost.total.totalTokens} tok (in ${data.cost.total.inputTokens}, out ${data.cost.total.outputTokens})${totalCostStr}`,
          );
        }
      }
    }

    if (data.nextSteps && data.nextSteps.length > 0) {
      console.log('Next Steps:');
      data.nextSteps.forEach((step) => console.log(`  - ${step}`));
    }
  }

  log(message: string): void {
    if (this.isJson) {
      // JSON mode should not have logs
    } else {
      console.log(pc.gray(message));
    }
  }

  error(message: string | Error): void {
    const msg = message instanceof Error ? message.message : message;
    if (this.isJson) {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error(pc.red(msg));
    }
  }
}
