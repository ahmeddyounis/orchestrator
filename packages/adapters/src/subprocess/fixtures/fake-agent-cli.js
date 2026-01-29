#!/usr/bin/env node

const args = process.argv.slice(2);
const isSlow = args.includes('--slow');
const isLarge = args.includes('--large');
const noEndMarker = args.includes('--no-end-marker');
const promptMarker = '> ';

// Initial prompt
process.stdout.write('Welcome to Fake CLI\n' + promptMarker);

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  const input = chunk.toString().trim();
  if (!input) return;

  const respond = () => {
    process.stdout.write(`You said: ${input}\n`);

    if (isLarge) {
      // Output ~100KB
      const chunk = 'X'.repeat(1024);
      for (let i = 0; i < 100; i++) {
        process.stdout.write(chunk);
      }
      process.stdout.write('\n');
    }

    if (!noEndMarker) {
      process.stdout.write(promptMarker);
    }
  };

  if (isSlow) {
    setTimeout(respond, 2000);
  } else {
    respond();
  }
});
