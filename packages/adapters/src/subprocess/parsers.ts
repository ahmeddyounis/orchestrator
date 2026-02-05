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

type DiffExtractionResult = { diffText: string; confidence: number } | null;

function findNextDiffStart(lines: string[], fromIndex: number): number {
  for (let i = fromIndex; i < lines.length; i++) {
    const trimmedStart = lines[i].trimStart();
    if (trimmedStart.startsWith('diff --git')) return i;
    if (trimmedStart.startsWith('--- a/')) {
      const next = lines[i + 1]?.trimStart() ?? '';
      if (next.startsWith('+++ b/')) return i;
    }
  }
  return -1;
}

function extractDiffBlock(lines: string[], startLine: number): { blockLines: string[]; endLine: number; sawHunk: boolean } {
  const blockLines: string[] = [];
  let inHeader = true;
  let inHunk = false;
  let sawHunk = false;

  const headerOnlyPrefixes = [
    'index ',
    'new file mode ',
    'deleted file mode ',
    'old mode ',
    'new mode ',
    'similarity index ',
    'dissimilarity index ',
    'rename from ',
    'rename to ',
    'copy from ',
    'copy to ',
  ];

  for (let i = startLine; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedStart = rawLine.trimStart();

    if (trimmedStart.startsWith('diff --git')) {
      inHeader = true;
      inHunk = false;
      blockLines.push(rawLine);
      continue;
    }

    if (trimmedStart.startsWith('--- ') || trimmedStart.startsWith('+++ ')) {
      inHeader = true;
      inHunk = false;
      blockLines.push(rawLine);
      continue;
    }

    if (headerOnlyPrefixes.some((p) => trimmedStart.startsWith(p))) {
      if (inHeader) blockLines.push(rawLine);
      continue;
    }

    if (trimmedStart.startsWith('@@ ')) {
      inHeader = false;
      inHunk = true;
      sawHunk = true;
      blockLines.push(rawLine);
      continue;
    }

    if (inHunk) {
      if (rawLine === '') {
        blockLines.push(rawLine);
        continue;
      }

      // Allow optional indentation before the unified diff line marker.
      // Note: context lines begin with a space marker, so we must *not* trimStart().
      if (/^[ \t]*[ +\-\\]/.test(rawLine)) {
        blockLines.push(rawLine);
        continue;
      }

      // We've left the diff region (e.g., trailing commentary or markers).
      return { blockLines, endLine: i, sawHunk };
    }

    // While still in headers, ignore unrelated lines (e.g. model preamble/noise) until we hit a hunk.
  }

  return { blockLines, endLine: lines.length, sawHunk };
}

function dedentUnifiedDiff(text: string): string {
  const lines = text.split('\n');
  const headerLikePrefixes = [
    'diff --git',
    'index ',
    'new file mode ',
    'deleted file mode ',
    'old mode ',
    'new mode ',
    'similarity index ',
    'dissimilarity index ',
    'rename from ',
    'rename to ',
    'copy from ',
    'copy to ',
    '--- ',
    '+++ ',
    '@@ ',
  ];

  const indents: number[] = [];
  for (const line of lines) {
    if (line === '') continue;
    const trimmedStart = line.trimStart();
    if (!headerLikePrefixes.some((p) => trimmedStart.startsWith(p))) continue;
    indents.push(line.length - trimmedStart.length);
  }

  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
  if (commonIndent <= 0) return text;

  return lines
    .map((line) => {
      if (line.length === 0) return line;
      if (line.length < commonIndent) return line;
      return line.slice(commonIndent);
    })
    .join('\n');
}

function extractUnifiedDiffFromText(sanitized: string): string | null {
  const lines = sanitized.split('\n');
  const blocks: string[] = [];

  let cursor = 0;
  while (cursor < lines.length) {
    const start = findNextDiffStart(lines, cursor);
    if (start === -1) break;

    const { blockLines, endLine, sawHunk } = extractDiffBlock(lines, start);
    cursor = Math.max(endLine, start + 1);

    if (!sawHunk || blockLines.length === 0) continue;
    blocks.push(blockLines.join('\n'));
  }

  if (blocks.length === 0) return null;

  const combined = trimCompletelyEmptyOuterLines(blocks.join('\n'));
  const dedented = trimCompletelyEmptyOuterLines(dedentUnifiedDiff(combined));
  return dedented.length > 0 ? dedented : null;
}

