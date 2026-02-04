import {
  Config,
  createRunDir,
  MANIFEST_VERSION,
  writeManifest,
  JsonlLogger,
  OrchestratorEvent,
  redactObject,
} from '@orchestrator/shared';
import { EventBus } from '../../registry';
import { ConfigLoader } from '../../config/loader';
import { RunArtifacts, RunContext } from './types';
import path from 'path';

/**
 * Service responsible for initializing run artifacts and context
 */
export class RunInitializationService {
  constructor(
    private readonly config: Config,
    private readonly repoRoot: string,
  ) {}

  /**
   * Initialize a new run with all required artifacts
   */
  async initializeRun(runId: string, goal: string): Promise<RunContext> {
    const startTime = Date.now();
    const artifacts = await createRunDir(this.repoRoot, runId);
    ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
    const logger = new JsonlLogger(artifacts.trace);

    const eventBus = this.createEventBus(logger);

    return {
      runId,
      goal,
      startTime,
      artifacts,
      logger,
      eventBus,
      config: this.config,
      repoRoot: this.repoRoot,
    };
  }

  /**
   * Create an event bus that logs events with optional redaction
   */
  private createEventBus(logger: JsonlLogger): EventBus {
    return {
      emit: async (e: OrchestratorEvent) => {
        const redactedEvent = this.config.security?.redaction?.enabled
          ? (redactObject(e) as OrchestratorEvent)
          : e;
        await logger.log(redactedEvent);
      },
    };
  }

  /**
   * Initialize the run manifest
   */
  async initializeManifest(
    artifacts: RunArtifacts,
    runId: string,
    goal: string,
    includeContextPaths = false,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    await writeManifest(artifacts.manifest, {
      schemaVersion: MANIFEST_VERSION,
      runId,
      startedAt,
      command: `run ${goal}`,
      repoRoot: this.repoRoot,
      artifactsDir: artifacts.root,
      tracePath: artifacts.trace,
      summaryPath: artifacts.summary,
      effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
      patchPaths: [],
      ...(includeContextPaths ? { contextPaths: [] } : {}),
      toolLogPaths: [],
      verificationPaths: [],
    });
  }

  /**
   * Emit run started event
   */
  async emitRunStarted(eventBus: EventBus, runId: string, goal: string): Promise<void> {
    await eventBus.emit({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { taskId: runId, goal },
    });
  }

  /**
   * Emit run finished event
   */
  async emitRunFinished(
    eventBus: EventBus,
    runId: string,
    status: 'success' | 'failure',
    summary: string,
  ): Promise<void> {
    await eventBus.emit({
      type: 'RunFinished',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { status, summary },
    });
  }
}
