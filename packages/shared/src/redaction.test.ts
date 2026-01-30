import { describe, it, expect } from 'vitest';
import * as redaction from './redaction';

describe('redactForLogs', () => {
  it('should redact sensitive keys', () => {
    const obj = {
      api_key: '12345',
      someOtherKey: 'value',
      nested: {
        token: 'abcdef',
      },
    };
    const redacted = redaction.redactForLogs(obj) as any;
    expect(redacted.api_key).toBe('[REDACTED]');
    expect(redacted.nested.token).toBe('[REDACTED]');
    expect(redacted.someOtherKey).toBe('value');
  });

  it('should handle case-insensitive sensitive keys', () => {
    const obj = {
      API_KEY: '12345',
      Authorization: 'Bearer xyz',
    };
    const redacted = redaction.redactForLogs(obj) as any;
    expect(redacted.API_KEY).toBe('[REDACTED]');
    expect(redacted.Authorization).toBe('[REDACTED]');
  });

  it('should truncate long strings', () => {
    const longString = 'a'.repeat(5000);
    const obj = {
      data: longString,
    };
    const redacted = redaction.redactForLogs(obj) as any;
    expect(redacted.data.length).toBe(4096 + '[TRUNCATED]'.length);
    expect(redacted.data.endsWith('[TRUNCATED]')).toBe(true);
  });

  it('should not truncate short strings', () => {
    const shortString = 'hello';
    const obj = {
      data: shortString,
    };
    const redacted = redaction.redactForLogs(obj) as any;
    expect(redacted.data).toBe(shortString);
  });

  it('should redact environment variables', () => {
    const obj = {
      env: {
        SECRET_VAR: 'supersecret',
        NODE_ENV: 'test',
        CI: 'true',
      },
    };
    const redacted = redaction.redactForLogs(obj) as any;
    expect(redacted.env.SECRET_VAR).toBe('[REDACTED]');
    expect(redacted.env.NODE_ENV).toBe('test');
    expect(redacted.env.CI).toBe('true');
  });

  it('should handle arrays correctly', () => {
    const obj = {
      items: [{ api_key: '123' }, { someKey: 'value' }, 'a'.repeat(5000)],
    };
    const redacted = redaction.redactForLogs(obj) as any;
    expect(redacted.items[0].api_key).toBe('[REDACTED]');
    expect(redacted.items[1].someKey).toBe('value');
    expect(redacted.items[2].endsWith('[TRUNCATED]')).toBe(true);
  });

  it('should handle null and non-object values', () => {
    expect(redaction.redactForLogs(null)).toBe(null);
    expect(redaction.redactForLogs(undefined)).toBe(undefined);
    expect(redaction.redactForLogs(123)).toBe(123);
    expect(redaction.redactForLogs('a string')).toBe('a string');
  });
});
