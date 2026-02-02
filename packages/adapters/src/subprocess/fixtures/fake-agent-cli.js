#!/usr/bin/env node

process.stdin.setEncoding('utf8');

const argv = process.argv.slice(2);
const slow = argv.includes('--slow');
const noEndMarker = argv.includes('--no-end-marker');
const large = argv.includes('--large');

function prompt() {
  process.stdout.write('> ');
}

console.log('Fake Agent CLI Started');
prompt();

let buffer = '';

function handleLine(line) {
  if (large) {
    // Emit enough output to exceed ProcessManager maxOutputSize (50 * 1024 in tests).
    process.stdout.write('A'.repeat(60 * 1024));
    return;
  }

  process.stdout.write(`You said: ${line}\n`);

  if (!noEndMarker) {
    prompt();
  }
}

process.stdin.on('data', (chunk) => {
  buffer += chunk;

  while (true) {
    const idx = buffer.indexOf('\n');
    if (idx === -1) return;

    const line = buffer.slice(0, idx).replace(/\r$/, '');
    buffer = buffer.slice(idx + 1);

    if (slow) {
      setTimeout(() => handleLine(line), 2000);
    } else {
      handleLine(line);
    }
  }
});
