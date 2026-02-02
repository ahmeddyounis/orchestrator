import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

type Violation = {
  path: string;
  reason: string;
};

function isOrchestratorRunArtifact(p: string): boolean {
  return p.startsWith('.orchestrator/') || p.includes('/.orchestrator/');
}

function isGeneratedTsBuildOutputInSrc(p: string): boolean {
  if (!/^packages\/[^/]+\/src\//.test(p)) return false;
  return p.endsWith('.d.ts') || p.endsWith('.d.ts.map') || p.endsWith('.js.map');
}

function collectViolations(paths: string[]): Violation[] {
  const violations: Violation[] = [];

  for (const p of paths) {
    if (isOrchestratorRunArtifact(p)) {
      violations.push({ path: p, reason: 'Tracked Orchestrator run artifact' });
      continue;
    }
    if (isGeneratedTsBuildOutputInSrc(p)) {
      violations.push({ path: p, reason: 'Likely TS build output tracked under src/' });
    }
  }

  return violations;
}

function filterExisting(repoRoot: string, violations: Violation[]): Violation[] {
  return violations.filter((v) => fs.existsSync(path.join(repoRoot, v.path)));
}

function main(): void {
  let repoRoot = '';
  try {
    repoRoot = git(['rev-parse', '--show-toplevel']).trim();
  } catch {
    // Not a git checkout; nothing to validate.
    process.exit(0);
  }

  const raw = git(['ls-files', '-z']);
  const trackedPaths = raw.split('\0').filter(Boolean);

  const violations = collectViolations(trackedPaths);
  const existingViolations = filterExisting(repoRoot, violations);

  if (existingViolations.length === 0) return;

  console.error('Repository contains tracked generated artifacts that should not be committed:\n');

  for (const v of existingViolations.slice(0, 50)) {
    console.error(`- ${v.path} (${v.reason})`);
  }
  if (existingViolations.length > 50) {
    console.error(`... and ${existingViolations.length - 50} more.`);
  }

  console.error('\nFix: remove these files from git and add them to .gitignore if needed.');
  console.error('Hint: Orchestrator artifacts should be untracked under `.orchestrator/`.');
  process.exit(1);
}

main();
