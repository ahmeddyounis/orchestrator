import { z } from 'zod';

export const SecretFindingSchema = z.object({
  kind: z.string(),
  match: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type SecretFinding = z.infer<typeof SecretFindingSchema>;

type SecretPattern = {
  kind: string;
  pattern: RegExp;
  confidence: 'low' | 'medium' | 'high';
};

// Basic patterns for common secrets.
// In a real-world scenario, this would be a more extensive and configurable list.
const SECRET_PATTERNS: SecretPattern[] = [
  // Private key blocks
  {
    kind: 'private-key',
    pattern:
      /-----BEGIN ((RSA|OPENSSH|EC|PGP) )?PRIVATE KEY-----[\s\S]*?-----END \1?PRIVATE KEY-----/g,
    confidence: 'high',
  },
  // OpenAI API keys (e.g. sk-..., sk-proj-...)
  {
    kind: 'openai-api-key',
    pattern: /sk-(?:proj-)?[a-zA-Z0-9]{20,}/g,
    confidence: 'high',
  },
  // Google API keys (e.g. AIza...)
  {
    kind: 'google-api-key',
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    confidence: 'high',
  },
  // AWS Keys
  {
    kind: 'aws-access-key-id',
    pattern: /AKIA[0-9A-Z]{16}/g,
    confidence: 'high',
  },
  {
    kind: 'aws-secret-access-key',
    pattern: /[0-9a-zA-Z/+]{40}/g, // This is a broad pattern, might have false positives
    confidence: 'low',
  },
  // GitHub Tokens
  {
    kind: 'github-token',
    pattern: /ghp_[0-9a-zA-Z]{36}/g,
    confidence: 'high',
  },
  // Generic API Key
  {
    kind: 'api-key',
    pattern: /([a-zA-Z0-9_]+_)?(key|token|secret|auth)[\s"':=]+([a-zA-Z0-9_.-]{16,})/gi,
    confidence: 'medium',
  },
  // Env assignments
  {
    kind: 'env-assignment',
    pattern: /(TOKEN|SECRET|API_KEY)\s*=\s*['"]?([a-zA-Z0-9_.-]+)['"]?/gi,
    confidence: 'medium',
  },
];

export class SecretScanner {
  scan(text: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    for (const { kind, pattern, confidence } of SECRET_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (match[0]) {
          findings.push({
            kind,
            match: match[0],
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            confidence,
          });
        }
      }
    }

    // Filter out overlapping findings, keeping the highest confidence one.
    const confidenceOrder = ['low', 'medium', 'high'];
    findings.sort((a, b) => {
      const confidenceDiff =
        confidenceOrder.indexOf(b.confidence) - confidenceOrder.indexOf(a.confidence);
      if (confidenceDiff !== 0) {
        return confidenceDiff;
      }
      return b.end - b.start - (a.end - a.start); // longer match first
    });

    const finalFindings: SecretFinding[] = [];
    for (const finding of findings) {
      const overlaps = finalFindings.some((f) => finding.start < f.end && finding.end > f.start);
      if (!overlaps) {
        finalFindings.push(finding);
      }
    }

    return finalFindings;
  }
}

export function redact(text: string, findings: SecretFinding[]): string {
  let redactedText = text;
  // Sort findings by start index in descending order to avoid index shifting issues
  findings
    .sort((a, b) => b.start - a.start)
    .forEach(({ start, end, kind }) => {
      redactedText = `${redactedText.substring(0, start)}[REDACTED:${kind}]${redactedText.substring(end)}`;
    });
  return redactedText;
}

const SENSITIVE_KEY_NAMES = new Set(['token', 'secret', 'apikey', 'api_key', 'auth', 'password']);

export function redactObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }

  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([key, value]) => {
      if (typeof value === 'string' && SENSITIVE_KEY_NAMES.has(key.toLowerCase())) {
        return [key, `[REDACTED:${key}]`];
      }
      if (typeof value === 'object') {
        return [key, redactObject(value)];
      }
      return [key, value];
    }),
  );
}
