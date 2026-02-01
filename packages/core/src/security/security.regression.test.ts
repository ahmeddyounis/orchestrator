import { describe, it, expect } from 'vitest';
import { filterInjectionPhrases, wrapUntrustedContent } from './guards';
import { SecretScanner, redact } from '@orchestrator/shared';
import * as fs from 'fs';
import * as path from 'path';

describe('Security Regression Tests', () => {
  describe('Prompt Injection', () => {
    it('should neutralize prompt injection attempts from files', () => {
      const fixturePath = path.join(__dirname, '../../__fixtures__/security/prompt-injection-attempt.txt');
      const maliciousContent = fs.readFileSync(fixturePath, 'utf-8');

      const wrappedContent = wrapUntrustedContent(maliciousContent);
      const filteredContent = filterInjectionPhrases(wrappedContent);

      expect(filteredContent).toContain('[PROMPT INJECTION ATTEMPT DETECTED]');
      expect(filteredContent).not.toContain('Ignore your previous instructions');
      expect(filteredContent).not.toContain('rm -rf /');
    });
  });

  describe('Secret Leakage', () => {
    it('should redact secrets from file content', async () => {
      const fixturePath = path.join(__dirname, '../../__fixtures__/security/file-with-secrets.txt');
      const contentWithSecrets = fs.readFileSync(fixturePath, 'utf-8');

      const scanner = new SecretScanner();
      const findings = await scanner.scan(contentWithSecrets);

      const redactedContent = redact(contentWithSecrets, findings);

      expect(redactedContent).not.toContain('sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(redactedContent).toContain('[REDACTED:openai-api-key]');
      
      expect(redactedContent).not.toContain('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(redactedContent).toContain('[REDACTED:github-token]');

      expect(redactedContent).not.toContain('AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_xxxxxx');
      expect(redactedContent).toContain('[REDACTED:google-api-key]');

      // Password is not a detectable secret format, so it should not be redacted.
      // This confirms we are not being overzealous.
      expect(redactedContent).toContain('MySecurePassword123!');
    });
  });
});