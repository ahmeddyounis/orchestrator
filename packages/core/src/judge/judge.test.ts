import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Judge } from './judge';
import type { JudgeInput } from './types';
import type { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import type { Logger, EventBus, ModelRequest, ModelResponse } from '@orchestrator/shared';

function createNoopLogger(): Logger {
  const base: Logger = {
    log: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => base,
  };
  return base;
}

const capabilities = () => ({
  supportsStreaming: false,
  supportsToolCalling: false,
  supportsJsonMode: true,
  modality: 'text' as const,
  latencyClass: 'medium' as const,
});

describe('Judge', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  describe('shouldInvoke', () => {
    it('invokes on near-tie when verification is unavailable', () => {
      expect(
        Judge.shouldInvoke(
          false,
          [],
          [
            { candidateId: 'a', score: 10 },
            { candidateId: 'b', score: 9 },
          ],
        ),
      ).toEqual({ invoke: true, reason: 'objective_near_tie' });
    });

    it('invokes when verification is unavailable and reviews are not a near-tie', () => {
      expect(
        Judge.shouldInvoke(
          false,
          [],
          [
            { candidateId: 'a', score: 10 },
            { candidateId: 'b', score: 1 },
          ],
        ),
      ).toEqual({ invoke: true, reason: 'verification_unavailable' });
    });

    it('invokes when verification is unavailable and there are fewer than 2 reviews', () => {
      expect(Judge.shouldInvoke(false, [], [{ candidateId: 'a', score: 10 }])).toEqual({
        invoke: true,
        reason: 'verification_unavailable',
      });
    });

    it('does not invoke when exactly one candidate passes', () => {
      expect(
        Judge.shouldInvoke(
          true,
          [
            { candidateId: 'a', passed: true, score: 0.9 },
            { candidateId: 'b', passed: false, score: 0.2 },
          ],
          [],
        ),
      ).toEqual({ invoke: false });
    });

    it('invokes when no candidates pass', () => {
      expect(
        Judge.shouldInvoke(
          true,
          [
            { candidateId: 'a', passed: false, score: 0.2 },
            { candidateId: 'b', passed: false, score: 0.1 },
          ],
          [],
        ),
      ).toEqual({ invoke: true, reason: 'no_passing_candidates' });
    });

    it('invokes on near-tie among passing candidates', () => {
      expect(
        Judge.shouldInvoke(
          true,
          [
            { candidateId: 'a', passed: true, score: 0.9 },
            { candidateId: 'b', passed: true, score: 0.85 },
          ],
          [],
        ),
      ).toEqual({ invoke: true, reason: 'objective_near_tie' });
    });

    it('does not invoke when there is a clear winner among passing candidates', () => {
      expect(
        Judge.shouldInvoke(
          true,
          [
            { candidateId: 'a', passed: true, score: 1.0 },
            { candidateId: 'b', passed: true, score: 0.5 },
          ],
          [],
        ),
      ).toEqual({ invoke: false });
    });
  });

  describe('decide', () => {
    let logger: Logger;
    let eventBus: EventBus;
    let adapterCtx: AdapterContext;

    beforeEach(() => {
      vi.clearAllMocks();
      logger = createNoopLogger();
      eventBus = { emit: vi.fn() };
      adapterCtx = { runId: 'run-1', logger } as unknown as AdapterContext;
    });

    const makeInput = (): JudgeInput => ({
      goal: 'Ship a small fix',
      invocationReason: 'objective_near_tie',
      candidates: [
        {
          id: 'c1',
          patch: 'diff --git a/a b/a',
          patchStats: { filesChanged: 1, linesAdded: 1, linesDeleted: 0 },
        },
        { id: 'c2', patch: 'diff --git a/b b/b' },
        { id: 'c3', patch: 'diff --git a/c b/c' },
      ],
      verifications: [
        { candidateId: 'c1', status: 'passed', score: 0.9, summary: 'ok' },
        { candidateId: 'c2', status: 'passed', score: 0.91 },
      ],
    });

    const makeProvider = (impl: {
      generate: (req: ModelRequest, ctx: AdapterContext) => Promise<ModelResponse>;
    }): ProviderAdapter =>
      ({
        id: () => 'mock',
        capabilities,
        generate: impl.generate,
      }) as unknown as ProviderAdapter;

    it('returns a validated decision and stores an artifact', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-judge-'));
      const artifactsRoot = path.join(tmpDir, 'artifacts');
      await fs.mkdir(artifactsRoot, { recursive: true });

      const provider = makeProvider({
        generate: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            winnerCandidateId: 'c2',
            rationale: ['minimal diff'],
            riskAssessment: ['low risk'],
            confidence: 0.6,
          }),
        }),
      });

      const judge = new Judge(provider);
      const output = await judge.decide(makeInput(), {
        runId: 'run-1',
        iteration: 1,
        artifactsRoot,
        logger,
        eventBus,
      });

      expect(output.winnerCandidateId).toBe('c2');

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'JudgeInvoked' }));
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'JudgeDecided' }));

      const artifactPath = path.join(artifactsRoot, 'judge_iter_1.json');
      const raw = await fs.readFile(artifactPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed).toEqual(
        expect.objectContaining({
          iteration: 1,
          input: expect.any(Object),
          output: expect.any(Object),
          durationMs: expect.any(Number),
        }),
      );
    });

    it('falls back when the provider fails and emits JudgeFailed', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-judge-'));
      const artifactsRoot = path.join(tmpDir, 'artifacts');
      await fs.mkdir(artifactsRoot, { recursive: true });

      const provider = makeProvider({
        generate: vi.fn().mockRejectedValue(new Error('boom')),
      });

      const judge = new Judge(provider);
      const output = await judge.decide(makeInput(), {
        runId: 'run-1',
        iteration: 2,
        artifactsRoot,
        logger,
        eventBus,
      });

      expect(output.winnerCandidateId).toBe('c1');
      expect(output.confidence).toBeLessThan(0.5);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'JudgeFailed' }));

      const artifactPath = path.join(artifactsRoot, 'judge_iter_2.json');
      await expect(fs.readFile(artifactPath, 'utf8')).resolves.toContain('"winnerCandidateId"');
    });

    it('falls back when the model returns an invalid winnerCandidateId', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-judge-'));
      const artifactsRoot = path.join(tmpDir, 'artifacts');
      await fs.mkdir(artifactsRoot, { recursive: true });

      const provider = makeProvider({
        generate: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            winnerCandidateId: 'not-a-candidate',
            rationale: ['oops'],
            riskAssessment: ['unknown'],
            confidence: 0.9,
          }),
        }),
      });

      const judge = new Judge(provider);
      const output = await judge.decide(makeInput(), {
        runId: 'run-1',
        iteration: 3,
        artifactsRoot,
        logger,
        eventBus,
      });

      expect(output.winnerCandidateId).toBe('c1');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'JudgeFailed' }));
    });

    it('falls back when the provider throws a non-Error value', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-judge-'));
      const artifactsRoot = path.join(tmpDir, 'artifacts');
      await fs.mkdir(artifactsRoot, { recursive: true });

      const provider = makeProvider({
        generate: vi.fn().mockRejectedValue('boom'),
      });

      const judge = new Judge(provider);
      const output = await judge.decide(makeInput(), {
        runId: 'run-1',
        iteration: 4,
        artifactsRoot,
        logger,
        eventBus,
      });

      expect(output.winnerCandidateId).toBe('c1');
      expect(output.rationale.join('\n')).toContain('boom');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'JudgeFailed' }));
    });

    it('falls back when the provider returns no text', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-judge-'));
      const artifactsRoot = path.join(tmpDir, 'artifacts');
      await fs.mkdir(artifactsRoot, { recursive: true });

      const provider = makeProvider({
        generate: vi.fn().mockResolvedValue({} as any),
      });

      const judge = new Judge(provider);
      const output = await judge.decide(makeInput(), {
        runId: 'run-1',
        iteration: 5,
        artifactsRoot,
        logger,
        eventBus,
      });

      expect(output.winnerCandidateId).toBe('c1');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'JudgeFailed' }));
    });
  });
});
