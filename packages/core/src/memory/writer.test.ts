import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryWriter } from './index';
import { createMemoryStore } from '@orchestrator/memory';
import { RepoState, RunSummary, ToolRunMeta } from './types';
import { ToolRunResult } from '@orchestrator/shared';

const TEST_REPO_ID = 'test-repo-writer';

describe('MemoryWriter', () => {
  let dbPath: string;
  let tempDir: string;
  let writer: MemoryWriter;
  let repoStateWithDb: RepoState;
  let repoStateWithoutDb: RepoState;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
    dbPath = join(tempDir, 'memory.db');
    writer = new MemoryWriter();

    // Clear in-memory store before each test
    writer.getMemoryStore().clear();

    repoStateWithDb = {
      repoId: TEST_REPO_ID,
      memoryDbPath: dbPath,
      gitSha: 'test-sha',
    };
    repoStateWithoutDb = {
      repoId: TEST_REPO_ID,
      gitSha: 'test-sha',
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('extractProcedural', () => {
    const toolRunMeta: ToolRunMeta = {
      toolRunId: 'run-1',
      classification: 'test',
      request: { command: 'npm test -- --api-key sk-12345678901234567890', toolName: 'shell' },
    };

    it('should create procedural memory for a successful run', async () => {
      const toolRunResult: ToolRunResult = { exitCode: 0, stdout: 'pass', durationMs: 100 };
      const memory = await writer.extractProcedural(toolRunMeta, toolRunResult, repoStateWithoutDb);

      expect(memory).toBeDefined();
      expect(memory!.type).toBe('procedural');
      expect(memory!.title).toBe('How to run tests');
      expect(memory!.content).not.toContain('sk-12345678901234567890');
      expect(memory!.content).toContain('[REDACTED:openai-api-key]');
    });

    it('should not create memory for a failed run', async () => {
      const toolRunResult: ToolRunResult = { exitCode: 1, stderr: 'fail', durationMs: 100 };
      const memory = await writer.extractProcedural(toolRunMeta, toolRunResult, repoStateWithoutDb);
      expect(memory).toBeNull();
    });

    it('should persist to sqlite if configured', async () => {
      const toolRunResult: ToolRunResult = { exitCode: 0, stdout: 'pass', durationMs: 100 };
      const memory = await writer.extractProcedural(toolRunMeta, toolRunResult, repoStateWithDb);
      expect(memory).toBeDefined();

      const sqliteStore = createMemoryStore();
      sqliteStore.init({ dbPath });
      const retrieved = sqliteStore.get(memory!.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(memory!.id);
      sqliteStore.close();
    });
  });

  describe('extractEpisodic', () => {
    const runSummary: RunSummary = {
      runId: 'run-id-1',
      status: 'completed',
      goal: 'This is a goal with a secret: sk-12345678901234567890',
      stopReason: 'finished',
      decisions: [],
      toolRuns: [],
    };

    it('should create episodic memory', async () => {
      const memory = await writer.extractEpisodic(runSummary, repoStateWithoutDb);
      expect(memory).toBeDefined();
      expect(memory.type).toBe('episodic');
      expect(memory.title).toContain('Run run-id-1: completed');
      expect(memory.content).not.toContain('sk-12345678901234567890');
      expect(memory.content).toContain('[REDACTED:openai-api-key]');
    });

    it('should persist to sqlite if configured', async () => {
      const memory = await writer.extractEpisodic(runSummary, repoStateWithDb);
      expect(memory).toBeDefined();

      const sqliteStore = createMemoryStore();
      sqliteStore.init({ dbPath });
      const retrieved = sqliteStore.get(memory.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(memory.id);
      sqliteStore.close();
    });

    it('should truncate long content', async () => {
      const longGoal = 'a'.repeat(10 * 1024);
      const longRunSummary: RunSummary = { ...runSummary, goal: longGoal };
      const memory = await writer.extractEpisodic(longRunSummary, repoStateWithoutDb);
      expect(memory.content.length).toBeLessThan(10 * 1024);
      expect(memory.content).toContain('... (truncated due to size limit)');
    });
  });
});
