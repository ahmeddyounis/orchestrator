#!/usr/bin/env node

process.stdin.setEncoding('utf8');

function prompt() {
  process.stdout.write('> ');
}

console.log('Echo CLI Started');
prompt();

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk;

  while (true) {
    const idx = buffer.indexOf('\n');
    if (idx === -1) return;

    const line = buffer.slice(0, idx).replace(/\r$/, '');
    buffer = buffer.slice(idx + 1);

    if (line.trim() === '') {
      prompt();
      continue;
    }

    process.stdout.write(`Echo: ${line}\n`);
    prompt();
  }
});
