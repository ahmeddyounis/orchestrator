export type ToolClassification =
  | 'read_only'
  | 'build'
  | 'test'
  | 'format'
  | 'install'
  | 'network'
  | 'destructive'
  | 'unknown';

export interface ToolPolicy {
  enabled: boolean;
  requireConfirmation: boolean;
  allowlistPrefixes: string[];
  denylistPatterns: string[];
  allowNetwork: boolean;
  maxOutputBytes: number;
  timeoutMs: number;
}

export interface ToolRunRequest {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  reason: string;
  classification?: ToolClassification;
}

export interface ToolRunResult {
  exitCode: number;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  truncated: boolean;
}
