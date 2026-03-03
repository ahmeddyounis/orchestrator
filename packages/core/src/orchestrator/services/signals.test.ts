import { describe, it, expect } from 'vitest';
import { buildContextSignals } from './signals';

describe('buildContextSignals', () => {
  it('adds package_focus hints from goal/step text', () => {
    const signals = buildContextSignals({
      goal: 'Work in @orchestrator/core and packages/cli',
      step: 'Update @orchestrator/repo indexing',
      ancestors: ['Touch packages/shared too'],
    });

    const focus = signals.filter((s) => s.type === 'package_focus').map((s) => String(s.data));
    expect(focus).toContain('packages/core');
    expect(focus).toContain('packages/cli');
    expect(focus).toContain('packages/repo');
    expect(focus).toContain('packages/shared');
  });

  it('adds file_change signals and caps output', () => {
    const touchedFiles = Array.from({ length: 50 }, (_, i) => `src/file_${i}.ts`);
    const signals = buildContextSignals({
      goal: 'goal',
      step: 'step',
      touchedFiles,
    });

    const fileSignals = signals.filter((s) => s.type === 'file_change');
    expect(fileSignals.length).toBeLessThanOrEqual(25);
  });

  it('adds an error signal when error text is provided', () => {
    const signals = buildContextSignals({
      goal: 'goal',
      step: 'step',
      errorText: 'TypeError: boom at src/a.ts:10:5',
    });

    expect(signals.some((s) => s.type === 'error')).toBe(true);
  });
});
