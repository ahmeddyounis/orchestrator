#!/usr/bin/env node

const fs = require('fs');
const promptMarker = '> ';

// Initial prompt
process.stdout.write('Welcome to Fake Diff CLI\n' + promptMarker);

process.stdin.setEncoding('utf8');

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  
  // Process only if we have a newline (Adapter sends \n)
  if (!buffer.includes('\n')) return;

  const input = buffer;
  buffer = '';
  
  // Log input for debugging
  try {
      fs.appendFileSync('/tmp/fake-cli.log', `INPUT_START\n${input}\nINPUT_END\n`);
  } catch (e) {}
  
  let response = '';

  if (input.includes('L1_GOAL')) {
      if (input.includes('architect') || input.includes('PLAN')) {
         // Return Plan
         response = JSON.stringify({
             steps: [
                "Step 1: Modify package A",
                "Step 2: Modify package B"
             ]
         });
      } else if (input.includes('Step 1')) {
            const diff = [
                'BEGIN_DIFF',
                'diff --git a/packages/a/src/target.ts b/packages/a/src/target.ts',
                '--- a/packages/a/src/target.ts',
                '+++ b/packages/a/src/target.ts',
                '@@ -1,1 +1,1 @@',
                '-export const value = 1;',
                '+export const value = 2;',
                'END_DIFF'
            ].join('\n');
            response = diff;
      } else if (input.includes('Step 2')) {
            const diff = [
                'BEGIN_DIFF',
                'diff --git a/packages/b/src/target.ts b/packages/b/src/target.ts',
                '--- a/packages/b/src/target.ts',
                '+++ b/packages/b/src/target.ts',
                '@@ -1,1 +1,1 @@',
                '-export const value = 1;',
                '+export const value = 2;',
                'END_DIFF'
            ].join('\n');
            response = diff;
      }
  } else if (input.includes('L0_GOAL')) {
      // L0 Executor call
       const diff = [
            'BEGIN_DIFF',
            'diff --git a/packages/a/src/target.ts b/packages/a/src/target.ts',
            '--- a/packages/a/src/target.ts',
            '+++ b/packages/a/src/target.ts',
            '@@ -1,1 +1,1 @@',
            '-export const value = 1;',
            '+export const value = 2;',
            'END_DIFF'
       ].join('\n');
       response = diff;
  } else if (input.includes('FAILURE_GOAL')) {
      response = `
BEGIN_DIFF
invalid diff content
END_DIFF
`;
  }

  process.stdout.write(response + '\n' + promptMarker);
});
