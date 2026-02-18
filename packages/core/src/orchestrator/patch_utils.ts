import path from 'path';
import * as fsSync from 'fs';

export function normalizeGitApplyPath(filePath: string): string {
  return filePath.replace(/^[ab]\//, '');
}

export type HunkFailure = { filePath: string; line: number; kind?: string };

export function collectHunkFailures(errors: unknown[]): HunkFailure[] {
  const byFile = new Map<string, HunkFailure>();

  for (const entry of errors) {
    if (!entry || typeof entry !== 'object') continue;

    const file = (entry as { file?: unknown }).file;
    const line = (entry as { line?: unknown }).line;
    if (typeof file !== 'string') continue;
    if (typeof line !== 'number' || !Number.isFinite(line)) continue;

    const filePath = normalizeGitApplyPath(file);
    // Prefer the earliest line number per file (usually most informative).
    const existing = byFile.get(filePath);
    const normalizedLine = Math.max(1, Math.floor(line));
    if (!existing || normalizedLine < existing.line) {
      const kind = (entry as { kind?: unknown }).kind;
      byFile.set(filePath, {
        filePath,
        line: normalizedLine,
        kind: typeof kind === 'string' ? kind : undefined,
      });
    }
  }

  return Array.from(byFile.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export function readFileContext(
  repoRoot: string,
  filePath: string,
  line: number,
  windowSize: number,
  maxChars: number,
): string {
  const absPath = path.resolve(repoRoot, filePath);
  const absRoot = path.resolve(repoRoot);

  // Safety: avoid reading outside repoRoot.
  if (absPath !== absRoot && !absPath.startsWith(absRoot + path.sep)) return '';

  let content: string;
  try {
    content = fsSync.readFileSync(absPath, 'utf-8');
  } catch {
    return '';
  }

  if (content.length === 0) return '';

  const lines = content.split('\n');

  const targetLine = Math.min(Math.max(1, Math.floor(line)), lines.length);
  const start = Math.max(1, targetLine - windowSize);
  const end = Math.min(lines.length, targetLine + windowSize);

  const excerpt = lines
    .slice(start - 1, end)
    .map((lineText, idx) => {
      const lineNo = start + idx;
      const marker = lineNo === targetLine ? '>' : ' ';
      return `${marker} ${String(lineNo).padStart(4, ' ')} | ${lineText}`;
    })
    .join('\n');

  if (excerpt.length <= maxChars) return excerpt;
  return excerpt.slice(0, maxChars) + '\n... (truncated)';
}