function parseWithMarker(sanitized: string): DiffExtractionResult {
  const markerRegex = /<BEGIN_DIFF>([\s\S]*?)<\/?END_DIFF>/;
  const markerMatch = sanitized.match(markerRegex);
  if (markerMatch) {
    const extracted = extractUnifiedDiffFromText(markerMatch[1]);
    if (extracted && isValidDiffStructure(extracted)) return { diffText: extracted, confidence: 1.0 };
  }
  return null;
}

function parseWithFence(sanitized: string): DiffExtractionResult {
  const fenceRegex = /```diff([\s\S]*?)```/;
  const fenceMatch = sanitized.match(fenceRegex);
  if (fenceMatch) {
    const extracted = extractUnifiedDiffFromText(fenceMatch[1]);
    if (extracted && isValidDiffStructure(extracted)) return { diffText: extracted, confidence: 0.9 };
  }
  return null;
}

function parseWithHeuristic(sanitized: string): DiffExtractionResult {
  const extracted = extractUnifiedDiffFromText(sanitized);
  if (extracted && isValidDiffStructure(extracted)) return { diffText: extracted, confidence: 0.7 };
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

function trimCompletelyEmptyOuterLines(raw: string): string {
  // Remove completely empty leading/trailing lines (no characters at all),
  // but preserve whitespace-only lines (which are meaningful in diffs as blank context).
  const lines = raw.split('\n');
  const firstContentIdx = lines.findIndex((l) => l !== '');
  if (firstContentIdx === -1) return '';

  let lastContentIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== '') {
      lastContentIdx = i;
      break;
    }
  }

  return lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');
}

/**
 * Parses a step-by-step plan from text.
 * Looks for numbered lists (1. ) or bullet points (- ) that look like steps.
 */
export function parsePlanFromText(text: string): PlanParsed | null {
  const sanitized = sanitizeOutput(text);
  const lines = sanitized.split('\n');
  const steps: string[] = [];

  const hasHierarchicalNumbering = lines.some((line) => /^\d+\.\d+/.test(line.trim()));

  const looksActionable = (step: string): boolean => {
    const trimmed = step.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('set up ')) return true;
    if (lower.startsWith('wire up ')) return true;

    const firstWord = lower.split(/\s+/, 1)[0] ?? '';
    const imperativeVerbs = new Set([
      'add',
      'audit',
      'build',
      'bump',
      'check',
      'configure',
      'create',
      'disable',
      'document',
      'enable',
      'ensure',
      'extract',
      'fix',
      'harden',
      'implement',
      'improve',
      'install',
      'integrate',
      'investigate',
      'limit',
      'migrate',
      'move',
      'parse',
      'refactor',
      'remove',
      'replace',
      'review',
      'run',
      'sanitize',
      'set',
      'setup',
      'support',
      'test',
      'update',
      'validate',
      'verify',
      'wire',
    ]);
    return imperativeVerbs.has(firstWord);
  };

  const isObviousHeader = (content: string): boolean => {
    const trimmed = content.trim();
    if (!trimmed) return true;
    if (trimmed.endsWith(':')) return true;
    const lettersOnly = trimmed.replace(/[^A-Za-z]/g, '');
    const isAllCaps = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
    return isAllCaps;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    // Match "1. Step" or "- Step"
    const numberMatch = trimmed.match(/^\d+(?:\.\d+)*[.)]?\s+(.*)/);
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);

    if (numberMatch) {
      const content = numberMatch[1].trim();
      const isTopLevelNumbered = /^\d+[.)]\s+/.test(trimmed) && !/^\d+\.\d+/.test(trimmed);
      if (hasHierarchicalNumbering && isTopLevelNumbered && !looksActionable(content)) {
        continue;
      }
      if (!hasHierarchicalNumbering && isObviousHeader(content) && !looksActionable(content)) {
        continue;
      }
      steps.push(content);
    } else if (bulletMatch) {
      const content = bulletMatch[1].trim();
      if (isObviousHeader(content) && !looksActionable(content)) continue;
      steps.push(content);
    }
  }

  if (steps.length > 0) {
    return { steps, confidence: 0.8 };
  }

  return null;
}
