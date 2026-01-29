import { describe, it, expect } from 'vitest';
import { name } from './index';

describe('cli package', () => {
  it('exports name', () => {
    expect(name).toBe('@orchestrator/cli');
  });
});
