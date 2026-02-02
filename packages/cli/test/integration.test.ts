import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

const projectRoot = path.resolve(__dirname, '../../../');
const cliPath = path.join(projectRoot, 'packages/cli/dist/index.js');
const fixturesDir = path.join(projectRoot, 'demos');

async function setupFixture(fixtureName: string, testDir: string): Promise<string> {
  const fixturePath = path.join(fixturesDir, fixtureName);
  const testRepoPath = path.join(testDir, fixtureName);
  await fs.cp(fixturePath, testRepoPath, { recursive: true });

  // Create orchestrator config
  const orchestratorConfig = `
providers:
  openai:
    type: fake
    model: fake-model
`;
  await fs.writeFile(path.join(testRepoPath, '.orchestrator.yaml'), orchestratorConfig);

  // Create gitignore
  await fs.writeFile(path.join(testRepoPath, '.gitignore'), 'node_modules\n.tmp\n');

  await execa('git', ['init'], { cwd: testRepoPath });
  await execa('git', ['add', '.'], { cwd: testRepoPath });
  await execa('git', ['commit', '-m', 'initial commit'], { cwd: testRepoPath });

  return testRepoPath;
}

describe('CLI Integration Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let testRepoPath: string;

  beforeAll(() => {
    originalCwd = process.cwd();
    testDir = path.join(projectRoot, '.tmp', `integration-tests-${randomUUID()}`);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const perTestId = `integration-test-${randomUUID()}`;
    const perTestDir = path.join(testDir, perTestId);
    await fs.mkdir(perTestDir, { recursive: true });
    testRepoPath = await setupFixture('ts-monorepo-demo', perTestDir);
    process.chdir(testRepoPath);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('should show help message with --help flag', async () => {
    const { stdout } = await execa('node', [cliPath, '--help'], { cwd: testRepoPath });
    expect(stdout).toContain('Usage: orchestrator [options] [command]');
    expect(stdout).toContain('Orchestrator CLI');
  });

  it('L1 flow: should generate a patch for a simple request', async () => {
    const objective = "add a new function to package-a's index.ts that returns 'hello world'";

    const { stdout } = await execa(
      'node',
      [cliPath, '--json', 'run', objective, '--non-interactive'],
      {
        cwd: testRepoPath,
      },
    );

    const result = JSON.parse(stdout);

    expect(result.status).toBe('SUCCESS');
    expect(typeof result.runId).toBe('string');
    expect(typeof result.artifactsDir).toBe('string');

    // Check for patch file in run artifacts
    const patchesDir = path.join(result.artifactsDir, 'patches');
    const patchFiles = (await fs.readdir(patchesDir)).filter((f) => f.endsWith('.patch'));
    expect(patchFiles.length).toBeGreaterThan(0);

    const patchContent = await fs.readFile(path.join(patchesDir, patchFiles[0]), 'utf-8');
    expect(patchContent).toMatch(/export const \w+ = \(\) => 'hello world';/);

    // Report should load summary/manifest for this run
    const { stdout: reportJson } = await execa(
      'node',
      [cliPath, '--json', 'report', result.runId],
      {
        cwd: testRepoPath,
      },
    );
    const report = JSON.parse(reportJson);
    expect(report.runId).toBe(result.runId);
    expect(typeof report.runDir).toBe('string');
    expect(report.manifest).toBeTruthy();
    expect(report.summary).toBeTruthy();

    // "Most recent" report should match when no runId is provided
    const { stdout: reportLatestJson } = await execa('node', [cliPath, '--json', 'report'], {
      cwd: testRepoPath,
    });
    const reportLatest = JSON.parse(reportLatestJson);
    expect(reportLatest.runId).toBe(result.runId);
  }, 120000);
});
