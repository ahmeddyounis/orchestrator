import { PatchError, PatchErrorKind } from '@orchestrator/shared';
import { SearchService } from '@orchestrator/repo';
import { collectHunkFailures, readFileContext } from '../patch_utils';
import path from 'path';

export interface NoopAcceptanceResult {
  allow: boolean;
  reason?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSlashes(s: string): string {
  return s.replace(/\\/g, '/');
}

function extractPhpImportTargets(step: string): { file: string; fqcn: string } | null {
  const text = String(step ?? '').trim();
  if (!text) return null;

  // Only attempt this heuristic for import-like steps.
  if (!/\b(import|use)\b/i.test(text)) return null;

  const fileMatch = text.match(/\b([A-Za-z0-9_./-]+\.php)\b/);
  const fqcnMatch = text.match(/\b[A-Za-z_][A-Za-z0-9_]*(?:\\+[A-Za-z_][A-Za-z0-9_]*){2,}\b/);
  if (!fileMatch || !fqcnMatch) return null;

  // Collapse escaped backslashes (e.g. `Foo\\Bar`) to the canonical `Foo\Bar`.
  const fqcn = fqcnMatch[0].replace(/\\+/g, '\\');
  return { file: fileMatch[1], fqcn };
}

function matchFilePath(candidate: string, matchPath: string): boolean {
  const c = normalizeSlashes(candidate);
  const p = normalizeSlashes(matchPath);
  if (c.includes('/')) return p.endsWith(c);
  return path.posix.basename(p) === c;
}

function looksLikePhpUseImportLine(lineText: string, fqcn: string): boolean {
  const line = String(lineText ?? '').trim();
  if (!line) return false;
  const re = new RegExp(
    `^use\\s+${escapeRegExp(fqcn)}(?:\\s+as\\s+[A-Za-z_][A-Za-z0-9_]*)?\\s*;\\s*$`,
  );
  return re.test(line);
}

/**
 * For certain steps, an empty diff can be treated as success if we can verify
 * the step is already satisfied by the current repo state.
 *
 * This is intentionally conservative: it only supports a narrow heuristic for
 * PHP import ("use ...;") steps to avoid skipping real work.
 */
export async function shouldAcceptEmptyDiffAsNoopForSatisfiedStep(args: {
  step: string;
  repoRoot: string;
  rgPath?: string;
  contextText?: string;
}): Promise<NoopAcceptanceResult> {
  const targets = extractPhpImportTargets(args.step);
  if (!targets) return { allow: false };

  const { file, fqcn } = targets;

  // Fast path: if the fused context contains the target file and a matching use-import line.
  const ctx = String(args.contextText ?? '');
  if (ctx && ctx.includes(file)) {
    const ctxRe = new RegExp(
      `^\\s*use\\s+${escapeRegExp(fqcn)}(?:\\s+as\\s+[A-Za-z_][A-Za-z0-9_]*)?\\s*;\\s*$`,
      'm',
    );
    if (ctxRe.test(ctx)) {
      return {
        allow: true,
        reason: `Found PHP import in fused context: use ${fqcn}; (file hint: ${file})`,
      };
    }
  }

  // Repo search: look for the FQCN and verify it appears as a `use` import in the target file.
  try {
    const searchService = new SearchService(args.rgPath);
    const res = await searchService.search({
      query: fqcn,
      cwd: args.repoRoot,
      maxMatchesPerFile: 10,
      fixedStrings: true,
    });

    for (const m of res.matches) {
      if (!matchFilePath(file, m.path)) continue;
      if (!looksLikePhpUseImportLine(m.lineText, fqcn)) continue;
      return {
        allow: true,
        reason: `Found existing PHP import in repo: ${m.path}:${m.line} (${m.lineText.trim()})`,
      };
    }
  } catch {
    // ignore - noop acceptance is best-effort
  }

  return { allow: false };
}

/**
 * Check if a step should allow an empty diff as success (diagnostic steps)
 */
export function shouldAllowEmptyDiffForStep(step: string): boolean {
  const s = step.toLowerCase();

  // If the step also asks for code changes, an empty diff should be treated as failure.
  const mentionsCodeChange =
    /\b(fix|implement|add|remove|replace|refactor|update|change|wire|integrate|support|resolve)\b/.test(
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
        const context = readFileContext(
          repoRoot,
          failure.filePath,
          failure.line,
          windowSize,
          maxFileContextChars,
        );
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

export function extractPatchErrorKind(
  patchError: PatchError | undefined,
): PatchErrorKind | undefined {
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
