import {
  ProceduralMemory,
  RepoState,
  ToolRunMeta,
} from './types';
import { ToolRunResult } from '@orchestrator/shared';
import { randomUUID } from 'crypto';

const memoryStore = new Map<string, ProceduralMemory>();

type ApplicableClassification = 'test' | 'build' | 'lint' | 'format';
const applicableClassifications: ApplicableClassification[] = ['test', 'build', 'lint', 'format'];

class SecretRedactor {
  redact(content: string): string {
    // a basic redactor, in a real scenario, this would be more robust
    return content.replace(/secret/gi, 'REDACTED');
  }
}

export class MemoryWriter {
  private redactor = new SecretRedactor();

  constructor() {}

  async extractProcedural(
    toolRunMeta: ToolRunMeta,
    toolRunResult: ToolRunResult,
    repoState: RepoState,
  ): Promise<ProceduralMemory | null> {
    const { request, classification, toolRunId } = toolRunMeta;
    const { exitCode, durationMs } = toolRunResult;

    if (exitCode !== 0 || !applicableClassifications.includes(classification as ApplicableClassification)) {
      return null;
    }

    const normalizedCommand = this.redactor.redact(request.command.trim().replace(/\s+/g, ' '));

    const existingMemory = [...memoryStore.values()].find(
      (mem) => mem.content === normalizedCommand,
    );

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
