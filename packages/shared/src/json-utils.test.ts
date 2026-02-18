import { extractJsonObject } from './json-utils';

describe('extractJsonObject', () => {
  it('extracts and parses a JSON object from surrounding text', () => {
    expect(extractJsonObject('prefix {"a":1} suffix')).toEqual({ a: 1 });
  });

  it('includes context in the missing-object error', () => {
    expect(() => extractJsonObject('no json here', 'judge')).toThrow(
      'No JSON object found in judge response.',
    );
  });

  it('throws a helpful parse error with context', () => {
    expect(() => extractJsonObject('before { bad json } after', 'diagnosis')).toThrow(
      /Failed to parse JSON from diagnosis response:/,
    );
  });

  it('falls back to stringification when a non-Error is thrown', () => {
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'nope';
    });

    expect(() => extractJsonObject('before {"a":1} after')).toThrow(/Failed to parse JSON: nope/);

    parseSpy.mockRestore();
  });
});
