console.log('Running for 3 seconds...');

const start = Date.now();
while (Date.now() - start < 3000) {
  // Busy wait
}

console.log('This should not be printed');