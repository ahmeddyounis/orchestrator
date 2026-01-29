import { describe, it, expect } from 'vitest';
import { name } from './index';

describe('core package', () => {
  it('exports name', () => {
    expect(name).toBe('@orchestrator/core');
  });
});
