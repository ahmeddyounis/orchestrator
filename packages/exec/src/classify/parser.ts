import { ParsedCommand } from './types';

export function parseCommand(input: string): ParsedCommand {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escape = false;

  const trimmed = input.trim();

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escape) {
      current += char;
      escape = false;
    } else if (char === '\\') {
      escape = true;
    } else if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  // Identify env vars at the beginning
  // Env var pattern: key=value, key must be valid identifier
  let cmdIndex = 0;
  while (cmdIndex < tokens.length && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(tokens[cmdIndex])) {
    cmdIndex++;
  }

  // If no command found (e.g. just vars), fallback to empty or handle gracefully
  // For safety, if we have tokens but all look like vars, maybe the user intends to just set vars.
  // But for classification, we treat the first non-var as the bin.
  // If all are vars, bin is undefined/empty string.

  if (cmdIndex >= tokens.length) {
    // e.g. "A=1"
    // If the input was not empty but we found no bin, we can return empty bin.
    return {
      bin: '',
      args: [],
      raw: input,
    };
  }

  const bin = tokens[cmdIndex];
  const args = tokens.slice(cmdIndex + 1);

  return {
    bin,
    args,
    raw: input,
  };
}
