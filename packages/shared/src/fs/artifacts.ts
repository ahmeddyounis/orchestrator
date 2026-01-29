import * as path from 'path';
import * as fs from 'fs/promises';

export const ORCHESTRATOR_DIR = '.orchestrator';
export const RUNS_DIR = 'runs';

export interface RunArtifactPaths {
  root: string;
  trace: string;
  summary: string;
  diff: string;
  toolLogs: string;
}

/**
 * Creates the artifact directory structure for a specific run.
 * Returns the paths to the standard artifacts.
 */
export async function createRunArtifactsDir(
  baseDir: string,
  runId: string,
): Promise<RunArtifactPaths> {
  const runRootDir = path.join(baseDir, ORCHESTRATOR_DIR, RUNS_DIR, runId);
  const toolLogsDir = path.join(runRootDir, 'tool_logs');

  await fs.mkdir(runRootDir, { recursive: true });
  await fs.mkdir(toolLogsDir, { recursive: true });

  return {
    root: runRootDir,
    trace: path.join(runRootDir, 'trace.jsonl'),
    summary: path.join(runRootDir, 'summary.json'),
    diff: path.join(runRootDir, 'diff.patch'),
    toolLogs: toolLogsDir,
  };
}

export function getRunArtifactPaths(baseDir: string, runId: string): RunArtifactPaths {
  const runRootDir = path.join(baseDir, ORCHESTRATOR_DIR, RUNS_DIR, runId);
  return {
    root: runRootDir,
    trace: path.join(runRootDir, 'trace.jsonl'),
    summary: path.join(runRootDir, 'summary.json'),
    diff: path.join(runRootDir, 'diff.patch'),
    toolLogs: path.join(runRootDir, 'tool_logs'),
  };
}
