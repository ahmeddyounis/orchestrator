import { describe, it, expect } from 'vitest';
import { redactString, redactUnknown } from './redaction';

describe('redaction', () => {
  describe('redactString', () => {
    it('should not change a string with no secrets', () => {
      const input = 'This is a test string.';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe(input);
      expect(redactionCount).toBe(0);
    });

    it('should redact an OpenAI-style API key', () => {
      const input =
        'My API key is sk-k6zXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe('My API key is [REDACTED].');
      expect(redactionCount).toBe(1);
    });

    it('should redact an Anthropic-style API key', () => {
      const input =
        'Use this key for Anthropic: sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe('Use this key for Anthropic: [REDACTED].');
      expect(redactionCount).toBe(1);
    });

    it('should redact a GitHub token', () => {
      const input = 'My token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe('My token: [REDACTED]');
      expect(redactionCount).toBe(1);
    });

    it('should redact multiple GitHub tokens', () => {
      const input =
        'Token 1: gho_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx, Token 2: ghu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe('Token 1: [REDACTED], Token 2: [REDACTED]');
      expect(redactionCount).toBe(2);
    });

    it('should redact an environment variable assignment for TOKEN', () => {
      const input = 'export TOKEN=my-secret-token';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe('export [REDACTED]');
      expect(redactionCount).toBe(1);
    });

    it('should redact an environment variable assignment for SECRET', () => {
      const input = 'SECRET="another-secret"';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe('[REDACTED]');
      expect(redactionCount).toBe(1);
    });

    it('should redact a private key block', () => {
      const input = `
        Some text before.
        -----BEGIN PRIVATE KEY-----
        super secret key content
        that can span multiple lines
        -----END PRIVATE KEY-----
        Some text after.
      `;
      const expected = `
        Some text before.
        [REDACTED]
        Some text after.
      `;
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe(expected);
      expect(redactionCount).toBe(1);
    });

    it('should redact multiple different secrets in one string', () => {
      const input =
        'My token is ghp_12345678901234567890 and my key is sk-12345678901234567890. Also, TOKEN=inline-secret.';
      const { redacted, redactionCount } = redactString(input);
      expect(redacted).toBe(
        'My token is [REDACTED] and my key is [REDACTED]. Also, [REDACTED].',
      );
      expect(redactionCount).toBe(3);
    });
  });

  describe('redactUnknown', () => {
    it('should redact strings inside an object and count them', () => {
      const input = {
        a: 'hello',
        b: 'my key is sk-k6zXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.',
        c: {
          d: 'nested ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx token',
        },
      };
      const expected = {
        a: 'hello',
        b: 'my key is [REDACTED].',
        c: {
          d: 'nested [REDACTED] token',
        },
      };
      const { redacted, redactionCount } = redactUnknown(input);
      expect(redacted).toEqual(expected);
      expect(redactionCount).toBe(2);
    });

    it('should redact strings inside an array and count them', () => {
      const input = [
        'no secret here',
        'SECRET="shhhh"',
        ['nested sk-ant-12345678901234567890.'],
      ];
      const expected = ['no secret here', '[REDACTED]', ['nested [REDACTED].']];
      const { redacted, redactionCount } = redactUnknown(input);
      expect(redacted).toEqual(expected);
      expect(redactionCount).toBe(2);
    });

    it('handles mixed nested structures and returns correct count', () => {
      const input = {
        list: [
          { name: 'test', apiKey: 'sk-k6zXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' },
          'TOKEN=string-secret',
        ],
        meta: { id: 1 },
      };
      const expected = {
        list: [
          { name: 'test', apiKey: '[REDACTED]' },
          '[REDACTED]',
        ],
        meta: { id: 1 },
      };
      const { redacted, redactionCount } = redactUnknown(input);
      expect(redacted).toEqual(expected);
      expect(redactionCount).toBe(2);
    });

    it('should return 0 redactions for safe objects', () => {
      const input = {
        a: 'b',
        c: [1, 2, { d: 'e' }],
      };
      const { redacted, redactionCount } = redactUnknown(input);
      expect(redacted).toEqual(input);
      expect(redactionCount).toBe(0);
    });
  });
});

