#!/usr/bin/env node
// This CLI waits for one line of input, then prints an env var and exits.
process.stdout.write('> '); // Initial prompt
process.stdin.once('data', () => {
  process.stdout.write(process.env.TEST_VAR || 'MISSING');
  process.stdout.write('\n> '); // Final prompt before exiting
  process.exit(0);
});

