import { describe, it, expect } from 'vitest';
import { parseCommand, classifyCommand, matchesDenylist, matchesAllowlist } from './index';

describe('parseCommand', () => {
  it('parses simple command', () => {
    expect(parseCommand('ls -la')).toEqual({
      bin: 'ls',
      args: ['-la'],
      raw: 'ls -la',
    });
  });

  it('parses command with quotes', () => {
    expect(parseCommand('echo "hello world"')).toEqual({
      bin: 'echo',
      args: ['hello world'],
      raw: 'echo "hello world"',
    });
  });

  it('parses command with env vars', () => {
    expect(parseCommand('FOO=bar echo hello')).toEqual({
      bin: 'echo',
      args: ['hello'],
      raw: 'FOO=bar echo hello',
    });
  });

  it('parses command with multiple env vars', () => {
    expect(parseCommand('A=1 B=2 node script.js')).toEqual({
      bin: 'node',
      args: ['script.js'],
      raw: 'A=1 B=2 node script.js',
    });
  });

  it('handles empty input', () => {
    expect(parseCommand('')).toEqual({
      bin: '',
      args: [],
      raw: '',
    });
  });

  it('handles only vars', () => {
    expect(parseCommand('A=1')).toEqual({
      bin: '',
      args: [],
      raw: 'A=1',
    });
  });
});

describe('classifyCommand', () => {
  const cases: [string, string][] = [
    ['rm -rf /', 'destructive'],
    ['rm file', 'destructive'],
    ['/bin/rm file', 'destructive'],
    ['dd if=/dev/zero of=/dev/null', 'destructive'],
    ['mkfs.ext4 /dev/sda1', 'destructive'],
    ['shutdown now', 'destructive'],
    ['reboot', 'destructive'],
    ['mv src /', 'destructive'],
    ['mv src dest', 'unknown'],
    ['chmod -R 777 .', 'destructive'],
    ['chmod 755 file', 'unknown'],
    ['curl https://example.com', 'network'],
    ['wget https://file', 'network'],
    ['ssh user@host', 'network'],
    ['scp file user@host:', 'network'],
    ['git clone repo', 'network'],
    ['git fetch', 'network'],
    ['git pull', 'network'],
    ['git push', 'network'],
    ['git status', 'unknown'],
    ['npm install', 'install'],
    ['pnpm i', 'install'],
    ['yarn add pkg', 'install'],
    ['npm test', 'test'],
    ['pnpm run test', 'test'],
    ['npm run build', 'build'],
    ['yarn build:prod', 'build'],
    ['npm run lint', 'lint'],
    ['pnpm format', 'format'],
    ['tsc', 'build'],
    ['vitest', 'test'],
    ['eslint .', 'lint'],
    ['prettier .', 'format'],
    ['echo hello', 'unknown'],
    ['ls -la', 'unknown'],
    ['./scripts/test.sh', 'test'],
  ];

  cases.forEach(([cmd, expectedCategory]) => {
    it(`classifies "${cmd}" as ${expectedCategory}`, () => {
      const parsed = parseCommand(cmd);
      const classification = classifyCommand(parsed);
      expect(classification.category).toBe(expectedCategory);
    });
  });
});

describe('matchesDenylist', () => {
  it('matches exact strings', () => {
    expect(matchesDenylist('rm -rf /', ['rm -rf /'])).toBe(true);
  });
  it('matches regex', () => {
    expect(matchesDenylist('rm -rf /', ['rm .* /'])).toBe(true);
  });
  it('does not match safe commands', () => {
    expect(matchesDenylist('ls -la', ['rm .*'])).toBe(false);
  });
});

describe('matchesAllowlist', () => {
  it('matches prefixes', () => {
    expect(matchesAllowlist('npm run test', ['npm run'])).toBe(true);
  });
  it('does not match other commands', () => {
    expect(matchesAllowlist('rm -rf /', ['npm run'])).toBe(false);
  });
});
