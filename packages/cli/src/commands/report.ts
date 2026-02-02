import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { findRepoRoot } from '@orchestrator/repo';
import {
  normalizePath,
  readManifest,
  RUN_SUMMARY_SCHEMA_VERSION,
  type Manifest,
  type RunSummary,
  UsageError,
} from '@orchestrator/shared';

type JsonObject = Record<string, unknown>;

function isStructuredRunSummary(value: unknown): value is RunSummary {
  if (!value || typeof value !== 'object') return false;
  const obj = value as JsonObject;
  return obj.schemaVersion === RUN_SUMMARY_SCHEMA_VERSION && typeof obj.runId === 'string';
}

async function tryReadJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'N/A';
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

function parseChangedFilesFromPatch(patchText: string): string[] {
  const files = new Set<string>();
  for (const line of patchText.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!match) continue;
    files.add(match[2]);
  }
  return [...files];
}

function isAbsolutePath(p: string): boolean {
  const normalized = normalizePath(p);
  if (normalized.startsWith('/')) return true;
  if (normalized.startsWith('//')) return true;
  return /^[a-zA-Z]:\//.test(normalized);
}

function resolveRunPath(runDir: string, maybePath: string | undefined): string | undefined {
  if (!maybePath) return undefined;
  if (isAbsolutePath(maybePath)) return normalizePath(maybePath);
  return normalizePath(path.join(runDir, maybePath));
}

async function resolveLatestRunId(runsDir: string): Promise<string | undefined> {
  const entries: Array<{ runId: string; startedAtMs: number }> = [];
  try {
    const dirents = await fs.readdir(runsDir, { withFileTypes: true });

    for (const d of dirents) {
      if (!d.isDirectory()) continue;
      const runId = d.name;
      const manifestPath = path.join(runsDir, runId, 'manifest.json');
      const manifest = await tryReadJson<Manifest>(manifestPath);
      const startedAtMs = manifest?.startedAt ? Date.parse(manifest.startedAt) : NaN;
      if (Number.isFinite(startedAtMs)) {
        entries.push({ runId, startedAtMs });
      }
    }
  } catch {
    // ignore
  }

  if (entries.length > 0) {
    entries.sort((a, b) => b.startedAtMs - a.startedAtMs);
    return entries[0].runId;
  }

  // Fallback: pick most recently modified directory.
  try {
    const dirents = await fs.readdir(runsDir, { withFileTypes: true });
    const stats = await Promise.all(
      dirents
        .filter((d) => d.isDirectory())
        .map(async (d) => {
          const runDir = path.join(runsDir, d.name);
          const st = await fs.stat(runDir);
          return { runId: d.name, mtimeMs: st.mtimeMs };
        }),
    );
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return stats[0]?.runId;
  } catch {
    return undefined;
  }
}

