export function extractUnifiedDiff(outputText: string | undefined): string | null {
  if (!outputText) return null;

  const lines = outputText.split('\n');

  // 1) Marker blocks (must be on their own line to avoid false positives inside patches)
  const beginIdx = lines.findIndex((line) => {
    const t = line.trim();
    return t === 'BEGIN_DIFF' || t === '<BEGIN_DIFF>';
  });
  if (beginIdx !== -1) {
    const endIdx = lines.findIndex((line, idx) => {
      if (idx <= beginIdx) return false;
      const t = line.trim();
      return t === 'END_DIFF' || t === '<END_DIFF>';
    });

    if (endIdx !== -1 && endIdx > beginIdx) {
      return trimDiff(lines.slice(beginIdx + 1, endIdx).join('\n'));
    }
  }

  // 2) Markdown fences ```diff ... ```
  const fenceStartIdx = lines.findIndex((line) => line.trim() === '```diff');
  if (fenceStartIdx !== -1) {
    const fenceEndIdx = lines.findIndex((line, idx) => idx > fenceStartIdx && line.trim() === '```');
    if (fenceEndIdx !== -1 && fenceEndIdx > fenceStartIdx) {
      return trimDiff(lines.slice(fenceStartIdx + 1, fenceEndIdx).join('\n'));
    }
  }

  // 3) Raw unified diff output (no markers)
  const diffStartIdx = lines.findIndex((line) => {
    const l = line.replace(/\r$/, '');
    return l.startsWith('diff --git') || l.startsWith('--- a/') || l.startsWith('--- /dev/null');
  });
  if (diffStartIdx !== -1) {
    return trimDiff(lines.slice(diffStartIdx).join('\n'));
  }

  return null;
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

