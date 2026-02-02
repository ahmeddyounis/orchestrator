import { Orchestrator, ConfigLoader } from '@orchestrator/core';
import { ProviderConfig } from '@orchestrator/shared';
import { GitService } from '@orchestrator/repo';
import { ProviderRegistry } from '@orchestrator/core';
import { FakeAdapter } from '@orchestrator/adapters';
import * as path from 'path';
import * as fs from 'fs/promises';

async function main() {
  const repoRoot = path.resolve('large_repo_fixture');
  const config = ConfigLoader.load({ cwd: repoRoot });

  const registry = new ProviderRegistry(config);
  registry.registerFactory('fake', (config: ProviderConfig) => new FakeAdapter(config));

  config.providers = {
    fake: {
      type: 'fake',
      model: 'fake-model',
    },
  };

  config.defaults = {
    planner: 'fake',
    executor: 'fake',
    reviewer: 'fake',
  };

  const git = new GitService({ repoRoot });

  const orchestrator = await Orchestrator.create({
    config,
    git,
    registry,
    repoRoot,
  });

  console.log('Running with default settings (no guardrails)...');
  const runId1 = Date.now().toString();
  await orchestrator.run('test goal', { thinkLevel: 'L1', runId: runId1 });

  const trace1 = await fs.readFile(
    path.join(repoRoot, '.orchestrator', 'runs', runId1, 'trace.jsonl'),
    'utf-8',
  );
  const events1 = trace1
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const perf1 = events1.filter((e) => e.type === 'PerformanceMeasured');

  console.log('Performance (no guardrails):');
  console.table(perf1.map((e) => e.payload));

  // Now with guardrails
  config.context = config.context || {};
  config.context.maxCandidates = 100;
  config.context.scanner = {
    maxFiles: 1000,
    maxFileSize: 1024 * 1024,
  };

  const orchestrator2 = await Orchestrator.create({
    config,
    git,
    registry,
    repoRoot,
  });

  console.log('Running with guardrails...');
  const runId2 = Date.now().toString();
  await orchestrator2.run('test goal', { thinkLevel: 'L1', runId: runId2 });

  const trace2 = await fs.readFile(
    path.join(repoRoot, '.orchestrator', 'runs', runId2, 'trace.jsonl'),
    'utf-8',
  );
  const events2 = trace2
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const perf2 = events2.filter((e) => e.type === 'PerformanceMeasured');

  console.log('Performance (with guardrails):');
  console.table(perf2.map((e) => e.payload));

  const scanDuration1 = perf1.find((e) => e.payload.name === 'repo_scan').payload.durationMs;
  const scanDuration2 = perf2.find((e) => e.payload.name === 'repo_scan').payload.durationMs;

  if (scanDuration2 >= scanDuration1) {
    throw new Error(
      `Scan with guardrails should be faster. No guardrails: ${scanDuration1}ms, with guardrails: ${scanDuration2}ms`,
    );
  }

  console.log('Performance test passed!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
