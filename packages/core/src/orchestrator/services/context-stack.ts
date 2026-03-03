import {
  Config,
  ContextStackRecorder,
  ContextStackStore,
  OrchestratorEvent,
  redactObject,
  renderContextStackForPrompt,
} from '@orchestrator/shared';
import type { EventBus } from '../../registry';
import path from 'path';

export interface ContextStackSetupResult {
  eventBus: EventBus;
  store?: ContextStackStore;
  getContextStackText: () => string;
  snapshotPath?: string;
}

export class ContextStackService {
  constructor(
    private readonly config: Config,
    private readonly repoRoot: string,
  ) {}

  async setupForRun(args: {
    runId: string;
    artifactsRoot: string;
    eventBus: EventBus;
  }): Promise<ContextStackSetupResult> {
    const cfg = this.config.contextStack;
    const enabled = cfg?.enabled ?? false;

    if (!enabled) {
      return { eventBus: args.eventBus, getContextStackText: () => '' };
    }

    const filePath = ContextStackStore.resolvePath(this.repoRoot, this.config);
    const store = new ContextStackStore({
      filePath,
      security: this.config.security,
      maxFrames: cfg.maxFrames,
      maxBytes: cfg.maxBytes,
    });

    try {
      await store.load();
    } catch {
      // Non-fatal: missing/invalid stack should not block a run.
    }

    const snapshotPath = path.join(args.artifactsRoot, 'context_stack.snapshot.jsonl');
    try {
      await store.snapshotTo(snapshotPath);
    } catch {
      // Non-fatal: snapshot is best-effort.
    }

    const recorder = new ContextStackRecorder(store, {
      repoRoot: this.repoRoot,
      runId: args.runId,
      runArtifactsRoot: args.artifactsRoot,
      enabled: true,
    });

    const wrappedEventBus: EventBus = {
      emit: async (e) => {
        await args.eventBus.emit(e);
        try {
          const safe = this.config.security?.redaction?.enabled
            ? (redactObject(e) as OrchestratorEvent)
            : e;
          await recorder.onEvent(safe);
        } catch {
          // ignore
        }
      },
    };

    const getContextStackText = (): string =>
      renderContextStackForPrompt(store.getAllFrames(), {
        maxChars: cfg.promptBudgetChars,
        maxFrames: cfg.promptMaxFrames,
      });

    return { eventBus: wrappedEventBus, store, getContextStackText, snapshotPath };
  }
}
