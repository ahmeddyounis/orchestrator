import { describe, it, expect, vi, afterAll } from 'vitest'
import {
  RUN_SUMMARY_SCHEMA_VERSION,
  RunSummary,
  SummaryWriter,
} from './summary.js'
import { writeFile } from 'fs/promises'
import path from 'node:path'

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

describe('SummaryWriter', () => {
  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('should write a valid summary.json file', async () => {
    const runDir = '/tmp/test-run'
    const summary: RunSummary = {
      schemaVersion: RUN_SUMMARY_SCHEMA_VERSION,
      runId: 'test-run-123',
      command: ['node', 'script.js'],
      goal: 'Test goal',
      repoRoot: '/path/to/repo',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1000,
      status: 'success',
      thinkLevel: 2,
      selectedProviders: {
        planner: 'test-planner',
        executor: 'test-executor',
      },
      budgets: {
        maxIterations: 10,
        maxToolRuns: 20,
        maxWallTimeMs: 60000,
      },
      tools: {
        enabled: true,
        runs: [],
      },
      memory: {
        enabled: true,
      },
      costs: {
        perProvider: {},
        totals: {
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
        },
      },
      artifacts: {
        manifestPath: '/tmp/test-run/manifest.json',
        tracePath: '/tmp/test-run/trace.json',
      },
    }

    const expectedPath = path.join(runDir, 'summary.json')
    const summaryPath = await SummaryWriter.write(summary, runDir)

    expect(summaryPath).toBe(expectedPath)
    expect(writeFile).toHaveBeenCalledWith(
      expectedPath,
      JSON.stringify(summary, null, 2),
    )
  })

  it('should have schemaVersion set to the current version', () => {
    expect(RUN_SUMMARY_SCHEMA_VERSION).toBe(1)
  })
})
