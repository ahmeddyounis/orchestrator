/* eslint-disable @typescript-eslint/no-require-imports */
const readline = require('readline');

console.log('Echo CLI Started');
process.stdout.write('> ');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === 'exit') {
    process.exit(0);
  }
  // Delay slightly to simulate processing
  setTimeout(() => {
    console.log(`Echo: ${line}`);
    process.stdout.write('> ');
  }, 10);
});
