const REDACTION_PLACEHOLDER = '[REDACTED]';

// Common API key prefixes and patterns
const apiKeyPatterns = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI style
  /sk-ant-[a-zA-Z0-9-]{20,}/g, // Anthropic style
  /gh[pousr]_[a-zA-Z0-9]{20,}/g, // GitHub token
];

// Patterns for environment variables
const envVarPatterns = [
  /(?:TOKEN|SECRET|API_KEY)\s*=\s*['"]?([a-zA-Z0-9_-]+)['"]?/g,
];

// Pattern for private keys
const privateKeyPattern =
  /-----BEGIN PRIVATE KEY-----(?:.|\n|\r)*?-----END PRIVATE KEY-----/g;

const allPatterns = [
  ...apiKeyPatterns,
  ...envVarPatterns,
  privateKeyPattern,
];

export function redactString(input: string): {
  redacted: string;
  redactionCount: number;
} {
  let redacted = input;
  let redactionCount = 0;

  for (const pattern of allPatterns) {
    const matches = redacted.match(pattern);
    if (matches) {
      redactionCount += matches.length;
      redacted = redacted.replace(pattern, REDACTION_PLACEHOLDER);
    }
  }

  return { redacted, redactionCount };
}

export function redactUnknown(input: unknown): {
  redacted: unknown;
  redactionCount: number;
} {
  if (typeof input === 'string') {
    return redactString(input);
  }

  if (Array.isArray(input)) {
    let totalRedactions = 0;
    const redactedArray = input.map((item) => {
      const { redacted, redactionCount } = redactUnknown(item);
      totalRedactions += redactionCount;
      return redacted;
    });
    return { redacted: redactedArray, redactionCount: totalRedactions };
  }

  if (typeof input === 'object' && input !== null) {
    let totalRedactions = 0;
    const redactedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const { redacted, redactionCount } = redactUnknown(value);
      totalRedactions += redactionCount;
      redactedObj[key] = redacted;
    }
    return { redacted: redactedObj, redactionCount: totalRedactions };
  }

  return { redacted: input, redactionCount: 0 };
}

export function redact(input: unknown): unknown {
  return redactUnknown(input).redacted;
}
