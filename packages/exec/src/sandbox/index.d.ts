export interface SandboxProvider {
  prepare(
    repoRoot: string,
    runId: string,
  ): Promise<{
    cwd: string;
    envOverrides?: Record<string, string>;
  }>;
}
export declare class NoneSandboxProvider implements SandboxProvider {
  prepare(
    repoRoot: string,
    _runId: string,
  ): Promise<{
    cwd: string;
    envOverrides?: Record<string, string>;
  }>;
}
//# sourceMappingURL=index.d.ts.map
