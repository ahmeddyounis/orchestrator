import path from 'node:path';
import * as fsSync from 'node:fs';

export type DiffRepairResult = {
  diffText: string;
  reason: string;
};

export type DiffRepairOptions = {
  repoRoot: string;
  stepHint?: string;
};

const DIFF_GIT_RE = /^diff --git a\/(.+?) b\/(.+?)$/;
const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function tryRepairUnifiedDiff(
  diffText: string,
  options: DiffRepairOptions,
): DiffRepairResult | null {
  // 1) Fix "diff --git" blocks missing file headers ("---"/"+++")
  const repairedDiffGit = repairDiffGitBlocksMissingFileHeaders(diffText);
  if (repairedDiffGit && repairedDiffGit !== diffText) {
    return {
      diffText: repairedDiffGit,
      reason: 'Inserted missing file headers for one or more "diff --git" blocks.',
    };
  }

  // 2) Wrap pure hunk fragments ("@@ ...") with inferred file headers when possible
  const repairedFragment = wrapHunkOnlyFragment(diffText, options);
  if (repairedFragment && repairedFragment !== diffText) {
    return {
      diffText: repairedFragment,
      reason: 'Wrapped hunk-only fragment with inferred file headers.',
    };
  }

  return null;
}

function repairDiffGitBlocksMissingFileHeaders(diffText: string): string | null {
  const lines = diffText.split('\n');
  const out: string[] = [];

  let changed = false;

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.startsWith('diff --git ')) {
      out.push(line);
      i++;
      continue;
    }

    const m = DIFF_GIT_RE.exec(line);
    if (!m) {
      out.push(line);
      i++;
      continue;
    }

    const [, pathA, pathB] = m;

    // Find block end
    let blockEnd = i + 1;
    while (blockEnd < lines.length && !lines[blockEnd].startsWith('diff --git ')) {
      blockEnd++;
    }

    const blockLines = lines.slice(i, blockEnd);
    const hasOld = blockLines.some((l) => l.startsWith('--- '));
    const hasNew = blockLines.some((l) => l.startsWith('+++ '));

    if (hasOld && hasNew) {
      out.push(...blockLines);
      i = blockEnd;
      continue;
    }

    // Copy "diff --git" line and any metadata lines
    out.push(line);
    let j = i + 1;
    while (j < blockEnd && isDiffGitMetadataLine(lines[j])) {
      out.push(lines[j]);
      j++;
    }

    const hasNewFileMode = blockLines.some((l) => l.startsWith('new file mode '));
    const hasDeletedFileMode = blockLines.some((l) => l.startsWith('deleted file mode '));

    const oldHeader = hasNewFileMode ? '--- /dev/null' : `--- a/${pathA}`;
    const newHeader = hasDeletedFileMode ? '+++ /dev/null' : `+++ b/${pathB}`;

    if (!hasOld && !hasNew) {
      out.push(oldHeader);
      out.push(newHeader);
      changed = true;
    } else if (hasOld && !hasNew) {
      // Insert missing "+++ ..." after the first "--- ..."
      let inserted = false;
      for (let k = j; k < blockEnd; k++) {
        out.push(lines[k]);
        if (!inserted && lines[k].startsWith('--- ')) {
          out.push(newHeader);
          inserted = true;
          changed = true;
        }
      }
      i = blockEnd;
      continue;
    } else if (!hasOld && hasNew) {
      // Insert missing "--- ..." before the first "+++ ..."
      let inserted = false;
      for (let k = j; k < blockEnd; k++) {
        if (!inserted && lines[k].startsWith('+++ ')) {
          out.push(oldHeader);
          inserted = true;
          changed = true;
        }
        out.push(lines[k]);
      }
      i = blockEnd;
      continue;
    }

    // Copy the remainder of the block (after metadata)
    out.push(...lines.slice(j, blockEnd));
    i = blockEnd;
  }

  return changed ? out.join('\n') : null;
}

function isDiffGitMetadataLine(line: string): boolean {
  return (
    line.startsWith('index ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('dissimilarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('copy from ') ||
    line.startsWith('copy to ')
  );
}

function wrapHunkOnlyFragment(diffText: string, options: DiffRepairOptions): string | null {
  const lines = diffText.split('\n');
  const hasAnyHeaders = lines.some(
    (l) => l.startsWith('diff --git ') || l.startsWith('--- ') || l.startsWith('+++ '),
  );
  if (hasAnyHeaders) return null;

  const hasAnyHunks = lines.some((l) => l.startsWith('@@ '));
  if (!hasAnyHunks) return null;

  const inferredPath = inferSingleFilePathFromHint(options.stepHint, options.repoRoot);
  if (!inferredPath) return null;

  const headerMode = inferHeaderModeFromFirstHunk(lines);
  const headers =
    headerMode === 'new'
      ? [`diff --git a/${inferredPath} b/${inferredPath}`, '--- /dev/null', `+++ b/${inferredPath}`]
      : headerMode === 'delete'
        ? [
            `diff --git a/${inferredPath} b/${inferredPath}`,
            `--- a/${inferredPath}`,
            '+++ /dev/null',
          ]
        : [
            `diff --git a/${inferredPath} b/${inferredPath}`,
            `--- a/${inferredPath}`,
            `+++ b/${inferredPath}`,
          ];

  return [...headers, diffText].join('\n');
}

function inferHeaderModeFromFirstHunk(lines: string[]): 'modify' | 'new' | 'delete' {
  const firstHunk = lines.find((l) => l.startsWith('@@ '));
  if (!firstHunk) return 'modify';

  const m = HUNK_HEADER_RE.exec(firstHunk);
  if (!m) return 'modify';

  const oldStart = Number(m[1]);
  const oldCount = Number(m[2] ?? '1');
  const newStart = Number(m[3]);
  const newCount = Number(m[4] ?? '1');

  if (oldStart === 0 && oldCount === 0) return 'new';
  if (newStart === 0 && newCount === 0) return 'delete';
  return 'modify';
}

function inferSingleFilePathFromHint(
  stepHint: string | undefined,
  repoRoot: string,
): string | null {
  if (!stepHint) return null;

  const candidates = extractFilePathCandidates(stepHint);
  if (candidates.length === 0) return null;

  // Prefer existing paths, but allow new-file paths if unambiguous.
  const existing = candidates.filter((p) => fsSync.existsSync(path.join(repoRoot, p)));
  if (existing.length === 1) return existing[0];
  if (existing.length > 1) return null;

  return candidates.length === 1 ? candidates[0] : null;
}

function extractFilePathCandidates(text: string): string[] {
  const matches = text.matchAll(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+/g);
  const out: string[] = [];
  for (const m of matches) {
    const raw = m[0].replace(/^['"`]+|['"`.,;:]+$/g, '');
    if (!raw) continue;
    if (raw.startsWith('/') || raw.includes('..')) continue;
    out.push(raw);
  }
  return Array.from(new Set(out));
}
