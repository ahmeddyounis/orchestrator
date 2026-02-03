import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandidateGenerator, StepContext } from './candidate_generator';
import type { ProviderAdapter } from '@orchestrator/adapters';
import type { EventBus, Logger, Config } from '@orchestrator/shared';
import type { CostTracker } from '../../cost/tracker';
import type { FusedContext } from '../../context';
import * as fs from 'fs/promises';

vi.mock('fs/promises');
vi.mock('../../exec/patch_store', () => ({
  PatchStore: vi.fn().mockImplementation(() => ({
    saveCandidate: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('CandidateGenerator', () => {
  const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
  } as unknown as EventBus;

  const mockLogger = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  const mockCostTracker = {
    getSummary: vi.fn().mockReturnValue({ total: { estimatedCostUsd: 0 } }),
  } as unknown as CostTracker;

  const mockFusedContext: FusedContext = {
    prompt: 'Test context for generation',
    sources: [],
  };

  let mockExecutor: ProviderAdapter;
  let mockReviewer: ProviderAdapter;

  beforeEach(() => {
    vi.resetAllMocks();
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    mockExecutor = {
      generate: vi.fn(),
      id: () => 'mock-executor',
      capabilities: () => ({ supportsStreaming: false, supportsToolCalling: false }),
    } as unknown as ProviderAdapter;

    mockReviewer = {
      generate: vi.fn(),
      id: () => 'mock-reviewer',
      capabilities: () => ({ supportsStreaming: false, supportsToolCalling: false }),
    } as unknown as ProviderAdapter;
  });

  it('should generate candidates with valid patches', async () => {
    const generator = new CandidateGenerator();

    const mockResponse = {
      text: `
<BEGIN_DIFF>
diff --git a/src/file.ts b/src/file.ts
index 1234567..abcdefg 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
+import { newDep } from 'dep';
 const x = 1;
 const y = 2;

