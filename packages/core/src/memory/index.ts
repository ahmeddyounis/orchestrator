import {
  EpisodicMemory,
  Memory,
  PatchStats,
  ProceduralMemory,
  RepoState,
  RunSummary,
  ToolRunMeta,
} from './types';
import { ToolRunResult } from '@orchestrator/shared';
import { randomUUID } from 'crypto';
import { VerificationReport } from '../verify/types';
import { createMemoryStore } from '@orchestrator/memory';

const memoryStore = new Map<string, Memory>();

const MAX_CONTENT_LENGTH = 8 * 1024; // 8KB

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
const applicableClassifications: ApplicableClassification[] = [
  'test',
  'build',
  'lint',
  'format',
];

class SecretRedactor {
  redact(content: string): string {
    // a basic redactor, in a real scenario, this would be more robust
    return content.replace(/secret/gi, 'REDACTED');
  }
}

export class MemoryWriter {
  private redactor = new SecretRedactor();

  constructor() {}

  async extractEpisodic(
    runSummary: RunSummary,
    repoState: RepoState,
    verificationReport?: VerificationReport,
    patchStats?: PatchStats,
  ): Promise<EpisodicMemory> {
    const { runId, status, goal, stopReason, decisions } = runSummary;
    const title = `Run ${runId}: ${status} - ${goal.substring(0, 40)}${
      goal.length > 40 ? '...' : ''
    }`;

    const contentPayload = {
      goal,
      status,
      stopReason,
      decisions,
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

    let content = JSON.stringify(contentPayload, null, 2);
    if (content.length > MAX_CONTENT_LENGTH) {
      content =
        content.substring(0, MAX_CONTENT_LENGTH) +
        '\n... (truncated due to size limit)';
    }

    const newMemory: EpisodicMemory = {
      type: 'episodic',
      id: randomUUID(),
      title,
      content,
      gitSha: repoState.gitSha,
      evidence: {
        artifactPaths: repoState.artifactPaths ?? [],
        failureSignature: verificationReport?.failureSignature,
      },
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
        evidenceJson: JSON.stringify(newMemory.evidence),
        gitSha: newMemory.gitSha,
        stale: false,
        createdAt: newMemory.createdAt.getTime(),
        updatedAt: newMemory.updatedAt.getTime(),
      });
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
      !applicableClassifications.includes(
        classification as ApplicableClassification,
      )
    ) {
      return null;
    }

    const normalizedCommand = this.redactor.redact(
      request.command.trim().replace(/\s+/g, ' '),
    );

    const existingMemory = [...memoryStore.values()].find(
      (mem) => mem.type === 'procedural' && mem.content === normalizedCommand,
    ) as ProceduralMemory | undefined;

    if (existingMemory) {
      existingMemory.updatedAt = new Date();
      existingMemory.evidence = {
        command: request.command,
        exitCode,
        durationMs,
        toolRunId,
      };
      existingMemory.gitSha = repoState.gitSha;
      memoryStore.set(existingMemory.id, existingMemory);
      return existingMemory;
    }

    const newMemory: ProceduralMemory = {
      type: 'procedural',
      id: randomUUID(),
      title: this.generateTitle(classification as ApplicableClassification),
      content: normalizedCommand,
      gitSha: repoState.gitSha,
      evidence: {
        command: request.command,
        exitCode,
        durationMs,
        toolRunId,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    memoryStore.set(newMemory.id, newMemory);
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

  // for testing
  getMemoryStore() {
    return memoryStore;
  }
}
