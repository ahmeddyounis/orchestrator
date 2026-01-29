import { describe, it, expect } from 'vitest';
import { name } from './index';

describe('shared package', () => {
  it('exports name', () => {
    expect(name).toBe('@orchestrator/shared');
  });
});
