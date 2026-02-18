import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputRenderer } from './renderer';

describe('OutputRenderer', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders JSON output when json mode is enabled', () => {
    const renderer = new OutputRenderer(true);
    renderer.render({ status: 'SUCCESS', goal: 'g' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
    expect(parsed).toEqual({ status: 'SUCCESS', goal: 'g' });
  });

  it('renders a success report (human) with changed files, verification, cost, and next steps', () => {
    const renderer = new OutputRenderer(false);
    renderer.render({
      status: 'SUCCESS',
      goal: 'Ship it',
      runId: 'run-1',
      artifactsDir: '/tmp/artifacts',
      changedFiles: Array.from({ length: 12 }, (_, i) => `file-${i}.ts`),
      cost: {
        providers: {},
        total: { inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCostUsd: 1.23456 },
      },
      verification: { enabled: true, passed: false },
      nextSteps: ['do-a', 'do-b'],
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Run succeeded');
    expect(output).toContain('Changed files:');
    expect(output).toContain('... and 2 more.');
    expect(output).toContain('Verification:');
    expect(output).toContain('Failed');
    expect(output).toContain('Cost & Time:');
    expect(output).toContain('Total: 3 tokens');
    expect(output).toContain('$1.2346');
    expect(output).toContain('Artifacts:');
    expect(output).toContain('Run ID: run-1');
    expect(output).toContain('Dir: /tmp/artifacts');
    expect(output).toContain('Next steps:');
    expect(output).toContain('do-a');
  });

  it('renders default next steps (human) when none are provided', () => {
    const renderer = new OutputRenderer(false);
    renderer.render({
      status: 'SUCCESS',
      runId: 'run-2',
      artifactsDir: '/tmp/a2',
      changedFiles: ['a.ts'],
      verification: { enabled: false, passed: true },
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Run succeeded');
    expect(output).toContain('Not run');
    expect(output).toContain('Review the run report:');
    expect(output).toContain('orchestrator report run-2');
    expect(output).toContain('/tmp/a2/patches/final.diff.patch');
  });

  it('renders a success report (human) when verification passes and cost has no USD estimate', () => {
    const renderer = new OutputRenderer(false);
    renderer.render({
      status: 'SUCCESS',
      changedFiles: [],
      verification: { enabled: true, passed: true, summary: 'All good' },
      cost: {
        providers: {},
        total: { inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCostUsd: null },
      },
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Run succeeded');
    expect(output).toContain('✅');
    expect(output).toContain('All good');
    expect(output).toContain('Total: 3 tokens');
    expect(output).not.toContain('($');
  });

  it('renders a failure report (human) with default next steps', () => {
    const renderer = new OutputRenderer(false);
    renderer.render({
      status: 'FAILURE',
      runId: 'run-3',
      artifactsDir: '/tmp/a3',
      stopReason: 'budget exceeded',
      lastFailureSignature: 'E_FAIL',
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Run failed');
    expect(output).toContain('Reason:');
    expect(output).toContain('budget exceeded');
    expect(output).toContain('Error:');
    expect(output).toContain('E_FAIL');
    expect(output).toContain('Diagnostics:');
    expect(output).toContain('Next steps:');
    expect(output).toContain('orchestrator report run-3');
  });

  it('renders a failure report (human) with custom next steps', () => {
    const renderer = new OutputRenderer(false);
    renderer.render({
      status: 'FAILURE',
      nextSteps: ['try again'],
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Run failed');
    expect(output).toContain('try again');
    expect(output).not.toContain('--max-total-cost');
  });

  it('renders verbose output when status is omitted', () => {
    const renderer = new OutputRenderer(false);
    renderer.render({
      goal: 'Goal',
      suite: 'Suite',
      runId: 'run-4',
      artifactsDir: '/tmp/a4',
      providers: { planner: 'p1', executor: undefined },
      verification: {
        enabled: true,
        passed: false,
        failedChecks: ['tests'],
        reportPaths: ['/tmp/a4/verification/report.json'],
      },
      cost: {
        providers: {
          b: { inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCostUsd: null },
          a: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.1 },
        },
        total: { inputTokens: 2, outputTokens: 3, totalTokens: 5, estimatedCostUsd: 0.2 },
      },
      nextSteps: ['n1'],
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Goal: Goal');
    expect(output).toContain('Suite: Suite');
    expect(output).toContain('Run ID: run-4');
    expect(output).toContain('Verification:');
    expect(output).toContain('Failed Checks: tests');
    expect(output).toContain('Selected Providers:');
    expect(output).toContain('planner: p1');
    expect(output).toContain('Costs:');
    expect(output).toContain('Total: 5 tok');
    expect(output).toContain('Next Steps:');
    expect(output).toContain('n1');
  });

  it('log() is suppressed in JSON mode and errors are JSON-encoded', () => {
    const renderer = new OutputRenderer(true);
    renderer.log('hello');
    renderer.error(new Error('boom'));

    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(JSON.stringify({ error: 'boom' }));
  });

  it('log() and error() render human-readable output when not in JSON mode', () => {
    const renderer = new OutputRenderer(false);
    renderer.log('hello');
    renderer.error('boom');

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    const errored = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('hello');
    expect(errored).toContain('boom');
  });
});
