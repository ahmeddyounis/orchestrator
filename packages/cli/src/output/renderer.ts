export interface OutputResult {
  status?: string;
  goal?: string;
  suite?: string;
  runId?: string;
  artifactsDir?: string;
  providers?: Record<string, string | undefined>;
  nextSteps?: string[];
  verification?: {
    enabled: boolean;
    passed: boolean;
    summary?: string;
    failedChecks?: string[];
    reportPaths?: string[];
  };
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

    if (data.nextSteps && data.nextSteps.length > 0) {
      console.log('Next Steps:');
      data.nextSteps.forEach((step) => console.log(`  - ${step}`));
    }
  }

  log(message: string): void {
    if (this.isJson) {
      console.error(message);
    } else {
      console.log(message);
    }
  }

  error(message: string | Error): void {
    const msg = message instanceof Error ? message.message : message;
    console.error(msg);
  }
}
