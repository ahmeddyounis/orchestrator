import { join, normalizePath } from './path';
import * as fs from 'fs/promises';

export const ORCHESTRATOR_DIR = '.orchestrator';
export const RUNS_DIR = 'runs';
export const MANIFEST_FILENAME = 'manifest.json';
export const MANIFEST_VERSION = 1;

export interface RunArtifactPaths {
  root: string;
  trace: string;
  summary: string;
  manifest: string;
  patchesDir: string;
  toolLogsDir: string;
}

export interface Manifest {
  schemaVersion: typeof MANIFEST_VERSION;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  command: string;
  repoRoot: string;
  artifactsDir: string;
  tracePath: string;
  summaryPath: string;
  effectiveConfigPath: string;
  patchPaths: string[];
  contextPaths?: string[];
  toolLogPaths: string[];
  verificationPaths?: string[];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function toRunRelativePath(runDir: string, p: string): string {
  const normalizedRunDir = normalizePath(runDir).replace(/\/+$/, '');
  const normalizedPath = normalizePath(p);

  // If already relative, keep it as-is (but normalized).
  if (!normalizedPath.includes(':') && !normalizedPath.startsWith('/')) {
    return normalizedPath;
  }

  if (normalizedPath.startsWith(`${normalizedRunDir}/`)) {
    return normalizedPath.slice(normalizedRunDir.length + 1);
  }

  return normalizedPath;
}

function normalizeManifest(manifest: Manifest): Manifest {
  const artifactsDir = normalizePath(manifest.artifactsDir);
  const normalizePaths = (values: string[] | undefined): string[] =>
    uniqueStrings((values ?? []).map((p) => toRunRelativePath(artifactsDir, p)));

  return {
    ...manifest,
    schemaVersion: manifest.schemaVersion ?? MANIFEST_VERSION,
    repoRoot: normalizePath(manifest.repoRoot),
    artifactsDir,
    tracePath: normalizePath(manifest.tracePath),
    summaryPath: normalizePath(manifest.summaryPath),
    effectiveConfigPath: normalizePath(manifest.effectiveConfigPath),
    patchPaths: normalizePaths(manifest.patchPaths),
    toolLogPaths: normalizePaths(manifest.toolLogPaths),
    contextPaths: normalizePaths(manifest.contextPaths),
    verificationPaths: normalizePaths(manifest.verificationPaths),
  };
}

/**
 * Creates the artifact directory structure for a specific run.
 * Returns the paths to the standard artifacts.
 */
export async function createRunDir(baseDir: string, runId: string): Promise<RunArtifactPaths> {
  const runRootDir = join(baseDir, ORCHESTRATOR_DIR, RUNS_DIR, runId);
  const toolLogsDir = join(runRootDir, 'tool_logs');
  const patchesDir = join(runRootDir, 'patches');

  await fs.mkdir(runRootDir, { recursive: true });
  await fs.mkdir(toolLogsDir, { recursive: true });
  await fs.mkdir(patchesDir, { recursive: true });

  return {
    root: runRootDir,
    trace: join(runRootDir, 'trace.jsonl'),
    summary: join(runRootDir, 'summary.json'),
    manifest: join(runRootDir, MANIFEST_FILENAME),
    patchesDir: patchesDir,
    toolLogsDir: toolLogsDir,
  };
}

// Alias for backward compatibility if needed, or just remove if I fix call sites.
export const createRunArtifactsDir = createRunDir;

export function getRunArtifactPaths(baseDir: string, runId: string): RunArtifactPaths {
  const runRootDir = join(baseDir, ORCHESTRATOR_DIR, RUNS_DIR, runId);
  return {
    root: runRootDir,
    trace: join(runRootDir, 'trace.jsonl'),
    summary: join(runRootDir, 'summary.json'),
    manifest: join(runRootDir, MANIFEST_FILENAME),
    patchesDir: join(runRootDir, 'patches'),
    toolLogsDir: join(runRootDir, 'tool_logs'),
  };
}

export async function writeManifest(manifestPath: string, manifest: Manifest): Promise<void> {
  const normalized = normalizeManifest(manifest);
  await fs.writeFile(manifestPath, JSON.stringify(normalized, null, 2), 'utf-8');
}

export async function readManifest(manifestPath: string): Promise<Manifest> {
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as Manifest;
  return normalizeManifest(parsed);
}

export async function updateManifest(
  manifestPath: string,
  updater: (manifest: Manifest) => void,
): Promise<Manifest> {
  const manifest = await readManifest(manifestPath);
  updater(manifest);
  const normalized = normalizeManifest(manifest);
  await writeManifest(manifestPath, normalized);
  return normalized;
}
