import { ToolRunRequest, ToolPolicy, ToolRunResult } from '@orchestrator/shared';
export interface RunnerContext {
  runId: string;
  toolRunId?: string;
  cwd?: string;
}
export interface UserInterface {
  confirm(message: string, details?: string, defaultNo?: boolean): Promise<boolean>;
}
export declare class SafeCommandRunner {
  checkPolicy(
    req: Pick<ToolRunRequest, 'command' | 'classification'>,
    policy: ToolPolicy,
  ): {
    isAllowed: boolean;
    needsConfirmation: boolean;
    reason?: string;
  };
  run(
    req: ToolRunRequest,
    policy: ToolPolicy,
    ui: UserInterface,
    ctx: RunnerContext,
  ): Promise<ToolRunResult>;
  protected exec(
    req: ToolRunRequest,
    policy: ToolPolicy,
    stdoutPath: string,
    stderrPath: string,
  ): Promise<ToolRunResult>;
}
//# sourceMappingURL=runner.d.ts.map
