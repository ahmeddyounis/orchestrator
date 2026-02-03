import { ParsingStrategy } from './compatibility';

export interface DiffParsed {
  diffText: string;
  confidence: number;
}

export interface PlanParsed {
  steps: string[];
  confidence: number;
}

/**
 * Strips ANSI escape codes and normalizes line endings.
 */
export function sanitizeOutput(text: string): string {
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  return text.replace(ansiRegex, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseWithMarker(sanitized: string): DiffParsed | null {
  const markerRegex = /<BEGIN_DIFF>([\s\S]*?)<END_DIFF>/;
  const markerMatch = sanitized.match(markerRegex);
  if (markerMatch) {
    const content = markerMatch[1].trim();
    if (isValidDiffStructure(content)) {
      return { diffText: content, confidence: 1.0 };
    }
  }
  return null;
}

function parseWithFence(sanitized: string): DiffParsed | null {
  const fenceRegex = /```diff([\s\S]*?)```/;
  const fenceMatch = sanitized.match(fenceRegex);
  if (fenceMatch) {
    const content = fenceMatch[1].trim();
    if (isValidDiffStructure(content)) {
      return { diffText: content, confidence: 0.9 };
    }
  }
  return null;
}

function parseWithHeuristic(sanitized: string): DiffParsed | null {
  const lines = sanitized.split('\n');
  let startLine = -1;
  let hasDiffHeader = false;
  let hasHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (startLine === -1) {
      if (line.startsWith('diff --git')) {
        startLine = i;
        hasDiffHeader = true;
      } else if (line.startsWith('--- a/')) {
        if (i + 1 < lines.length && lines[i + 1].startsWith('+++ b/')) {
          startLine = i;
          hasDiffHeader = true;
          i++;
        }
      }
      continue;
    }
    if (line.startsWith('@@ ') && line.includes(' @@')) {
      hasHunk = true;
    }
  }

  if (startLine !== -1 && hasDiffHeader && hasHunk) {
    const extractedLines: string[] = [];
    let validDiffSoFar = false;
    let inHeader = true;
    let inHunk = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('diff --git')) {
        inHeader = true;
        inHunk = false;
        extractedLines.push(line);
      } else if (line.startsWith('index ')) {
        if (inHeader) extractedLines.push(line);
      } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        inHeader = true;
        extractedLines.push(line);
      } else if (line.startsWith('@@ ')) {
        inHeader = false;
        inHunk = true;
        validDiffSoFar = true;
        extractedLines.push(line);
      } else if (inHunk) {
        if (['+', '-', ' '].some((prefix) => line.startsWith(prefix))) {
          extractedLines.push(line);
        } else if (line === '' || line.startsWith('\\ No newline')) {
          extractedLines.push(line);
        } else {
          break;
        }
      }
    }

    if (validDiffSoFar && extractedLines.length > 0) {
      return {
        diffText: extractedLines.join('\n'),
        confidence: 0.7,
      };
    }
  }
  return null;
}

/**
 * parses unified diff from text using multiple strategies:
 * 1. Explicit markers <BEGIN_DIFF>...</END_DIFF>
 * 2. Markdown code fences ```diff ... ```
 * 3. Heuristic scanning for unified diff headers
 */
export function parseUnifiedDiffFromText(
  text: string,
  strategy?: ParsingStrategy,
): DiffParsed | null {
  const sanitized = sanitizeOutput(text);

  if (strategy) {
    switch (strategy) {
      case 'marker':
        return parseWithMarker(sanitized);
      case 'fence':
        return parseWithFence(sanitized);
      case 'heuristic':
        return parseWithHeuristic(sanitized);
    }
  }

  // Try all strategies in order of confidence
  const markerResult = parseWithMarker(sanitized);
  if (markerResult) {
    return markerResult;
  }

  const fenceResult = parseWithFence(sanitized);
  if (fenceResult) {
    return fenceResult;
  }

  return parseWithHeuristic(sanitized);
}

function isValidDiffStructure(text: string): boolean {
  // Minimal validation: must have ---/+++ header OR diff --git AND @@ hunk
  // We use multiline flag 'm' and allow whitespace indentation
  const hasDiffGit = /^\s*diff --git/m.test(text);
  const hasUnifiedHeader = /^\s*--- a\/.*\n\s*\+\+\+ b\//m.test(text);
  const hasHunk = /^\s*@@ .* @@/m.test(text);
  return (hasDiffGit || hasUnifiedHeader) && hasHunk;
}

/**
 * Parses a step-by-step plan from text.
 * Looks for numbered lists (1. ) or bullet points (- ) that look like steps.
 */
export function parsePlanFromText(text: string): PlanParsed | null {
  const sanitized = sanitizeOutput(text);
  const lines = sanitized.split('\n');
  const steps: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match "1. Step" or "- Step"
    const numberMatch = trimmed.match(/^\d+(?:\.\d+)*[.)]?\s+(.*)/);
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);

    if (numberMatch) {
      steps.push(numberMatch[1]);
    } else if (bulletMatch) {
      steps.push(bulletMatch[1]);
    }
  }

  if (steps.length > 0) {
    return { steps, confidence: 0.8 };
  }

  return null;
}
