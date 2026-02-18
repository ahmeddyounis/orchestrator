import { describe, it, expect } from 'vitest';
import {
  resolveToolTimeout,
  DEFAULT_TOOL_TIMEOUTS,
  DEFAULT_TIMEOUTS_BY_CLASSIFICATION,
  GLOBAL_DEFAULT_TIMEOUT,
} from './timeout-config';

describe('resolveToolTimeout', () => {
  it('prefers custom config', () => {
    const custom = {
      rg: { timeoutMs: 1, gracePeriodMs: 2 },
    };

    expect(resolveToolTimeout('rg', 'read_only', custom)).toEqual({
      timeoutMs: 1,
      gracePeriodMs: 2,
    });
  });

  it('falls back to default tool timeouts', () => {
    expect(resolveToolTimeout('pnpm')).toEqual(DEFAULT_TOOL_TIMEOUTS.pnpm);
  });

  it('falls back to classification defaults', () => {
    expect(resolveToolTimeout('unknown-tool', 'format')).toEqual(
      DEFAULT_TIMEOUTS_BY_CLASSIFICATION.format,
    );
  });

  it('falls back to global default', () => {
    expect(resolveToolTimeout('unknown-tool')).toEqual(GLOBAL_DEFAULT_TIMEOUT);
  });
});
