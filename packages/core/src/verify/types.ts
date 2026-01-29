export interface CheckResult {
  name: string;
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  passed: boolean;
  truncated: boolean;
}

export interface VerificationReport {
  passed: boolean;
  checks: CheckResult[];
  summary: string;
  failureSignature?: string;
}

export interface VerificationScope {
  touchedFiles?: string[];
}

export type VerificationMode = 'auto' | 'custom';

export interface VerificationProfile {
  enabled: boolean;
  mode: VerificationMode;
  steps: Array<{
    name: string;
    command: string;
    required: boolean;
    timeoutMs?: number;
    allowNetwork?: boolean;
  }>;
  auto: {
    enableLint: boolean;
    enableTypecheck: boolean;
    enableTests: boolean;
    testScope: 'targeted' | 'full';
    maxCommandsPerIteration: number;
  };
}
