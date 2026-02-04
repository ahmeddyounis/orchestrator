/**
 * Extracts a JSON object from text that may contain other content.
 * Finds the first '{' and last '}' and parses the content between them.
 *
 * @param text - The text to extract JSON from
 * @param context - Optional context for error messages (e.g., 'diagnosis', 'reviewer', 'judge')
 * @returns The parsed JSON object
 * @throws Error if no valid JSON object is found
 */
export function extractJsonObject(text: string, context?: string): unknown {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    const contextStr = context ? ` in ${context} response` : '';
    throw new Error(`No JSON object found${contextStr}.`);
  }

  const jsonText = text.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonText) as unknown;
  } catch (e) {
    const contextStr = context ? ` from ${context} response` : '';
    throw new Error(
      `Failed to parse JSON${contextStr}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
