export function extractUnifiedDiff(outputText: string | undefined): string | null {
  if (!outputText) return null;

  const normalized = outputText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  // 1) Marker blocks (must be on their own line to avoid false positives inside patches)
  const beginIdx = lines.findIndex((line) => {
    const t = line.trim();
    return t === 'BEGIN_DIFF' || t === '<BEGIN_DIFF>';
  });
  if (beginIdx !== -1) {
    const endIdx = lines.findIndex((line, idx) => {
      if (idx <= beginIdx) return false;
      const t = line.trim();
      return t === 'END_DIFF' || t === '<END_DIFF>' || t === '</END_DIFF>';
    });

    if (endIdx !== -1 && endIdx > beginIdx) {
      const extracted = extractUnifiedDiffFromText(lines.slice(beginIdx + 1, endIdx).join('\n'));
      return extracted ?? trimDiff(lines.slice(beginIdx + 1, endIdx).join('\n'));
    }
  }

  // 2) Markdown fences ```diff ... ```
  const fenceStartIdx = lines.findIndex((line) => line.trim() === '```diff');
  if (fenceStartIdx !== -1) {
    const fenceEndIdx = lines.findIndex(
      (line, idx) => idx > fenceStartIdx && line.trim() === '```',
    );
    if (fenceEndIdx !== -1 && fenceEndIdx > fenceStartIdx) {
      const extracted = extractUnifiedDiffFromText(
        lines.slice(fenceStartIdx + 1, fenceEndIdx).join('\n'),
      );
      return extracted ?? trimDiff(lines.slice(fenceStartIdx + 1, fenceEndIdx).join('\n'));
    }
  }

  // 3) Heuristic extraction from raw output (no markers)
  const extracted = extractUnifiedDiffFromText(normalized);
  if (extracted) return extracted;

  // 4) Patch fragment (hunk-only). This is technically invalid as-is, but downstream
  // recovery can sometimes repair it by inferring missing headers.
  const hunkStartIdx = lines.findIndex((line) => line.replace(/\r$/, '').startsWith('@@ '));
  if (hunkStartIdx !== -1) {
    const fragmentLines: string[] = [];
    for (let i = hunkStartIdx; i < lines.length; i++) {
      const rawLine = lines[i].replace(/\r$/, '');
      if (rawLine.startsWith('@@ ')) {
        fragmentLines.push(rawLine);
        continue;
      }

      if (rawLine === '') {
        fragmentLines.push(rawLine);
        continue;
      }

      if (/^[ \t]*[ +\-\\]/.test(rawLine)) {
        fragmentLines.push(rawLine);
        continue;
      }

      break;
    }
    return trimDiff(fragmentLines.join('\n'));
  }

  return null;
}

function findNextDiffStart(lines: string[], fromIndex: number): number {
  for (let i = fromIndex; i < lines.length; i++) {
    const trimmedStart = lines[i].trimStart();
    if (trimmedStart.startsWith('diff --git')) return i;
    if (trimmedStart.startsWith('--- a/') || trimmedStart.startsWith('--- /dev/null')) {
      const next = lines[i + 1]?.trimStart() ?? '';
      if (next.startsWith('+++ b/') || next.startsWith('+++ /dev/null')) return i;
    }
  }
  return -1;
}

function extractDiffBlock(
  lines: string[],
  startLine: number,
): { blockLines: string[]; endLine: number; sawHunk: boolean } {
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

    // While still in headers, ignore unrelated lines until we hit a hunk.
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

function extractUnifiedDiffFromText(text: string): string | null {
  const lines = text.split('\n');
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
  const combined = trimDiff(blocks.join('\n'));
  const dedented = trimDiff(dedentUnifiedDiff(combined));
  return dedented.length > 0 ? dedented : null;
}

function trimDiff(raw: string): string {
  // Remove completely empty leading/trailing lines (no characters at all)
  // but preserve lines with spaces (which are valid diff context for blank lines).
  const lines = raw.split('\n');
  const firstContentIdx = lines.findIndex((l) => l !== '');
  let lastContentIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== '') {
      lastContentIdx = i;
      break;
    }
  }
  return firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');
}
