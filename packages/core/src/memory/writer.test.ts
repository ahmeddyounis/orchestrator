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

    it('generates titles for other applicable classifications', async () => {
      const toolRunResult: ToolRunResult = { exitCode: 0, stdout: 'pass', durationMs: 100 };

      const buildMem = await writer.extractProcedural(
        {
          ...toolRunMeta,
          toolRunId: 'run-build',
          classification: 'build',
          request: { command: 'pnpm build', toolName: 'shell' },
        } as any,
        toolRunResult,
        repoStateWithoutDb,
      );
      expect(buildMem?.title).toBe('How to build the project');

      const lintMem = await writer.extractProcedural(
        {
          ...toolRunMeta,
          toolRunId: 'run-lint',
          classification: 'lint',
          request: { command: 'pnpm lint', toolName: 'shell' },
        } as any,
        toolRunResult,
        repoStateWithoutDb,
      );
      expect(lintMem?.title).toBe('How to run the linter');

      const fmtMem = await writer.extractProcedural(
        {
          ...toolRunMeta,
          toolRunId: 'run-format',
          classification: 'format',
          request: { command: 'pnpm format', toolName: 'shell' },
        } as any,
        toolRunResult,
        repoStateWithoutDb,
      );
      expect(fmtMem?.title).toBe('How to format the code');
    });

    it('does not persist procedural memory when integrity check blocks it', async () => {
      const toolRunResult: ToolRunResult = { exitCode: 0, stdout: 'pass', durationMs: 100 };
      const blockedMeta: ToolRunMeta = {
        ...toolRunMeta,
        toolRunId: 'run-blocked',
        request: { command: 'rm -rf /', toolName: 'shell' },
      } as any;

      const memory = await writer.extractProcedural(blockedMeta, toolRunResult, repoStateWithDb);
      expect(memory).toBeDefined();

      const sqliteStore = createMemoryStore();
      sqliteStore.init({ dbPath });
      const retrieved = sqliteStore.get(memory!.id);
      expect(retrieved).toBeNull();
      sqliteStore.close();
    });

    it('upserts vector embeddings when embedder and backend are configured', async () => {
      const embedder = {
        embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      };
      const vectorBackend = {
        upsert: vi.fn().mockResolvedValue(undefined),
        wipeRepo: vi.fn().mockResolvedValue(undefined),
      };
      const writerWithVectors = new MemoryWriter({
        embedder: embedder as any,
        vectorBackend: vectorBackend as any,
      });

      const toolRunResult: ToolRunResult = { exitCode: 0, stdout: 'pass', durationMs: 100 };
      const memory = await writerWithVectors.extractProcedural(toolRunMeta, toolRunResult, repoStateWithDb);

      expect(memory).toBeDefined();
      expect(embedder.embedTexts).toHaveBeenCalled();
      expect(vectorBackend.upsert).toHaveBeenCalledWith(
        {},
        TEST_REPO_ID,
        expect.arrayContaining([
          expect.objectContaining({
            id: memory!.id,
            vector: expect.any(Float32Array),
            metadata: expect.objectContaining({ type: 'procedural' }),
          }),
        ]),
      );
    });

    it('skips vector upsert when embedder returns no vectors', async () => {
      const embedder = {
        embedTexts: vi.fn().mockResolvedValue([]),
      };
      const vectorBackend = {
        upsert: vi.fn().mockResolvedValue(undefined),
        wipeRepo: vi.fn().mockResolvedValue(undefined),
      };
      const writerWithVectors = new MemoryWriter({
        embedder: embedder as any,
        vectorBackend: vectorBackend as any,
      });

      const toolRunResult: ToolRunResult = { exitCode: 0, stdout: 'pass', durationMs: 100 };
      await writerWithVectors.extractProcedural(toolRunMeta, toolRunResult, repoStateWithDb);

      expect(embedder.embedTexts).toHaveBeenCalled();
      expect(vectorBackend.upsert).not.toHaveBeenCalled();
    });

    it('does not redact secrets when redaction is disabled', async () => {
      const writerNoRedact = new MemoryWriter({ securityConfig: { redaction: { enabled: false } } });
      const toolRunResult: ToolRunResult = { exitCode: 0, stdout: 'pass', durationMs: 100 };

      const memory = await writerNoRedact.extractProcedural(toolRunMeta, toolRunResult, repoStateWithoutDb);
      expect(memory?.content).toContain('sk-12345678901234567890');
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

    it('wipes sqlite and vector backend when configured', async () => {
      const vectorBackend = {
        wipeRepo: vi.fn().mockResolvedValue(undefined),
      };
      const writerWithVectors = new MemoryWriter({ vectorBackend: vectorBackend as any });

      await writerWithVectors.wipe(TEST_REPO_ID, dbPath, repoStateWithDb);
      expect(vectorBackend.wipeRepo).toHaveBeenCalledWith({}, TEST_REPO_ID);
    });

    it('can wipe without a vector backend', async () => {
      await writer.wipe(TEST_REPO_ID, dbPath, repoStateWithDb);
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
