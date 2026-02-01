import { SecretScanner, redact } from './secrets';

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
    expect(findings.some(f => f.kind === 'aws-access-key-id')).toBe(true);
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
    expect(findings.some(f => f.kind === 'github-token')).toBe(true);
  });

  it('should find a generic API key', () => {
    const text = 'X-API-Key: 1234567890abcdef1234567890abcdef';
    const findings = scanner.scan(text);
    expect(findings.some(f => f.kind === 'api-key')).toBe(true);
  });
  
  it('should find an environment variable assignment', () => {
    const text = 'export TOKEN="some-secret-token-value"';
    const findings = scanner.scan(text);
    expect(findings.some(f => f.kind === 'env-assignment')).toBe(true);
  });

  it('should redact found secrets', () => {
    const text = 'My secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const findings = scanner.scan(text);
    const redacted = redact(text, findings);
    expect(redacted).toBe('My secret is [REDACTED:aws-secret-access-key]');
  });
  
  it('should handle multiple secrets and redact them correctly', () => {
    const text = 'my token is ghp_abcdefghijklmnopqrstuvwxyz1234567890 and my key is AKIAIOSFODNN7EXAMPLE';
    const findings = scanner.scan(text);
    const redacted = redact(text, findings);
    // Order of redaction can vary
    expect(redacted).toContain('[REDACTED:github-token]');
    expect(redacted).toContain('[REDACTED:aws-access-key-id]');
  });
});
