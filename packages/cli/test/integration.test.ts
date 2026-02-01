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
    type: openai
    model: gpt-4o-mini
    apiKey: ${process.env.OPENAI_API_KEY || 'dummy-key'}
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

    // Use a real model for this test, but with a very low budget.
    // This requires the user to have OPENAI_API_KEY set.
    // We should consider mocking the API in the future.
    const { all } = await execa('node', [cliPath, 'run', objective, '--non-interactive'], { 
        cwd: testRepoPath,
        all: true,
    });

    // Check for patch file
    const files = await fs.readdir(testRepoPath);
    const patchFiles = files.filter(f => f.endsWith('.patch'));
    expect(patchFiles.length).toBe(1);

    const patchContent = await fs.readFile(path.join(testRepoPath, patchFiles[0]), 'utf-8');
    expect(patchContent).toMatch(/export const \w+ = \(\) => 'hello world';/);
  }, 120000);
});
