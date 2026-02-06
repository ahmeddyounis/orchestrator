import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderAdapter } from '@orchestrator/adapters';
import type { AdapterContext } from '@orchestrator/adapters';
import { ConfigSchema } from '@orchestrator/shared';
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
vi.mock('@orchestrator/repo', () => ({
  PatchApplier: class {
    applyUnifiedDiff = vi.fn().mockResolvedValue({ applied: true, filesChanged: [] });
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

  it('stops after approval without calling executor', async () => {
    const config = ConfigSchema.parse({ execution: { reviewLoop: { enabled: true, maxReviews: 3 } } });

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

  it('revises patch until approved (bounded by maxReviews)', async () => {
    const config = ConfigSchema.parse({ execution: { reviewLoop: { enabled: true, maxReviews: 3 } } });

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

    const revisedPatch = 'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new\n';
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
});

