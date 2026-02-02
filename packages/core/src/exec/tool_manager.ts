import {
  SafeCommandRunner,
  RunnerContext,
  UserInterface,
  SandboxProvider,
  NoneSandboxProvider,
} from '@orchestrator/exec';
import {
  ToolRunRequest,
  ToolPolicy,
  ToolRunResult,
  MANIFEST_VERSION,
  AppError,
  UsageError,
  ToolError,
  dirname,
  normalizePath,
  relative,
  updateManifest,
} from '@orchestrator/shared';
import { randomUUID } from 'crypto';
import { EventBus } from '../registry';

class ObservableSafeCommandRunner extends SafeCommandRunner {
  constructor(
    private eventBus: EventBus,
    private runId: string,
    private toolRunId: string,
  ) {
    super();
  }

  async run(
    req: ToolRunRequest,
    policy: ToolPolicy,
    ui: UserInterface,
    ctx: RunnerContext,
  ): Promise<ToolRunResult> {
    await this.eventBus.emit({
      type: 'ToolRunRequested',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      payload: {
        toolRunId: this.toolRunId,
        command: req.command,
        classification: req.classification || 'unknown',
        reason: req.reason,
      },
    });

    try {
      return await super.run(req, policy, ui, ctx);
    } catch (err) {
      const error = err as AppError;

      // Check for denial errors
      if (error instanceof UsageError || error instanceof ToolError) {
        let reason = 'unknown';
        if (typeof error.details === 'object' && error.details && 'reason' in error.details) {
          reason = error.details.reason as string;
        } else if (error.message.includes('network access')) {
          reason = 'network_denied';
        } else if (error.message.includes('shell')) {
          reason = 'shell_disallowed';
        } else if (error.message.includes('User denied')) {
          reason = 'user_denied';
        }

        await this.eventBus.emit({
          type: 'ToolRunBlocked',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId,
          payload: {
            toolRunId: this.toolRunId,
            command: req.command,
            reason: reason,
          },
        });
      }
      throw err;
    }
  }

  protected async exec(
    req: ToolRunRequest,
    policy: ToolPolicy,
    stdoutPath: string,
    stderrPath: string,
  ): Promise<ToolRunResult> {
    // If we reached here, it was approved (or auto-approved)
    await this.eventBus.emit({
      type: 'ToolRunApproved',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      payload: {
        toolRunId: this.toolRunId,
        command: req.command,
      },
    });

    await this.eventBus.emit({
      type: 'ToolRunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      payload: {
        toolRunId: this.toolRunId,
      },
    });

    const result = await super.exec(req, policy, stdoutPath, stderrPath);

    await this.eventBus.emit({
      type: 'ToolRunFinished',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      payload: {
        toolRunId: this.toolRunId,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
        truncated: result.truncated,
      },
    });

    return result;
  }
}

export class ToolManager {
  constructor(
    private eventBus: EventBus,
    private manifestPath: string,
    private repoRoot: string = process.cwd(),
    private sandboxProvider: SandboxProvider = new NoneSandboxProvider(),
  ) {}

  async runTool(
    req: ToolRunRequest,
    policy: ToolPolicy,
    ui: UserInterface,
    ctx: RunnerContext,
  ): Promise<ToolRunResult> {
    const toolRunId = ctx.toolRunId || randomUUID();
    const runner = new ObservableSafeCommandRunner(this.eventBus, ctx.runId, toolRunId);

    // Prepare sandbox
    const sandbox = await this.sandboxProvider.prepare(this.repoRoot, ctx.runId);

    // Apply sandbox settings to request if not overridden
    const reqWithSandbox = {
      ...req,
      cwd: req.cwd || sandbox.cwd,
      env: { ...req.env, ...sandbox.envOverrides },
    };

    // Ensure toolRunId is in context for SafeCommandRunner to use it for paths
    const ctxWithId = { ...ctx, toolRunId, cwd: reqWithSandbox.cwd };

    const result = await runner.run(reqWithSandbox, policy, ui, ctxWithId);

    // Update manifest with logs
    // We compute relative paths if possible
    const logPaths = [result.stdoutPath, result.stderrPath];
    await this.updateManifest(logPaths);

    return result;
  }

  private async updateManifest(newLogPaths: string[]): Promise<void> {
    try {
      const runDir = dirname(this.manifestPath);
      const storedPaths = newLogPaths.map((p) => relative(runDir, normalizePath(p)));

      await updateManifest(this.manifestPath, (manifest) => {
        manifest.schemaVersion = manifest.schemaVersion ?? MANIFEST_VERSION;
        manifest.toolLogPaths = [...(manifest.toolLogPaths ?? []), ...storedPaths];
      });
    } catch (err) {
      console.error(`Failed to update manifest at ${this.manifestPath}:`, err);
      // Non-fatal, but logged
    }
  }
}
