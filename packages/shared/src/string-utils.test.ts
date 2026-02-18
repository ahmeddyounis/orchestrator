import { stripAnsi } from './string-utils';

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    expect(stripAnsi('hi \u001b[31mred\u001b[0m there')).toBe('hi red there');
  });

  it('leaves plain strings unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});
