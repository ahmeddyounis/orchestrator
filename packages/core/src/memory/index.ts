import {
  EpisodicMemory,
  Memory,
  PatchStats,
  ProceduralMemory,
  RepoState,
  ToolRunMeta,
} from './types';
import {
  ToolRunResult,
  redactString,
  redactUnknown,
  OrchestratorEvent,
  RunSummary,
} from '@orchestrator/shared';
import { EventBus } from '../registry';
import { randomUUID } from 'crypto';
import { VerificationReport } from '../verify/types';
import { createMemoryStore, VectorMemoryBackend } from '@orchestrator/memory';
import { Embedder } from '@orchestrator/adapters';

const memoryStore = new Map<string, Memory>();

const MAX_CONTENT_LENGTH = 8 * 1024; // 8KB
const MAX_EMBED_CONTENT_LENGTH = 4 * 1024; // 4KB

let sqliteStore: ReturnType<typeof createMemoryStore> | null = null;
let sqliteInitPath: string | null = null;

function ensureSqliteStore(dbPath: string) {
  if (sqliteStore && sqliteInitPath === dbPath) return sqliteStore;
  sqliteStore?.close();
  sqliteStore = createMemoryStore();
  sqliteStore.init(dbPath);
  sqliteInitPath = dbPath;
  return sqliteStore;
}

type ApplicableClassification = 'test' | 'build' | 'lint' | 'format';
const applicableClassifications: ApplicableClassification[] = ['test', 'build', 'lint', 'format'];

export interface MemoryWriterDependencies {
  eventBus?: EventBus;
  runId?: string;
  embedder?: Embedder;
  vectorBackend?: VectorMemoryBackend;
}

export class MemoryWriter {
  private readonly eventBus?: EventBus;
  private readonly runId: string;
  private readonly embedder?: Embedder;
  private readonly vectorBackend?: VectorMemoryBackend;

  constructor(deps: MemoryWriterDependencies = {}) {
    this.eventBus = deps.eventBus;
    this.runId = deps.runId || 'unknown';
    this.embedder = deps.embedder;
    this.vectorBackend = deps.vectorBackend;
  }

  private async logRedactions(count: number, context: string) {
    if (count > 0 && this.eventBus) {
      await this.eventBus.emit({
        type: 'MemoryRedaction',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: this.runId,
        payload: {
          count,
          context,
        },
      } as OrchestratorEvent);
    }
  }

  private async embedAndUpsert(repoId: string, memory: Memory, repoState: RepoState) {
    if (!this.embedder || !this.vectorBackend) {
      return;
    }

    const textToEmbed = memory.title + '\n' + memory.content.substring(0, MAX_EMBED_CONTENT_LENGTH);
    const vectors = await this.embedder.embedTexts([textToEmbed]);

    if (vectors.length > 0) {
      await this.vectorBackend.upsert(repoId, [
        { id: memory.id, vector: vectors[0], metadata: { type: memory.type } },
      ]);
      if (repoState.memoryDbPath) {
        const store = ensureSqliteStore(repoState.memoryDbPath);
        store.markVectorUpdated(memory.id);
      }
    }
  }

  async extractEpisodic(
    runSummary: {
      runId: string;
      goal: string;
      status: 'success' | 'failure';
      stopReason: string;
    },
    repoState: RepoState,
    verificationReport?: VerificationReport,
    patchStats?: PatchStats,
  ): Promise<EpisodicMemory> {
    const { runId, status, goal, stopReason } = runSummary;
    const title = `Run ${runId}: ${status} - ${goal.substring(0, 40)}${goal.length > 40 ? '...' : ''}`;

    const contentPayload = {
      goal,
      status,
      stopReason,
      verification: verificationReport
        ? {
            passed: verificationReport.passed,
            summary: verificationReport.summary,
            failureSignature: verificationReport.failureSignature,
          }
        : undefined,
      patch: patchStats
        ? {
            filesChanged: patchStats.filesChanged,
            insertions: patchStats.insertions,
            deletions: patchStats.deletions,
          }
        : undefined,
    };

    const { redacted: redactedContentPayload, redactionCount: contentRedactions } =
      redactUnknown(contentPayload);
    await this.logRedactions(contentRedactions, `episodic memory content for run ${runId}`);

    let content = JSON.stringify(redactedContentPayload, null, 2);
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '\n... (truncated due to size limit)';
    }

    const evidence = {
      artifactPaths: repoState.artifactPaths ?? [],
      failureSignature: verificationReport?.failureSignature,
    };

    const { redacted: redactedEvidence, redactionCount: evidenceRedactions } =
      redactUnknown(evidence);
    await this.logRedactions(evidenceRedactions, `episodic memory evidence for run ${runId}`);

