import * as path from 'path';
import { ParsedCommand, ToolClassification } from './types';

/** Escape all regex-special characters so the string can be safely interpolated into a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBin(bin: string): string {
  if (!bin) return '';
  const base = bin.replace(/\\/g, '/').split('/').pop() ?? bin;
  return base.toLowerCase().replace(/\.exe$/i, '');
}

export function classifyCommand(parsed: ParsedCommand): ToolClassification {
  const bin = normalizeBin(parsed.bin);
  const args = parsed.args.map((a) => a.trim()).filter(Boolean);

  if (!bin) return { category: 'unknown' };

  // Destructive operations
  if (bin === 'rm') return { category: 'destructive', reason: 'rm is always destructive' };
  if (bin === 'dd') return { category: 'destructive' };
  if (bin.startsWith('mkfs')) return { category: 'destructive' };
  if (bin === 'shutdown' || bin === 'reboot') return { category: 'destructive' };
  if (bin === 'chmod') {
    if (args.includes('-R') || args.includes('--recursive')) return { category: 'destructive' };
    return { category: 'unknown' };
  }
  if (bin === 'mv') {
    const dest = args.length > 0 ? args[args.length - 1] : undefined;
    return dest === '/' ? { category: 'destructive' } : { category: 'unknown' };
  }

  // Network commands
  if (bin === 'curl' || bin === 'wget' || bin === 'fetch' || bin === 'ssh' || bin === 'scp') {
    return { category: 'network' };
  }
  if (bin === 'git') {
    const sub = args[0];
    if (sub && ['clone', 'fetch', 'pull', 'push'].includes(sub)) {
      return { category: 'network' };
    }
    return { category: 'unknown' };
  }

  // Package managers
  if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn') {
    const sub = args[0] ?? '';
    const script = args[1] ?? '';

    if (sub === 'install' || sub === 'i' || sub === 'add') return { category: 'install' };
    if (sub === 'test') return { category: 'test' };
    if (sub === 'run') {
      if (script === 'test') return { category: 'test' };
      if (script === 'lint') return { category: 'lint' };
      if (script === 'format') return { category: 'format' };
      if (script === 'build' || script.startsWith('build')) return { category: 'build' };
      return { category: 'unknown' };
    }

    // Yarn (and others) can run scripts without `run`, e.g. `yarn build:prod`
    if (sub === 'lint') return { category: 'lint' };
    if (sub === 'format') return { category: 'format' };
    if (sub === 'build' || sub.startsWith('build')) return { category: 'build' };

    return { category: 'unknown' };
  }

  // Common tooling
  if (bin === 'tsc') return { category: 'build' };
  if (bin === 'vitest') return { category: 'test' };
  if (bin === 'eslint') return { category: 'lint' };
  if (bin === 'prettier') return { category: 'format' };

  // Script files
  if (bin.endsWith('.sh') || bin.endsWith('.bash')) {
    if (/test/i.test(bin)) return { category: 'test' };
    return { category: 'unknown' };
  }
  if (bin.endsWith('.js') || bin.endsWith('.mjs') || bin.endsWith('.cjs')) {
    const base = path.basename(bin).toLowerCase();
    if (base.includes('test')) return { category: 'test' };
  }

  return { category: 'unknown' };
}

export function isNetworkCommand(parsed: ParsedCommand): boolean {
  const category = classifyCommand(parsed).category;
  return category === 'network' || category === 'install';
}

export function matchesDenylist(command: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (!pattern) return false;
    try {
      // Match on token boundaries to reduce accidental partial matches
      // (e.g. deny "rm -rf /" but allow "rm -rf /tmp/safe-dir").
      return new RegExp(`(?:^|\\s)(?:${escapeRegExp(pattern)})(?:\\s|$)`).test(command);
    } catch {
      // If it's not a valid regex, fall back to substring matching.
      return command.includes(pattern);
    }
  });
}

export function matchesAllowlist(command: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => prefix && command.startsWith(prefix));
}
