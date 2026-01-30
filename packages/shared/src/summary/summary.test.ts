import { describe, it, expect, beforeEach } from 'vitest'
import {
  RUN_SUMMARY_SCHEMA_VERSION,
  RunSummary,
  SummaryWriter,
} from './summary.js'
import {tmpdir} from 'os'
import {join} from 'path'
import {remove, readJson, ensureDir} from 'fs-extra'


describe('SummaryWriter', () => {
    const TEST_RUN_DIR = join(tmpdir(), 'orchestrator-summary-test', `${Date.now()}`)

    beforeEach(async () => {
        await ensureDir(TEST_RUN_DIR)
    })

  it('should write a valid summary.json file', async () => {
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
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: null,
        },
      },
      artifacts: {
        manifestPath: '/tmp/test-run/manifest.json',
        tracePath: '/tmp/test-run/trace.json',
      },
    }

    const expectedPath = join(TEST_RUN_DIR, 'summary.json')
    const summaryPath = await SummaryWriter.write(summary, TEST_RUN_DIR)

    expect(summaryPath).toBe(expectedPath)
    const summaryOnDisk = await readJson(summaryPath)
    expect(summaryOnDisk).toEqual(summary)
  })

  it('should have schemaVersion set to the current version', () => {
    expect(RUN_SUMMARY_SCHEMA_VERSION).toBe(1)
  })
})
