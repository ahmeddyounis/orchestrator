export function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    // Stub: In the future, this will replace secrets/PII
    // For now, it just returns the string as is.
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(redact);
  }

  if (typeof input === 'object' && input !== null) {
    const redactedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      redactedObj[key] = redact(value);
    }
    return redactedObj;
  }

  return input;
}