export function registerReportCommand(program: Command) {
  program
    .command('report')
    .argument('[runId]', 'Run ID (defaults to most recent)')
    .description('View a summary report for the last run, or a specific run')
    .action(async (runId?: string) => {
      const opts = program.opts();
      const repoRoot = await findRepoRoot();
      const runsDir = path.join(repoRoot, '.orchestrator', 'runs');

      const resolvedRunId = runId ?? (await resolveLatestRunId(runsDir));
      if (!resolvedRunId) {
        throw new UsageError(
          'No runs found. Run "orchestrator run \\"<goal>\\"" first, then try again.',
        );
      }

      const runDir = path.join(runsDir, resolvedRunId);
      const manifestPath = path.join(runDir, 'manifest.json');
      const summaryPath = path.join(runDir, 'summary.json');

      const manifest =
        (await (async () => {
          try {
            return await readManifest(manifestPath);
          } catch {
            return undefined;
          }
        })()) ?? (await tryReadJson<Manifest>(manifestPath));
      const summaryJson = await tryReadJson<unknown>(summaryPath);

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              runId: resolvedRunId,
              runDir: normalizePath(runDir),
              manifest,
              summary: summaryJson,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(pc.bold('\nRun report'));
      console.log(`  ${pc.bold('Run ID:')} ${resolvedRunId}`);
      console.log(`  ${pc.bold('Dir:')} ${normalizePath(runDir)}`);

      if (!summaryJson) {
        console.log(pc.yellow('\nNo summary found for this run.'));
        console.log(`  Expected: ${normalizePath(summaryPath)}`);
        return;
      }

      if (!isStructuredRunSummary(summaryJson)) {
        console.log(pc.yellow('\nUnstructured summary (raw JSON):'));
        console.log(JSON.stringify(summaryJson, null, 2));
        return;
      }

      const summary = summaryJson;
      const statusIcon = summary.status === 'success' ? pc.green('✅') : pc.red('❌');
      console.log(`\n  ${pc.bold('Status:')} ${statusIcon} ${summary.status.toUpperCase()}`);
      if (summary.goal) console.log(`  ${pc.bold('Goal:')} ${summary.goal}`);
      console.log(`  ${pc.bold('Command:')} ${summary.command.join(' ')}`);
      console.log(`  ${pc.bold('Started:')} ${summary.startedAt}`);
      console.log(`  ${pc.bold('Finished:')} ${summary.finishedAt}`);
      console.log(`  ${pc.bold('Duration:')} ${formatDuration(summary.durationMs)}`);

      console.log(
        `\n  ${pc.bold('Providers:')} planner=${summary.selectedProviders.planner}, executor=${summary.selectedProviders.executor}${
          summary.selectedProviders.reviewer
            ? `, reviewer=${summary.selectedProviders.reviewer}`
            : ''
        }`,
      );

      const totals = summary.costs.totals;
      const costStr =
        typeof totals.estimatedCostUsd === 'number' ? `$${totals.estimatedCostUsd.toFixed(4)}` : '';
      console.log(
        `  ${pc.bold('Cost:')} ${totals.totalTokens} tokens${costStr ? ` (${costStr})` : ''}`,
      );

      if (summary.verification) {
        if (!summary.verification.enabled) {
          console.log(`\n  ${pc.bold('Verification:')} Not run`);
        } else {
          const icon =
            summary.verification.passed === true
              ? pc.green('✅')
              : summary.verification.passed === false
                ? pc.red('❌')
                : pc.yellow('⚠');
          console.log(
            `\n  ${pc.bold('Verification:')} ${icon} ${summary.verification.passed === true ? 'Passed' : 'Failed'}`,
          );
        }
      }

      const finalDiffPath =
        summary.patchStats?.finalDiffPath ??
        summary.artifacts.patchPaths?.find((p) => p.endsWith('final.diff.patch')) ??
        summary.artifacts.patchPaths?.[summary.artifacts.patchPaths.length - 1];

      if (finalDiffPath) {
        try {
          const resolvedFinal = resolveRunPath(runDir, finalDiffPath);
          if (resolvedFinal) {
            const patchText = await fs.readFile(resolvedFinal, 'utf-8');
            const changedFiles = parseChangedFilesFromPatch(patchText);
            if (changedFiles.length > 0) {
              console.log(`\n  ${pc.bold('Changed files:')}`);
              changedFiles.slice(0, 20).forEach((f) => console.log(`    - ${f}`));
              if (changedFiles.length > 20)
                console.log(`    ... and ${changedFiles.length - 20} more.`);
            }
          }
        } catch {
          // ignore
        }
      }

      if (manifest) {
        console.log(`\n  ${pc.bold('Artifacts:')}`);
        const resolvedSummary = resolveRunPath(runDir, manifest.summaryPath);
        const resolvedTrace = resolveRunPath(runDir, manifest.tracePath);
        const resolvedConfig = resolveRunPath(runDir, manifest.effectiveConfigPath);
        if (resolvedSummary) console.log(`    - Summary: ${resolvedSummary}`);
        if (resolvedTrace) console.log(`    - Trace: ${resolvedTrace}`);
        if (resolvedConfig) console.log(`    - Effective config: ${resolvedConfig}`);
        if (manifest.patchPaths?.length) {
          const last = manifest.patchPaths[manifest.patchPaths.length - 1];
          const resolvedLastPatch = resolveRunPath(runDir, last);
          console.log(`    - Final patch: ${resolvedLastPatch ?? normalizePath(last)}`);
        } else if (finalDiffPath) {
          const resolvedFinal = resolveRunPath(runDir, finalDiffPath);
          console.log(`    - Final patch: ${resolvedFinal ?? normalizePath(finalDiffPath)}`);
        }
        const toolLogsDir = normalizePath(path.join(runDir, 'tool_logs'));
        const toolLogsCount = manifest.toolLogPaths?.length ?? 0;
        console.log(`    - Tool logs: ${toolLogsDir}${toolLogsCount ? ` (${toolLogsCount})` : ''}`);

        const verificationCount = manifest.verificationPaths?.length ?? 0;
        if (verificationCount > 0) {
          console.log(
            `    - Verification artifacts: ${verificationCount} (see manifest.verificationPaths)`,
          );
        }
      }
    });
}
