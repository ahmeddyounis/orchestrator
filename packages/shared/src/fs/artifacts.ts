import { join } from './path';
import * as fs from 'fs/promises';

export const ORCHESTRATOR_DIR = '.orchestrator';
export const RUNS_DIR = 'runs';

export interface RunArtifactPaths {
  root: string;
  trace: string;
  summary: string;
  manifest: string;
  patchesDir: string;
  toolLogsDir: string;
}

export interface Manifest {
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
    manifest: join(runRootDir, 'manifest.json'),
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
    manifest: join(runRootDir, 'manifest.json'),
    patchesDir: join(runRootDir, 'patches'),
    toolLogsDir: join(runRootDir, 'tool_logs'),
  };
}

export async function writeManifest(manifestPath: string, manifest: Manifest): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
