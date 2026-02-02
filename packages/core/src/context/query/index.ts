import path from 'node:path';
import { logger } from '@orchestrator/shared';

export type BuildQueriesInput = {
  runId?: string;
  planStep: string;
  failureSummary?: string;
  touchedFiles?: string[];
  packageFocus?: string;
};

export type BuildQueriesResult = {
  repoQueries: string[];
  memoryQueries: string[];
  emit: () => void;
};

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
]);

function normalizeText(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePathLike(input: string): string {
  return normalizeText(input).replace(/\\/g, '/');
}

function addUnique(target: string[], seen: Set<string>, value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function extractWords(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9]+/g)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w));
}

function extractPathLikes(input: string): string[] {
  const matches = input.match(/[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,10}/g);
  if (!matches) return [];
  return matches.map((m) => normalizePathLike(m)).filter((m) => m.includes('/')); // reduce noise from decimals, etc.
}

function extractTypeScriptErrorLine(
  failureSummary: string,
): { file: string; pos: string; code: string; message: string } | undefined {
  const match = failureSummary.match(
    /([^\s:()]+(?:\/[^\s:()]+)+\.[a-z0-9]{1,10})\((\d+,\d+)\):\s*error\s*(TS\d+):\s*([^\n]+)/i,
  );
  if (!match) return undefined;
  return {
    file: normalizePathLike(match[1]),
    pos: match[2],
    code: match[3].toLowerCase(),
    message: normalizeText(match[4]),
  };
}

function extractEslintError(failureSummary: string): { file?: string; message?: string } {
  const lines = failureSummary
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const fileLine = lines.find((l) => l.startsWith('/') && /\.[a-z0-9]{1,10}$/i.test(l));
  const messageLine = lines.find((l) => /\berror\b/i.test(l) && /no-/.test(l));

  let message: string | undefined;
  if (messageLine) {
    const m = messageLine.match(/\berror\b\s+(.+?)\s+[a-z0-9-]+$/i);
    if (m?.[1]) {
      message = normalizeText(m[1]);
    }
  }

  return {
    file: fileLine ? normalizePathLike(fileLine) : undefined,
    message,
  };
}

function extractJestLikeFailure(failureSummary: string): { file?: string; message?: string } {
  const failMatch = failureSummary.match(/^\s*FAIL\s+(.+)$/m);
  const file = failMatch?.[1] ? normalizePathLike(failMatch[1]) : undefined;

  const refMatch = failureSummary.match(/ReferenceError:\s*([^\n]+)/i);
  const message = refMatch?.[1] ? normalizeText(refMatch[1]) : undefined;

  return { file, message };
}

export function buildQueries(input: BuildQueriesInput): BuildQueriesResult {
  const repoQueries: string[] = [];
  const memoryQueries: string[] = [];
  const repoSeen = new Set<string>();
  const memorySeen = new Set<string>();
  const runId = input.runId ?? 'unknown';

  const planStep = normalizeText(input.planStep ?? '');
  const failureSummary = input.failureSummary ?? '';

  if (!planStep && !failureSummary && (!input.touchedFiles || input.touchedFiles.length === 0)) {
    return { repoQueries: [], memoryQueries: [], emit: () => {} };
  }

  // Failure-derived queries (highest priority)
  if (failureSummary) {
    const tsError = extractTypeScriptErrorLine(failureSummary);
    if (tsError) {
      const full = `${tsError.file}(${tsError.pos}): error ${tsError.code}: ${tsError.message}`;
      addUnique(memoryQueries, memorySeen, full);
      addUnique(repoQueries, repoSeen, tsError.file);
      addUnique(repoQueries, repoSeen, tsError.message);

      const quoted = tsError.message.match(/'([^']+)'/g) ?? [];
      for (const q of quoted) {
        addUnique(repoQueries, repoSeen, q.replace(/'/g, ''));
      }
    }

    const eslint = extractEslintError(failureSummary);
    if (eslint.file) addUnique(repoQueries, repoSeen, eslint.file);
    if (eslint.message) addUnique(repoQueries, repoSeen, eslint.message);

    const jestLike = extractJestLikeFailure(failureSummary);
    if (jestLike.file) addUnique(repoQueries, repoSeen, jestLike.file);
    if (jestLike.message) addUnique(repoQueries, repoSeen, jestLike.message);

    for (const p of extractPathLikes(failureSummary)) {
      addUnique(repoQueries, repoSeen, p);
    }
  }

  // Plan step queries
  if (planStep) {
    addUnique(memoryQueries, memorySeen, planStep);

    for (const p of extractPathLikes(planStep)) {
      addUnique(repoQueries, repoSeen, p);
    }
    for (const word of extractWords(planStep)) {
      addUnique(repoQueries, repoSeen, word);
    }
  }

  // Touched files
  if (input.touchedFiles) {
    for (const file of input.touchedFiles) {
      const normalizedPath = normalizePathLike(file);
      addUnique(repoQueries, repoSeen, normalizedPath);
      addUnique(memoryQueries, memorySeen, path.basename(normalizedPath));
    }
  }

  // Package focus
  if (input.packageFocus) {
    addUnique(repoQueries, repoSeen, input.packageFocus);
    addUnique(memoryQueries, memorySeen, input.packageFocus);
  }

  // Caps
  const cappedRepoQueries = repoQueries.slice(0, 6);
  const cappedMemoryQueries = memoryQueries.slice(0, 4);

  const emit = () => {
    logger.trace(
      {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        type: 'QueriesBuilt',
        payload: {
          repoQueriesCount: cappedRepoQueries.length,
          memoryQueriesCount: cappedMemoryQueries.length,
        },
      },
      'Built context queries',
    );
  };

  return {
    repoQueries: cappedRepoQueries,
    memoryQueries: cappedMemoryQueries,
    emit,
  };
}
