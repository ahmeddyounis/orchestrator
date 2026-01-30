'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __exportStar =
  (this && this.__exportStar) ||
  function (m, exports) {
    for (var p in m)
      if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p))
        __createBinding(exports, m, p);
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.MemoryWriter = void 0;
const shared_1 = require('@orchestrator/shared');
const crypto_1 = require('crypto');
const memory_1 = require('@orchestrator/memory');
const memoryStore = new Map();
const MAX_CONTENT_LENGTH = 8 * 1024; // 8KB
let sqliteStore = null;
let sqliteInitPath = null;
function ensureSqliteStore(dbPath) {
  if (sqliteStore && sqliteInitPath === dbPath) return sqliteStore;
  sqliteStore?.close();
  sqliteStore = (0, memory_1.createMemoryStore)();
  sqliteStore.init(dbPath);
  sqliteInitPath = dbPath;
  return sqliteStore;
}
const applicableClassifications = ['test', 'build', 'lint', 'format'];
class MemoryWriter {
  eventBus;
  runId;
  constructor(eventBus, runId = 'unknown') {
    this.eventBus = eventBus;
    this.runId = runId;
  }
  async logRedactions(count, context) {
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
      });
    }
  }
  async extractEpisodic(runSummary, repoState, verificationReport, patchStats) {
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
    const { redacted: redactedContentPayload, redactionCount: contentRedactions } = (0,
    shared_1.redactUnknown)(contentPayload);
    await this.logRedactions(contentRedactions, `episodic memory content for run ${runId}`);
    let content = JSON.stringify(redactedContentPayload, null, 2);
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '\n... (truncated due to size limit)';
    }
    const evidence = {
      artifactPaths: repoState.artifactPaths ?? [],
      failureSignature: verificationReport?.failureSignature,
    };
    const { redacted: redactedEvidence, redactionCount: evidenceRedactions } = (0,
    shared_1.redactUnknown)(evidence);
    await this.logRedactions(evidenceRedactions, `episodic memory evidence for run ${runId}`);
    const newMemory = {
      type: 'episodic',
      id: (0, crypto_1.randomUUID)(),
      title,
      content,
      gitSha: repoState.gitSha,
      evidence: redactedEvidence,
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
    }
    return newMemory;
  }
  async extractProcedural(toolRunMeta, toolRunResult, repoState) {
    const { request, classification, toolRunId } = toolRunMeta;
    const { exitCode, durationMs } = toolRunResult;
    if (exitCode !== 0 || !applicableClassifications.includes(classification)) {
      return null;
    }
    const { redacted: normalizedCommand, redactionCount: commandRedactions } = (0,
    shared_1.redactString)(request.command.trim().replace(/\s+/g, ' '));
    await this.logRedactions(commandRedactions, 'procedural memory command');
    const existingMemory = [...memoryStore.values()].find(
      (mem) => mem.type === 'procedural' && mem.content === normalizedCommand,
    );
    const evidence = {
      command: request.command,
      exitCode,
      durationMs,
      toolRunId,
    };
    const { redacted: redactedEvidence, redactionCount: evidenceRedactions } = (0,
    shared_1.redactUnknown)(evidence);
    await this.logRedactions(evidenceRedactions, 'procedural memory evidence');
    if (existingMemory) {
      existingMemory.updatedAt = new Date();
      existingMemory.evidence = redactedEvidence;
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
      }
      return existingMemory;
    }
    const newMemory = {
      type: 'procedural',
      id: (0, crypto_1.randomUUID)(),
      title: this.generateTitle(classification),
      content: normalizedCommand,
      gitSha: repoState.gitSha,
      evidence: redactedEvidence,
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
    }
    return newMemory;
  }
  generateTitle(classification) {
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
exports.MemoryWriter = MemoryWriter;
__exportStar(require('./reconciler'), exports);
//# sourceMappingURL=index.js.map
