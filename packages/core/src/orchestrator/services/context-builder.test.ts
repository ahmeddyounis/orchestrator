import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ContextBuilderService } from './context-builder';

const searchSpy = vi.fn();
const extractSpy = vi.fn();
const packSpy = vi.fn();

vi.mock('@orchestrator/repo', () => ({
  SearchService: class {
    constructor(_rgPath?: string) {}
    search = searchSpy;
  },
  SnippetExtractor: class {
    extractSnippets = extractSpy;
  },
  SimpleContextPacker: class {
    pack = packSpy;
  },
}));

describe('ContextBuilderService', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('builds a context pack and writes fused context artifacts', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-context-'));
    const repoRoot = path.join(tmpDir, 'repo');
    const artifactsRoot = path.join(tmpDir, 'artifacts');
    await fs.mkdir(repoRoot, { recursive: true });
    await fs.mkdir(artifactsRoot, { recursive: true });

    searchSpy.mockResolvedValueOnce({
      matches: [
        {
          path: 'src/a.ts',
          line: 1,
          column: 1,
          matchText: 'hit',
          lineText: 'line',
          score: 1,
        },
      ],
    });
    extractSpy.mockResolvedValueOnce([
      { path: 'src/touched.ts', startLine: 1, endLine: 1, content: 'x', reason: 'r', score: 1 },
    ]);
    packSpy.mockReturnValueOnce({
      items: [
        {
          path: 'src/touched.ts',
          startLine: 1,
          endLine: 1,
          content: 'x',
          reason: 'r',
          score: 1,
        },
      ],
      totalChars: 1,
      estimatedTokens: 1,
    });

    const service = new ContextBuilderService(
      {
        security: { redaction: { enabled: false } } as any,
        context: { tokenBudget: 1234, maxCandidates: 1 } as any,
        memory: { maxChars: 10 } as any,
        contextStack: { enabled: true, promptBudgetChars: 100, promptMaxFrames: 2 } as any,
      } as any,
      repoRoot,
    );

    const touchedFiles = new Set<string>(['src/touched.ts']);
    const result = await service.buildStepContext({
      goal: 'Fix the thing',
      step: 'Update (A) + docs!',
      touchedFiles,
      memoryHits: [],
      signals: [],
      eventBus: { emit: vi.fn() } as any,
      runId: 'run-1',
      artifactsRoot,
      stepsCompleted: 3,
    });

    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Update (A) + docs!', cwd: repoRoot }),
    );
    expect(result.contextPack).toBeTruthy();

    const [jsonPath, txtPath] = service.getContextPaths(artifactsRoot, 3, 'Update (A) + docs!');
    await expect(fs.readFile(jsonPath, 'utf8')).resolves.toContain('{');
    await expect(fs.readFile(txtPath, 'utf8')).resolves.toContain('Goal:');
  });

  it('writes fused context even when repo context generation throws', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-context-'));
    const repoRoot = path.join(tmpDir, 'repo');
    const artifactsRoot = path.join(tmpDir, 'artifacts');
    await fs.mkdir(repoRoot, { recursive: true });
    await fs.mkdir(artifactsRoot, { recursive: true });

    searchSpy.mockRejectedValueOnce(new Error('rg failed'));

    const service = new ContextBuilderService({} as any, repoRoot);
    const result = await service.buildStepContext({
      goal: 'Fix the thing',
      step: 'Step',
      touchedFiles: new Set<string>(),
      memoryHits: [],
      signals: [],
      eventBus: { emit: vi.fn() } as any,
      runId: 'run-1',
      artifactsRoot,
      stepsCompleted: 0,
    });

    expect(result.contextPack).toBeUndefined();

    const [jsonPath, txtPath] = service.getContextPaths(artifactsRoot, 0, 'Step');
    await expect(fs.readFile(jsonPath, 'utf8')).resolves.toContain('{');
    await expect(fs.readFile(txtPath, 'utf8')).resolves.toContain('Goal:');
  });
});

