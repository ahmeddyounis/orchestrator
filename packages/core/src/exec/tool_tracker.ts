import { OrchestratorEvent } from '@orchestrator/shared';

export interface ToolRunSummaryItem {
  toolRunId: string;
  command: string;
  exitCode: number;
  durationMs: number;
}

export class ToolRunTracker {
  private runs = new Map<string, Partial<ToolRunSummaryItem>>();

  handleEvent(event: OrchestratorEvent) {
    if (event.type === 'ToolRunRequested') {
      this.runs.set(event.payload.toolRunId, {
        toolRunId: event.payload.toolRunId,
        command: event.payload.command
      });
    } else if (event.type === 'ToolRunFinished') {
      const run = this.runs.get(event.payload.toolRunId);
      if (run) {
        run.exitCode = event.payload.exitCode;
        run.durationMs = event.payload.durationMs;
      }
    }
  }

  getSummary(): ToolRunSummaryItem[] {
    return Array.from(this.runs.values())
      .filter(r => r.exitCode !== undefined && r.command !== undefined) as ToolRunSummaryItem[];
  }
}
