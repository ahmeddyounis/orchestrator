import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

import { Orchestrator } from '../../core/src/orchestrator';
import { Config, ConfigSchema, ToolPolicy } from '../../shared/src/index';
import { GitService } from './git';
import { createMemoryStore } from '../../memory/src/index';
import { ProviderRegistry } from '../../core/src/registry';
import { UserInterface } from '../../exec/src/index';
import { ProviderAdapter } from '../../adapters/src/index';

const execAsync = promisify(exec);

const TEMP_DIR = path.resolve(__dirname, '../../../../.tmp/memory-context-integration-tests');

class FakeSimpleExecutor implements ProviderAdapter {
  id() { return 'fake-simple-executor'; }
  capabilities() { return { supportsStreaming: false, supportsToolCalling: false, supportsJsonMode: false, modality: 'text', latencyClass: 'fast' }; }
  async generate() { return { text: '{"steps": ["Step 1: Do nothing"]}' }; }
}

describe('Orchestrator Memory/Context Integration', () => {
  let testRepoPath: string;
  let runId: string;
  let dbPath: string;
  let baseConfig: Config;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });

    runId = `test-run-${Date.now()}`;
    testRepoPath = path.join(TEMP_DIR, 'test-repo');
    dbPath = path.join(TEMP_DIR, 'memory.db');

    await fs.mkdir(testRepoPath, { recursive: true });

    await execAsync('git init', { cwd: testRepoPath });
    await execAsync('git config user.email "test@example.com"', { cwd: testRepoPath });
    await execAsync('git config user.name "Test User"', { cwd: testRepoPath });
    
    baseConfig = {
      configVersion: 1,
      thinkLevel: 'L2',
      memory: {
        ...ConfigSchema.parse({}).memory,
        enabled: true,
        storage: { path: dbPath },
        procedural: { enabled: true },
      },
      defaults: {
        planner: 'fake-simple-executor',
        executor: 'fake-simple-executor',
        reviewer: 'fake-simple-executor',
      },
      providers: {
        'fake-simple-executor': { type: 'fake-simple-executor', model: 'fake' },
      },
      verification: {
        enabled: true,
        mode: 'auto',
        auto: {
          enableLint: false,
          enableTypecheck: false,
          enableTests: true,
          testScope: 'full',
        },
      },
    };
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  const toolPolicy: ToolPolicy = {
    enabled: true,
    requireConfirmation: false,
    autoApprove: true,
    interactive: false,
    allowlistPrefixes: ['npm', 'echo'],
    denylistPatterns: [],
    allowNetwork: false,
    timeoutMs: 5000,
    maxOutputBytes: 10240,
  };

  async function setupTestRepoWithFiles() {
    await fs.writeFile(
      path.join(testRepoPath, 'package.json'),
      JSON.stringify({
        name: 'test-repo',
        version: '1.0.0',
        scripts: {
          test: 'npm --version',
        },
      }),
    );
    await execAsync('git add .', { cwd: testRepoPath });
    await execAsync('git commit -m "Initial commit"', { cwd: testRepoPath });
  }

  it('should use fresh procedural memory for verification commands', async () => {
    await setupTestRepoWithFiles();

    // 1. Manually add a memory entry
    const store = createMemoryStore();
    store.init(dbPath);
    try {
      store.upsert({
        id: randomUUID(),
        repoId: testRepoPath, // Use the same repo path
        type: 'procedural',
        title: 'How to run tests',
        content: 'echo "Tests from memory!"',
        stale: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } finally {
      store.close();
    }
    
    // 2. Setup Orchestrator
    const mockRegistry = new ProviderRegistry(baseConfig);
    mockRegistry.registerFactory('fake-simple-executor', () => new FakeSimpleExecutor());

    const orchestrator = new Orchestrator({
      config: baseConfig,
      git: new GitService({ repoRoot: testRepoPath }),
      registry: mockRegistry,
      repoRoot: testRepoPath,
      ui: { confirm: () => Promise.resolve(true) } as UserInterface,
      toolPolicy,
    });

    // 3. Run and Verify
    const result = await orchestrator.run('A simple change', { runId, thinkLevel: 'L2' });

    expect(result.status).toBe('success');
    expect(result.verification).toBeDefined();
    
    const verification = result.verification!;
    expect(verification.passed).toBe(true);

    const checks = verification.checks;
    const testCheck = checks.find(c => c.name === 'tests');
    expect(testCheck).toBeDefined();
    expect(testCheck!.command).toBe('echo "Tests from memory!"');
    
    const sources = verification.commandSources;
    expect(sources?.['tests']?.source).toBe('memory');
  });

  it('should down-rank stale memory and fallback to detected commands', async () => {
    await setupTestRepoWithFiles();

    // 1. Manually add a memory entry and mark it as stale
    const store = createMemoryStore();
    store.init(dbPath);
    try {
      store.upsert({
        id: randomUUID(),
        repoId: testRepoPath,
        type: 'procedural',
        title: 'How to run tests',
        content: 'echo "This should not be used"',
        stale: true, // Mark as stale
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } finally {
      store.close();
    }

    // 2. Setup Orchestrator
    const mockRegistry = new ProviderRegistry(baseConfig);
    mockRegistry.registerFactory('fake-simple-executor', () => new FakeSimpleExecutor());

    const orchestrator = new Orchestrator({
      config: baseConfig,
      git: new GitService({ repoRoot: testRepoPath }),
      registry: mockRegistry,
      repoRoot: testRepoPath,
      ui: { confirm: () => Promise.resolve(true) } as UserInterface,
      toolPolicy,
    });

    // 3. Run and Verify
    const result = await orchestrator.run('A simple change', { runId, thinkLevel: 'L2' });


    expect(result.status).toBe('success');
    expect(result.verification).toBeDefined();

    const verification = result.verification!;
    expect(verification.passed).toBe(true);

    const checks = verification.checks;
    const testCheck = checks.find(c => c.name === 'tests');
    expect(testCheck).toBeDefined();
    expect(testCheck!.command).toBe('npm test'); // Should be the detected command

    const sources = verification.commandSources;
    const sourceInfo = sources?.['tests'];
    expect(sourceInfo).toBeDefined();
    expect(sourceInfo!.source).toBe('memory');
    expect(sourceInfo!.fallbackReason).toContain('Falling back to detected command');
  });
});