import { execa } from 'execa';
import { promises as fs } from 'fs';
import path from 'path';

// Thresholds
const MIN_SUCCESS_RATE = 0.9;
const ALLOW_ERRORS = false;

interface EvalResult {
  id: string;
  status: 'success' | 'failure' | 'error';
  duration: number;
}

interface EvalSummary {
  results: EvalResult[];
  summary: {
    total: number;
    success: number;
    failure: number;
    error: number;
    successRate: number;
    avgDuration: number;
  };
}

async function main() {
  console.log('🚀 Starting release check...');

  const suitePath = 'packages/eval/src/suites/golden.suite.json';
  const resultsPath = 'results.json';

  try {
    console.log(`Running evaluation suite: ${suitePath}`);
    await execa('pnpm', ['exec', 'orchestrator', 'eval', '--suite', suitePath]);
  } catch (e) {
    console.error('❌ Evaluation run failed.', e);
    process.exit(1);
  }

  console.log(`✅ Evaluation finished. Parsing results from ${resultsPath}...`);

  let summary: EvalSummary;
  try {
    const resultsContent = await fs.readFile(resultsPath, 'utf-8');
    summary = JSON.parse(resultsContent);
  } catch (e) {
    console.error(`❌ Could not read or parse results file at ${resultsPath}.`, e);
    process.exit(1);
  }

  console.log('🔍 Analyzing results...');

  const { successRate, error: errorCount } = summary.summary;
  const errors = summary.results.filter((r) => r.status === 'error');

  let failed = false;

  if (successRate < MIN_SUCCESS_RATE) {
    console.error(
      `❌ FAILED: Success rate is ${successRate}, which is below the threshold of ${MIN_SUCCESS_RATE}.`,
    );
    failed = true;
  } else {
    console.log(`✅ PASSED: Success rate is ${successRate}.`);
  }

  if (!ALLOW_ERRORS && errorCount > 0) {
    console.error(`❌ FAILED: Found ${errorCount} tasks with errors.`);
    errors.forEach((e) => console.error(`  - Task ${e.id} resulted in an error.`));
    failed = true;
  } else {
    console.log(`✅ PASSED: No tasks with errors.`);
  }

  if (failed) {
    console.error('\n🔥 Release check failed.');
    process.exit(1);
  } else {
    console.log('\n✅ All release checks passed!');
  }
}

main().catch((err) => {
  console.error('An unexpected error occurred:', err);
  process.exit(1);
});
