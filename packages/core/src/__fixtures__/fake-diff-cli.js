#!/usr/bin/env node

/**
 * Fake interactive CLI used by deterministic orchestrator tests.
 *
 * It prints a shell-like prompt so the subprocess adapter can detect readiness,
 * then reads the model prompt from stdin and returns either:
 * - a JSON plan (for the planner role), or
 * - a BEGIN_DIFF/END_DIFF wrapped patch (for executor calls).
 */

function writePrompt() {
  // Must match DefaultCompatibilityProfile.promptDetectionPattern (ends with "> ")
  process.stdout.write('> ');
}

function buildPlanJson() {
  return JSON.stringify(
    {
      steps: ['Update packages/a/src/target.ts and packages/b/src/target.ts to export value = 2.'],
    },
    null,
    0,
  );
}

function buildL0Diff() {
  const diff = [
    'diff --git a/packages/a/src/target.ts b/packages/a/src/target.ts',
    '--- a/packages/a/src/target.ts',
    '+++ b/packages/a/src/target.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
  ].join('\n');

  return `BEGIN_DIFF\n${diff}\nEND_DIFF`;
}

function buildL1Diff() {
  const diff = [
    'diff --git a/packages/a/src/target.ts b/packages/a/src/target.ts',
    '--- a/packages/a/src/target.ts',
    '+++ b/packages/a/src/target.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
    'diff --git a/packages/b/src/target.ts b/packages/b/src/target.ts',
    '--- a/packages/b/src/target.ts',
    '+++ b/packages/b/src/target.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
  ].join('\n');

  return `BEGIN_DIFF\n${diff}\nEND_DIFF`;
}

function buildFailingDiff() {
  const diff = [
    'diff --git a/does-not-exist.txt b/does-not-exist.txt',
    '--- a/does-not-exist.txt',
    '+++ b/does-not-exist.txt',
    '@@ -1 +1 @@',
    '-nope',
    '+still nope',
    '',
  ].join('\n');

  return `BEGIN_DIFF\n${diff}\nEND_DIFF`;
}

writePrompt();

let buffer = '';
let flushTimer = null;

function handleInput(input) {
  const text = input.toString('utf8');

  // Planner requests (jsonMode) include the planner system prompt.
  if (text.includes('software architecture planner')) {
    return buildPlanJson();
  }

  if (text.includes('FAILURE_GOAL')) {
    return buildFailingDiff();
  }

  // L1 executor prompts mention "current step".
  if (text.includes('implement the current step')) {
    return buildL1Diff();
  }

  // Fallback: treat as L0 executor prompt.
  return buildL0Diff();
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const response = handleInput(buffer).trimEnd();
    buffer = '';
    process.stdout.write(`${response}\n`);
    writePrompt();
  }, 10);
});

process.stdin.resume();
