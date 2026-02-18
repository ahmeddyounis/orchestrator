import type { OrchestratorEvent } from '../types/events';
import type { ContextStackFrame } from './types';
import { CONTEXT_STACK_FRAME_SCHEMA_VERSION } from './types';
import { ContextStackStore } from './store';
import path from 'path';

type ToolRunInfo = {
  command: string;
  reason?: string;
  classification?: string;
};

function summarizeList(items: string[], maxItems: number): string {
  const trimmed = items.map((s) => String(s).trim()).filter(Boolean);
  if (trimmed.length <= maxItems) return trimmed.join(', ');
  return `${trimmed.slice(0, maxItems).join(', ')}, ...(+${trimmed.length - maxItems} more)`;
}

export class ContextStackRecorder {
  private readonly toolRuns = new Map<string, ToolRunInfo>();

  constructor(
    private readonly store: ContextStackStore,
    private readonly options: {
      repoRoot: string;
      runId: string;
      runArtifactsRoot?: string;
      enabled: boolean;
    },
  ) {}

  async onEvent(event: OrchestratorEvent): Promise<void> {
    if (!this.options.enabled) return;

    // Track tool runs across requested/finished.
    if (event.type === 'ToolRunRequested') {
      this.toolRuns.set(event.payload.toolRunId, {
        command: event.payload.command,
        reason: event.payload.reason,
        classification: event.payload.classification,
      });
      return;
    }

    const frame = this.frameFromEvent(event);
    if (!frame) return;

    try {
      await this.store.append(frame);
    } catch {
      // Non-fatal: context stack should never crash a run.
    }
  }

  private frameFromEvent(event: OrchestratorEvent): ContextStackFrame | null {
    const base: Omit<ContextStackFrame, 'kind' | 'title' | 'summary'> = {
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: event.timestamp,
      runId: event.runId,
    };

    switch (event.type) {
      case 'RunStarted':
        return {
          ...base,
          kind: event.type,
          title: 'Run started',
          summary: event.payload.goal,
        };
      case 'PlanCreated': {
        const steps = event.payload.planSteps ?? [];
        const summary = steps.length
          ? `${steps.length} steps: ${summarizeList(steps, 5)}`
          : 'Plan created (0 steps)';
        const artifacts: string[] = [];
        if (this.options.runArtifactsRoot) {
          artifacts.push(
            path.relative(
              this.options.repoRoot,
              path.join(this.options.runArtifactsRoot, 'plan.json'),
            ),
          );
        }
        return {
          ...base,
          kind: event.type,
          title: 'Plan created',
          summary,
          ...(artifacts.length ? { artifacts } : {}),
        };
      }
      case 'StepFinished':
        return {
          ...base,
          kind: event.type,
          title: `Step ${event.payload.success ? 'finished' : 'failed'}`,
          summary: event.payload.success
            ? event.payload.step
            : `${event.payload.step}${event.payload.error ? ` — ${event.payload.error}` : ''}`,
        };
      case 'PatchApplied':
        return {
          ...base,
          kind: event.type,
          title: `Patch ${event.payload.success ? 'applied' : 'failed'}`,
          summary: event.payload.filesChanged?.length
            ? summarizeList(event.payload.filesChanged, 10)
            : (event.payload.description ?? 'No file list'),
        };
      case 'VerificationFinished':
        return {
          ...base,
          kind: event.type,
          title: `Verification ${event.payload.passed ? 'passed' : 'failed'}`,
          summary: event.payload.passed
            ? 'All checks passed'
            : event.payload.failedChecks?.length
              ? `Failed: ${summarizeList(event.payload.failedChecks, 10)}`
              : 'Failed checks not provided',
        };
      case 'RunFinished':
        return {
          ...base,
          kind: event.type,
          title: `Run ${event.payload.status}`,
          summary: event.payload.summary ?? '(no summary)',
        };
      case 'RunStopped':
        return {
          ...base,
          kind: event.type,
          title: 'Run stopped',
          summary: event.payload.reason,
          ...(event.payload.details ? { details: String(event.payload.details) } : {}),
        };
      case 'RunEscalated':
        return {
          ...base,
          kind: event.type,
          title: 'Run escalated',
          summary: `${event.payload.from} → ${event.payload.to} (${event.payload.reason})`,
        };
      case 'ToolRunFinished': {
        const info = this.toolRuns.get(event.payload.toolRunId);
        this.toolRuns.delete(event.payload.toolRunId);

        const title = `Tool ${event.payload.exitCode === 0 ? 'succeeded' : 'failed'}`;
        const summaryParts: string[] = [];
        if (info?.command) summaryParts.push(info.command);
        summaryParts.push(`exitCode=${event.payload.exitCode}`);
        if (event.payload.truncated) summaryParts.push('output=truncated');

        const artifacts: string[] = [];
        if (event.payload.stdoutPath) artifacts.push(event.payload.stdoutPath);
        if (event.payload.stderrPath) artifacts.push(event.payload.stderrPath);

        return {
          ...base,
          kind: event.type,
          title,
          summary: summaryParts.join(' | '),
          ...(info?.reason ? { details: `Reason: ${info.reason}` } : {}),
          ...(artifacts.length ? { artifacts } : {}),
        };
      }
      default:
        return null;
    }
  }
}
