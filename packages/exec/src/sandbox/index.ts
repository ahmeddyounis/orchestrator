export interface SandboxProvider {
  prepare(
    repoRoot: string,
    runId: string,
  ): Promise<{ cwd: string; envOverrides?: Record<string, string> }>;
}

export class NoneSandboxProvider implements SandboxProvider {
  async prepare(
    repoRoot: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _runId: string,
  ): Promise<{ cwd: string; envOverrides?: Record<string, string> }> {
    return { cwd: repoRoot };
  }
}
