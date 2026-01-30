import { expect, test } from 'vitest';
import { add } from './index';

test('adds two numbers', () => {
  expect(add(1, 2)).toBe(4); // This will fail
});
