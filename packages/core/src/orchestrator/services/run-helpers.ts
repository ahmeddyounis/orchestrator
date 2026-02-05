import { PatchError, PatchErrorKind } from '@orchestrator/shared';
import { collectHunkFailures, readFileContext } from '../patch_utils';

/**
 * Check if a step should allow an empty diff as success (diagnostic steps)
 */
export function shouldAllowEmptyDiffForStep(step: string): boolean {
  const s = step.toLowerCase();

  // If the step also asks for code changes, an empty diff should be treated as failure.
  const mentionsCodeChange = /\b(fix|implement|add|remove|replace|refactor|update|change|wire|integrate|support|resolve)\b/.test(
    s,
  );
  if (mentionsCodeChange) return false;

  // Explicit command-like steps: treat empty diff as "no-op" success so diagnostic steps don't fail.
  const mentionsPmCommand =
    /\b(pnpm|npm|yarn|bun|turbo)\s+(test|build|lint|typecheck|check|format)\b/.test(s);
  if (mentionsPmCommand) return true;

  // Common diagnostic/baseline phrasing.
  const startsWithDiagnosticVerb =
    /^\s*(run|execute|verify|reproduce|establish|capture|record|measure|collect|inspect)\b/.test(s);
  const mentionsDiagnosticsTarget =
    /\b(test suite|tests|baseline|log|logs|output|report|status)\b/.test(s);
  return startsWithDiagnosticVerb && mentionsDiagnosticsTarget;
}

/**
 * Build context for patch apply retry with error details
 */
export function buildPatchApplyRetryContext(
  patchError: PatchError | undefined,
  repoRoot: string,
): string {
  const details = patchError?.details;
  if (!details || typeof details !== 'object') return '';

  const stderr = (details as { stderr?: unknown }).stderr;
  const rawErrors = (details as { errors?: unknown }).errors;

  const normalizedErrors: Array<{
    kind: string;
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
  }> = [];

  if (Array.isArray(rawErrors)) {
    for (const entry of rawErrors) {
      if (!entry || typeof entry !== 'object') continue;
      const kind = (entry as { kind?: unknown }).kind;
      const message = (entry as { message?: unknown }).message;
      if (typeof kind !== 'string' || typeof message !== 'string') continue;

      const file = (entry as { file?: unknown }).file;
      const line = (entry as { line?: unknown }).line;
      const suggestion = (entry as { suggestion?: unknown }).suggestion;

      normalizedErrors.push({
        kind,
        message,
        file: typeof file === 'string' ? file : undefined,
        line: typeof line === 'number' && Number.isFinite(line) ? line : undefined,
        suggestion: typeof suggestion === 'string' ? suggestion : undefined,
      });
    }
  }

  const maxTotalChars = 6000;
  const maxListItems = 6;
  const lines: string[] = [];

  if (normalizedErrors.length > 0) {
    lines.push('Patch apply error details:');
    for (const err of normalizedErrors.slice(0, maxListItems)) {
      const loc =
        err.file && err.line
          ? `${err.file}:${err.line}`
          : err.file
            ? err.file
            : err.line
              ? `patch line ${err.line}`
              : undefined;
      lines.push(
        `- ${loc ? `${loc}: ` : ''}${err.kind}: ${err.message}${
          err.suggestion ? `\n  suggestion: ${err.suggestion}` : ''
        }`,
      );
    }
  } else if (typeof stderr === 'string' && stderr.trim().length > 0) {
    // Fallback for unparsed stderr patterns.
    if (stderr.includes('patch fragment without header')) {
      lines.push(
        'Patch format issue: a hunk header ("@@ ... @@") appears without file headers. Include "diff --git", "---", and "+++" headers before any hunks.',
      );
    } else if (stderr.includes('corrupt patch at line')) {
      lines.push(
        'Patch format issue: "corrupt patch" indicates malformed hunks (often incorrect @@ line counts). Regenerate the patch using current file content.',
      );
    }
  }

  // If we have file+line details, include file context to help regenerate a clean patch.
  if (Array.isArray(rawErrors)) {
    const hunkFailures = collectHunkFailures(rawErrors);
    if (hunkFailures.length > 0) {
      const maxFiles = 3;
      const windowSize = 20;
      const maxFileContextChars = 2000;

      const selected = hunkFailures.slice(0, maxFiles);
      const failureList = selected
        .map((f) => `- ${f.filePath}:${f.line}${f.kind ? ` (${f.kind})` : ''}`)
        .join('\n');

      lines.push('');
      lines.push(`Failed hunks:\n${failureList}`);

      for (const failure of selected) {
        const context = readFileContext(repoRoot, failure.filePath, failure.line, windowSize, maxFileContextChars);
        if (!context) continue;
        lines.push('');
        lines.push(`File: ${failure.filePath}:${failure.line}\n${context}`);
      }
    }
  }

  const full = lines.join('\n').trim();
  if (!full) return '';
  if (full.length <= maxTotalChars) return full;
  return full.slice(0, maxTotalChars) + '\n... (truncated)';
}

export function extractPatchErrorKind(patchError: PatchError | undefined): PatchErrorKind | undefined {
  if (!patchError) return undefined;

  if (patchError.type === 'validation') return 'INVALID_PATCH';

  const details = patchError.details;
  if (!details || typeof details !== 'object') return undefined;

  const kind = (details as { kind?: unknown }).kind;
  if (typeof kind === 'string') return kind as PatchErrorKind;

  const rawErrors = (details as { errors?: unknown }).errors;
  if (!Array.isArray(rawErrors)) return undefined;

  for (const entry of rawErrors) {
    if (!entry || typeof entry !== 'object') continue;
    const entryKind = (entry as { kind?: unknown }).kind;
    if (typeof entryKind === 'string') return entryKind as PatchErrorKind;
  }

  return undefined;
}
