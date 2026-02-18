import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderAdapter } from '@orchestrator/adapters';
import type { AdapterContext } from '@orchestrator/adapters';
import { ConfigSchema } from '@orchestrator/shared';
import type { Config } from '@orchestrator/shared';
import * as fs from 'fs/promises';
import * as shared from '@orchestrator/shared';
import { runPatchReviewLoop } from './review_loop';

vi.mock('fs/promises');
vi.mock('@orchestrator/shared', async () => {
  const actual = await vi.importActual('@orchestrator/shared');
  return {
    ...actual,
    updateManifest: vi.fn().mockResolvedValue(undefined),
  };
});

const applyUnifiedDiffSpy = vi.fn().mockResolvedValue({ applied: true, filesChanged: [] });
vi.mock('@orchestrator/repo', () => ({
  PatchApplier: class {
    applyUnifiedDiff = applyUnifiedDiffSpy;
  },
}));

describe('runPatchReviewLoop', () => {
  const mockLogger = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const baseInput = {
    goal: 'Test goal',
    step: 'Do the thing',
    stepId: '1.1',
    ancestors: ['Parent step'],
    fusedContextText: 'GOAL: Test goal\nREPO CONTEXT:\n// file.ts:1\nconst x = 1;',
    initialPatch: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
    repoRoot: '/tmp/repo',
    artifactsRoot: '/tmp/artifacts',
    manifestPath: '/tmp/artifacts/manifest.json',
    label: { kind: 'step' as const, index: 0, slug: 'do_the_thing' },
  };

  let reviewer: ProviderAdapter;
  let executor: ProviderAdapter;
  let adapterCtx: AdapterContext;

  beforeEach(() => {
    vi.resetAllMocks();
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    applyUnifiedDiffSpy.mockResolvedValue({ applied: true, filesChanged: [] });
    (shared.updateManifest as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_manifestPath: string, updater: (m: any) => void) => {
        const manifest: any = {};
        updater(manifest);
      },
    );

    reviewer = {
      id: () => 'mock-reviewer',
      capabilities: () => ({
        supportsStreaming: false,
        supportsToolCalling: false,
        supportsJsonMode: true,
        modality: 'text',
        latencyClass: 'medium',
      }),
      generate: vi.fn(),
    } as unknown as ProviderAdapter;

    executor = {
      id: () => 'mock-executor',
      capabilities: () => ({
        supportsStreaming: false,
        supportsToolCalling: false,
        supportsJsonMode: false,
        modality: 'text',
        latencyClass: 'medium',
      }),
      generate: vi.fn(),
    } as unknown as ProviderAdapter;

    adapterCtx = { runId: 'run-test', logger: mockLogger, repoRoot: baseInput.repoRoot };
  });

  it('returns original patch when disabled', async () => {
    const config = ConfigSchema.parse({ execution: { reviewLoop: { enabled: false } } });

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.patch).toBe(baseInput.initialPatch);
    expect(result.roundsRun).toBe(0);
    expect((reviewer.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((executor.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('returns original patch when maxReviews is invalid', async () => {
    const config = {
      execution: { reviewLoop: { enabled: true, maxReviews: 0 } },
    } as unknown as Config;

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.patch).toBe(baseInput.initialPatch);
    expect(result.roundsRun).toBe(0);
  });

  it('stops after approval without calling executor', async () => {
    const config = ConfigSchema.parse({
      execution: { reviewLoop: { enabled: true, maxReviews: 3 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        verdict: 'approve',
        summary: 'Looks good.',
        issues: [],
        requiredChanges: [],
        suggestions: [],
        riskFlags: [],
        suggestedTests: [],
        confidence: 'high',
      }),
    });

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.patch).toBe(baseInput.initialPatch);
    expect(result.approved).toBe(true);
    expect(result.roundsRun).toBe(1);
    expect((reviewer.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((executor.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(shared.updateManifest).toHaveBeenCalled();
  });

  it('writes a parse error and returns the last patch when the review is invalid JSON', async () => {
    const config = ConfigSchema.parse({
      execution: { reviewLoop: { enabled: true, maxReviews: 3 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'not json' });

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.patch).toBe(baseInput.initialPatch);
    expect(result.approved).toBe(false);
    expect(result.roundsRun).toBe(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/review_parse_error\.txt$/),
      expect.any(String),
    );
  });

  it('uses a safe slug fallback and handles missing stepId/ancestors', async () => {
    const config = ConfigSchema.parse({
      contextStack: { path: '/custom/context_stack.jsonl' },
      execution: { reviewLoop: { enabled: true, maxReviews: 1 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        verdict: 'approve',
        summary: 'ok',
        issues: [],
        requiredChanges: [],
        suggestions: [],
        riskFlags: [],
        suggestedTests: [],
        confidence: 'high',
      }),
    });

    const result = await runPatchReviewLoop({
      ...baseInput,
      stepId: undefined,
      ancestors: [],
      fusedContextText: '' as any,
      initialPatch: (`diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n` +
        'x'.repeat(20_000)) as any,
      config,
      label: { kind: 'step', index: 0, slug: undefined as any },
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.approved).toBe(true);
    expect(result.roundsRun).toBe(1);
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('/review_loop/step_0_step'),
      expect.objectContaining({ recursive: true }),
    );
  });

  it('adds a newline before dry-run apply and respects dryRunApplyOptions', async () => {
    const config = ConfigSchema.parse({
      execution: { reviewLoop: { enabled: true, maxReviews: 1 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        verdict: 'revise',
        summary: 'Needs changes.',
        issues: [],
        requiredChanges: ['Do X'],
        suggestions: [],
        riskFlags: [],
        suggestedTests: [],
        confidence: 'medium',
      }),
    });

    const revisedPatch =
      'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new';

    (executor.generate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({} as any) // missing text => markers missing
      .mockResolvedValueOnce({ text: `<BEGIN_DIFF>\n${revisedPatch}\n</END_DIFF>` });

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
      dryRunApplyOptions: { maxFilesChanged: 1, maxLinesTouched: 2, allowBinary: true },
    });

    expect(result.roundsRun).toBe(1);
    expect(result.patch.trim()).toBe(revisedPatch.trim());

    const applyArgs = applyUnifiedDiffSpy.mock.calls.at(-1);
    expect(applyArgs?.[1]).toMatch(/\n$/);
    expect(applyArgs?.[2]).toEqual(
      expect.objectContaining({
        dryRun: true,
        maxFilesChanged: 1,
        maxLinesTouched: 2,
        allowBinary: true,
      }),
    );
  });

  it('revises patch until approved (bounded by maxReviews)', async () => {
    const config = ConfigSchema.parse({
      execution: { reviewLoop: { enabled: true, maxReviews: 3 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: 'revise',
          summary: 'Needs changes.',
          issues: ['Wrong file'],
          requiredChanges: ['Update the correct file'],
          suggestions: [],
          riskFlags: [],
          suggestedTests: ['pnpm test'],
          confidence: 'medium',
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: 'approve',
          summary: 'Fixed.',
          issues: [],
          requiredChanges: [],
          suggestions: [],
          riskFlags: [],
          suggestedTests: [],
          confidence: 'high',
        }),
      });

    const revisedPatch =
      'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new\n';
    (executor.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: `BEGIN_DIFF\n${revisedPatch}\nEND_DIFF`,
    });

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.approved).toBe(true);
    expect(result.roundsRun).toBe(2);
    expect(result.patch.trim()).toBe(revisedPatch.trim());
    expect((reviewer.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect((executor.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(shared.updateManifest).toHaveBeenCalled();
  });

  it('retries the executor when diff markers are missing, then succeeds', async () => {
    const config = ConfigSchema.parse({
      execution: { reviewLoop: { enabled: true, maxReviews: 3 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: 'revise',
          summary: 'Needs changes.',
          issues: [],
          requiredChanges: ['Do X'],
          suggestions: [],
          riskFlags: [],
          suggestedTests: [],
          confidence: 'medium',
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: 'approve',
          summary: 'ok',
          issues: [],
          requiredChanges: [],
          suggestions: [],
          riskFlags: [],
          suggestedTests: [],
          confidence: 'high',
        }),
      });

    const revisedPatch =
      'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new\n';
    (executor.generate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ text: revisedPatch }) // no markers
      .mockResolvedValueOnce({ text: `BEGIN_DIFF\n${revisedPatch}\nEND_DIFF` });

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.approved).toBe(true);
    expect(result.roundsRun).toBe(2);
    expect(result.patch.trim()).toBe(revisedPatch.trim());
    expect((executor.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    const secondReq = (executor.generate as ReturnType<typeof vi.fn>).mock.calls[1]![0];
    const userPrompt = secondReq.messages.find((m: any) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('PREVIOUS ATTEMPT ISSUE');
  });

  it('bails out when the executor cannot produce an extractable diff', async () => {
    const config = ConfigSchema.parse({
      execution: { reviewLoop: { enabled: true, maxReviews: 2 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        verdict: 'revise',
        summary: 'Needs changes.',
        issues: [],
        requiredChanges: ['Do X'],
        suggestions: [],
        riskFlags: [],
        suggestedTests: [],
        confidence: 'medium',
      }),
    });

    (executor.generate as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'BEGIN_DIFF\n\nEND_DIFF' });

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.approved).toBe(false);
    expect(result.roundsRun).toBe(1);
    expect(result.patch).toBe(baseInput.initialPatch);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/executor_diff_extract_error\.txt$/),
      expect.any(String),
    );
  });

  it('retries when dry-run apply fails and continues even if manifest update fails', async () => {
    const config = ConfigSchema.parse({
      execution: { reviewLoop: { enabled: true, maxReviews: 1 } },
    });

    (reviewer.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        verdict: 'revise',
        summary: 'Needs changes.',
        issues: [],
        requiredChanges: ['Do X'],
        suggestions: [],
        riskFlags: [],
        suggestedTests: [],
        confidence: 'medium',
      }),
    });

    const revisedPatch =
      'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new\n';
    (executor.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: `BEGIN_DIFF\n${revisedPatch}\nEND_DIFF`,
    });

    applyUnifiedDiffSpy
      .mockResolvedValueOnce({ applied: false, error: { message: 'apply failed' } })
      .mockResolvedValueOnce({ applied: true, filesChanged: [] });

    (shared.updateManifest as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('manifest fail'),
    );

    const result = await runPatchReviewLoop({
      ...baseInput,
      config,
      providers: { executor, reviewer },
      adapterCtx,
    });

    expect(result.roundsRun).toBe(1);
    expect(result.patch.trim()).toBe(revisedPatch.trim());
    expect((executor.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
