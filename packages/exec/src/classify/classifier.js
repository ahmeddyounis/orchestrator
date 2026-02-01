'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.matchesDenylist = matchesDenylist;
exports.matchesAllowlist = matchesAllowlist;
exports.classifyCommand = classifyCommand;
function matchesDenylist(raw, patterns) {
  return patterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern);
      return regex.test(raw);
    } catch {
      // Fallback to substring check if regex is invalid
      return raw.includes(pattern);
    }
  });
}
function matchesAllowlist(raw, prefixes) {
  return prefixes.some((prefix) => raw.startsWith(prefix));
}
function classifyCommand(parsed) {
  const { bin, args } = parsed;
  // Extract base binary name (e.g. /usr/bin/rm -> rm)
  const baseBin = bin.split('/').pop() || bin;
  // Destructive
  const destructiveBins = ['rm', 'dd', 'mkfs', 'shutdown', 'reboot'];
  if (destructiveBins.includes(baseBin) || baseBin.startsWith('mkfs.')) {
    return { category: 'destructive' };
  }
  if (baseBin === 'mv') {
    // Check if moving to root /
    const dest = args[args.length - 1];
    if (dest === '/') {
      return { category: 'destructive', reason: 'Move to root' };
    }
  }
  if (baseBin === 'chmod') {
    // Check for -R 777
    const hasR = args.some((a) => a.startsWith('-') && a.includes('R'));
    const has777 = args.includes('777');
    if (hasR && has777) {
      return { category: 'destructive', reason: 'Unsafe permission change' };
    }
  }
  // Network
  const networkBins = ['curl', 'wget', 'ssh', 'scp'];
  if (networkBins.includes(baseBin)) {
    return { category: 'network' };
  }
  if (baseBin === 'git') {
    const sub = args[0];
    if (['clone', 'fetch', 'pull', 'push', 'remote'].includes(sub)) {
      return { category: 'network' };
    }
  }
  // Install
  const pkgManagers = ['npm', 'pnpm', 'yarn', 'bun'];
  if (pkgManagers.includes(baseBin)) {
    const sub = args[0];
    if (['install', 'i', 'add'].includes(sub)) {
      return { category: 'install' };
    }
    // Check for test/build/format/lint via script
    let scriptName = '';
    if (sub === 'run' && args.length > 1) {
      scriptName = args[1];
    } else if (
      sub &&
      !['install', 'i', 'add', 'remove', 'uninstall', 'init', 'create'].includes(sub)
    ) {
      // e.g. pnpm test
      scriptName = sub;
    }
    if (scriptName) {
      if (scriptName.includes('test')) return { category: 'test' };
      if (scriptName.includes('build')) return { category: 'build' };
      if (scriptName.includes('format')) return { category: 'format' };
      if (scriptName.includes('lint')) return { category: 'lint' };
    }
  }
  // Direct script calls (e.g. "vitest", "tsc", "eslint", "prettier")
  if (
    baseBin.includes('test') ||
    baseBin === 'vitest' ||
    baseBin === 'jest' ||
    baseBin === 'mocha'
  ) {
    return { category: 'test' };
  }
  if (
    baseBin.includes('build') ||
    baseBin === 'tsc' ||
    baseBin === 'webpack' ||
    baseBin === 'vite'
  ) {
    return { category: 'build' };
  }
  if (baseBin.includes('lint') || baseBin === 'eslint') {
    return { category: 'lint' };
  }
  if (baseBin.includes('format') || baseBin === 'prettier') {
    return { category: 'format' };
  }
  return { category: 'unknown' };
}
//# sourceMappingURL=classifier.js.map
