const readline = require('readline');

console.log('Echo CLI Started');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  if (line.trim() === 'exit') {
    process.exit(0);
  }
  // Delay slightly to simulate processing
  setTimeout(() => {
    console.log(`Echo: ${line}`);
  }, 10);
});