    const newMemory: EpisodicMemory = {
      type: 'episodic',
      id: randomUUID(),
      title,
      content,
      gitSha: repoState.gitSha,
      evidence: redactedEvidence as EpisodicMemory['evidence'],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    memoryStore.set(newMemory.id, newMemory);

    if (repoState.memoryDbPath && repoState.repoId) {
      const store = ensureSqliteStore(repoState.memoryDbPath);
      store.upsert({
        id: newMemory.id,
        repoId: repoState.repoId,
        type: 'episodic',
        title: newMemory.title,
        content: newMemory.content,
        evidenceJson: JSON.stringify(redactedEvidence),
        gitSha: newMemory.gitSha,
        stale: false,
        createdAt: newMemory.createdAt.getTime(),
        updatedAt: newMemory.updatedAt.getTime(),
      });
      await this.embedAndUpsert(repoState.repoId, newMemory, repoState);
    }

    return newMemory;
  }

  async extractProcedural(
    toolRunMeta: ToolRunMeta,
    toolRunResult: ToolRunResult,
    repoState: RepoState,
  ): Promise<ProceduralMemory | null> {
    const { request, classification, toolRunId } = toolRunMeta;
    const { exitCode, durationMs } = toolRunResult;

    if (
      exitCode !== 0 ||
      !applicableClassifications.includes(classification as ApplicableClassification)
    ) {
      return null;
    }

    const { redacted: normalizedCommand, redactionCount: commandRedactions } = redactString(
      request.command.trim().replace(/\s+/g, ' '),
    );
    await this.logRedactions(commandRedactions, 'procedural memory command');

    const existingMemory = [...memoryStore.values()].find(
      (mem) => mem.type === 'procedural' && mem.content === normalizedCommand,
    ) as ProceduralMemory | undefined;

    const evidence = {
      command: request.command,
      exitCode,
      durationMs,
      toolRunId,
    };

    const { redacted: redactedEvidence, redactionCount: evidenceRedactions } =
      redactUnknown(evidence);
    await this.logRedactions(evidenceRedactions, 'procedural memory evidence');

    if (existingMemory) {
      existingMemory.updatedAt = new Date();
      existingMemory.evidence = redactedEvidence as ProceduralMemory['evidence'];
      existingMemory.gitSha = repoState.gitSha;
      memoryStore.set(existingMemory.id, existingMemory);

      if (repoState.memoryDbPath && repoState.repoId) {
        const store = ensureSqliteStore(repoState.memoryDbPath);
        store.upsert({
          id: existingMemory.id,
          repoId: repoState.repoId,
          type: 'procedural',
          title: existingMemory.title,
          content: existingMemory.content,
          evidenceJson: JSON.stringify(existingMemory.evidence),
          gitSha: existingMemory.gitSha,
          stale: false,
          createdAt: existingMemory.createdAt.getTime(),
          updatedAt: existingMemory.updatedAt.getTime(),
        });
        await this.embedAndUpsert(repoState.repoId, existingMemory, repoState);
      }
      return existingMemory;
    }

    const newMemory: ProceduralMemory = {
      type: 'procedural',
      id: randomUUID(),
      title: this.generateTitle(classification as ApplicableClassification),
      content: normalizedCommand,
      gitSha: repoState.gitSha,
      evidence: redactedEvidence as ProceduralMemory['evidence'],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    memoryStore.set(newMemory.id, newMemory);

    if (repoState.memoryDbPath && repoState.repoId) {
      const store = ensureSqliteStore(repoState.memoryDbPath);
      store.upsert({
        id: newMemory.id,
        repoId: repoState.repoId,
        type: 'procedural',
        title: newMemory.title,
        content: newMemory.content,
        evidenceJson: JSON.stringify(newMemory.evidence),
        gitSha: newMemory.gitSha,
        stale: false,
        createdAt: newMemory.createdAt.getTime(),
        updatedAt: newMemory.updatedAt.getTime(),
      });
      await this.embedAndUpsert(repoState.repoId, newMemory, repoState);
    }

    return newMemory;
  }

  private generateTitle(classification: ApplicableClassification): string {
    switch (classification) {
      case 'test':
        return 'How to run tests';
      case 'build':
        return 'How to build the project';
      case 'lint':
        return 'How to run the linter';
      case 'format':
        return 'How to format the code';
      default:
        return 'How to perform a task';
    }
  }

  async wipe(repoId: string, dbPath: string) {
    const store = ensureSqliteStore(dbPath);
    store.wipe(repoId);
    memoryStore.clear();
    await this.vectorBackend?.wipeRepo(repoId);
  }

  // for testing
  getMemoryStore() {
    return memoryStore;
  }
}

export * from './reconciler';
