import { SecretScanner, redact, redactObject, redactVectorMetadata } from './secrets';

describe('SecretScanner', () => {
  const scanner = new SecretScanner();

  it('should not find secrets in clean text', () => {
    const text = 'This is a clean text without any secrets.';
    const findings = scanner.scan(text);
    expect(findings).toHaveLength(0);
  });

  it('should find a private key block', () => {
    const text = `
      Some text before
      -----BEGIN RSA PRIVATE KEY-----
      MIIE...
      -----END RSA PRIVATE KEY-----
      Some text after
    `;
    const findings = scanner.scan(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('private-key');
    expect(findings[0].confidence).toBe('high');
  });

  it('should find an AWS Access Key ID', () => {
    const text = 'My AWS key is AKIAIOSFODNN7EXAMPLE';
    const findings = scanner.scan(text);
    // This will also be caught by the generic aws-secret-access-key pattern
    expect(findings.some((f) => f.kind === 'aws-access-key-id')).toBe(true);
  });

  it('should find an AWS Secret Access Key', () => {
    const text = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const findings = scanner.scan(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('aws-secret-access-key');
  });

  it('should find a GitHub token', () => {
    const text = 'My GitHub token is ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const findings = scanner.scan(text);
    expect(findings.some((f) => f.kind === 'github-token')).toBe(true);
  });

  it('should find an OpenAI API key', () => {
    const text = 'My OpenAI key is sk-abcdefghijklmnopqrstuvwxyz123456789012';
    const findings = scanner.scan(text);
    expect(findings.some((f) => f.kind === 'openai-api-key')).toBe(true);
  });

  it('should find an OpenAI project API key', () => {
    const text = 'My OpenAI key is sk-proj-abcdefghijklmnopqrstuvwxyz123456789012';
    const findings = scanner.scan(text);
    expect(findings.some((f) => f.kind === 'openai-api-key')).toBe(true);
  });

  it('should find a Google API key', () => {
    const text = 'My Google key is AIzaSyBabcdefghijklmnopqrstuvwxyz123456';
    const findings = scanner.scan(text);
    expect(findings.some((f) => f.kind === 'google-api-key')).toBe(true);
  });

  it('should find a secret in env assignment without quotes', () => {
    const text = 'SECRET=mysecretvalue123';
    const findings = scanner.scan(text);
    expect(findings.some((f) => f.kind === 'env-assignment')).toBe(true);
  });

  it('should find a generic API key', () => {
    const text = 'X-API-Key: 1234567890abcdef1234567890abcdef';
    const findings = scanner.scan(text);
    expect(findings.some((f) => f.kind === 'api-key')).toBe(true);
  });

  it('should find an environment variable assignment', () => {
    const text = 'export TOKEN="some-secret-token-value"';
    const findings = scanner.scan(text);
    expect(findings.some((f) => f.kind === 'env-assignment')).toBe(true);
  });

  it('should redact found secrets', () => {
    const text = 'My secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const findings = scanner.scan(text);
    const redacted = redact(text, findings);
    expect(redacted).toBe('My secret is [REDACTED:aws-secret-access-key]');
  });

  it('should handle multiple secrets and redact them correctly', () => {
    const text =
      'my token is ghp_abcdefghijklmnopqrstuvwxyz1234567890 and my key is AKIAIOSFODNN7EXAMPLE';
    const findings = scanner.scan(text);
    const redacted = redact(text, findings);
    // Order of redaction can vary
    expect(redacted).toContain('[REDACTED:github-token]');
    expect(redacted).toContain('[REDACTED:aws-access-key-id]');
  });

  it('should handle overlapping patterns by keeping higher confidence', () => {
    // AWS Access Key ID is also matched by the generic 40-char pattern
    const text = 'Key: AKIAIOSFODNN7EXAMPLE';
    const findings = scanner.scan(text);
    // Should have at least one finding, and the high-confidence one should be kept
    const awsAccessKeyFinding = findings.find((f) => f.kind === 'aws-access-key-id');
    expect(awsAccessKeyFinding).toBeDefined();
    expect(awsAccessKeyFinding?.confidence).toBe('high');
  });
});

describe('redactObject', () => {
  it('should return primitives unchanged', () => {
    expect(redactObject(null)).toBe(null);
    expect(redactObject(42)).toBe(42);
    expect(redactObject('hello')).toBe('hello');
    expect(redactObject(true)).toBe(true);
  });

  it('should redact sensitive keys in objects', () => {
    const obj = {
      token: 'secret-value',
      name: 'test',
    };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result.token).toBe('[REDACTED:token]');
    expect(result.name).toBe('test');
  });

  it('should redact nested sensitive keys', () => {
    const obj = {
      config: {
        apiKey: 'my-api-key',
        host: 'localhost',
      },
    };
    const result = redactObject(obj) as { config: Record<string, unknown> };
    expect(result.config.apiKey).toBe('[REDACTED:apiKey]');
    expect(result.config.host).toBe('localhost');
  });

  it('should handle arrays', () => {
    const arr = [{ secret: 'value' }, { name: 'test' }];
    const result = redactObject(arr) as Array<Record<string, unknown>>;
    expect(result[0].secret).toBe('[REDACTED:secret]');
    expect(result[1].name).toBe('test');
  });

  it('should handle various sensitive key names', () => {
    const obj = {
      password: 'pass123',
      auth: 'authtoken',
      api_key: 'key123',
    };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED:password]');
    expect(result.auth).toBe('[REDACTED:auth]');
    expect(result.api_key).toBe('[REDACTED:api_key]');
  });
});

describe('redactVectorMetadata', () => {
  it('should redact secrets in specified metadata fields', () => {
    const metadata = {
      content: 'My key is sk-abcdefghijklmnopqrstuvwxyz123456789012',
      type: 'code',
    };
    const result = redactVectorMetadata(metadata);
    expect(result.content).toContain('[REDACTED:openai-api-key]');
    expect(result.type).toBe('code');
  });

  it('should pass through when redaction is disabled', () => {
    const metadata = {
      content: 'My key is sk-abcdefghijklmnopqrstuvwxyz123456789012',
    };
    const result = redactVectorMetadata(metadata, { enabled: false });
    expect(result.content).toContain('sk-');
  });

  it('should handle null and undefined values', () => {
    const metadata = { content: null, source: undefined, type: 'test' };
    const result = redactVectorMetadata(metadata);
    expect(result.content).toBe(null);
    expect(result.source).toBe(undefined);
    expect(result.type).toBe('test');
  });

  it('should recursively redact nested objects', () => {
    const metadata = {
      nested: {
        content: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      },
    };
    const result = redactVectorMetadata(metadata) as { nested: { content: string } };
    expect(result.nested.content).toContain('[REDACTED:github-token]');
  });

  it('should not redact non-string values in redaction fields', () => {
    const metadata = {
      content: 12345,
      source: ['array', 'value'],
    };
    const result = redactVectorMetadata(metadata);
    expect(result.content).toBe(12345);
    expect(result.source).toEqual(['array', 'value']);
  });
});
