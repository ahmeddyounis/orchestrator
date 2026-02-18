import { describe, it, expect } from 'vitest';
import { parseCommand } from './parser';
import { classifyCommand, matchesDenylist, matchesAllowlist } from './classifier';

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
    ['pnpm run something-else', 'unknown'],
    ['tsc', 'build'],
    ['vitest', 'test'],
    ['eslint .', 'lint'],
    ['prettier .', 'format'],
    ['echo hello', 'unknown'],
    ['ls -la', 'unknown'],
    ['npm help', 'unknown'],
    ['./scripts/test.sh', 'test'],
    ['./scripts/setup.sh', 'unknown'],
    ['./scripts/test-runner.js', 'test'],
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
  it('treats patterns as literal strings, not regex', () => {
    // After escaping, "rm .* /" matches only the literal string "rm .* /", not "rm -rf /"
    expect(matchesDenylist('rm -rf /', ['rm .* /'])).toBe(false);
    expect(matchesDenylist('rm .* / something', ['rm .* /'])).toBe(true);
  });
  it('does not match safe commands', () => {
    expect(matchesDenylist('ls -la', ['rm .*'])).toBe(false);
  });

  describe('escapes special regex characters in patterns', () => {
    it('escapes dots – pattern "node.js" should not match "nodexjs"', () => {
      expect(matchesDenylist('nodexjs build', ['node.js'])).toBe(false);
    });
    it('matches literal dot – pattern "node.js" matches "node.js"', () => {
      expect(matchesDenylist('node.js build', ['node.js'])).toBe(true);
    });
    it('escapes parentheses – pattern "cmd(1)" matches literally', () => {
      expect(matchesDenylist('cmd(1) --help', ['cmd(1)'])).toBe(true);
    });
    it('parentheses do not act as capture groups', () => {
      expect(matchesDenylist('cmd1 --help', ['cmd(1)'])).toBe(false);
    });
    it('escapes square brackets – pattern "[test]" matches literally', () => {
      expect(matchesDenylist('[test] run', ['[test]'])).toBe(true);
    });
    it('square brackets do not act as character classes', () => {
      expect(matchesDenylist('t run', ['[test]'])).toBe(false);
    });
    it('escapes plus – pattern "c++" matches literally', () => {
      expect(matchesDenylist('c++ compile', ['c++'])).toBe(true);
    });
    it('plus does not act as quantifier', () => {
      expect(matchesDenylist('ccccc compile', ['c++'])).toBe(false);
    });
    it('escapes pipe – pattern "a|b" matches literally', () => {
      expect(matchesDenylist('a|b run', ['a|b'])).toBe(true);
    });
    it('pipe does not act as alternation', () => {
      // Without escaping, /a|b/ would match bare "b"
      expect(matchesDenylist('b run', ['a|b'])).toBe(false);
    });
    it('escapes curly braces – pattern "x{2}" matches literally', () => {
      expect(matchesDenylist('x{2} run', ['x{2}'])).toBe(true);
    });
    it('curly braces do not act as quantifiers', () => {
      expect(matchesDenylist('xx run', ['x{2}'])).toBe(false);
    });
    it('escapes caret and dollar – pattern "^start$" matches literally', () => {
      expect(matchesDenylist('^start$ run', ['^start$'])).toBe(true);
    });
    it('caret/dollar do not act as anchors', () => {
      expect(matchesDenylist('start run', ['^start$'])).toBe(false);
    });
    it('escapes question mark – pattern "file?.txt" matches literally', () => {
      expect(matchesDenylist('file?.txt run', ['file?.txt'])).toBe(true);
    });
    it('question mark does not act as optional quantifier', () => {
      expect(matchesDenylist('filetxt run', ['file?.txt'])).toBe(false);
    });
  });

  it('does not hang on pathological ReDoS patterns', () => {
    const evilPattern = 'a' + ']'.repeat(50);
    const start = performance.now();
    // Should return quickly regardless of pattern content
    const result = matchesDenylist('a]]]]]]] harmless', [evilPattern]);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000); // must finish well under 1 second
    expect(typeof result).toBe('boolean');
  });

  describe('handles patterns that would be invalid regex without escaping', () => {
    it('unclosed bracket "[abc" matches literally', () => {
      expect(matchesDenylist('[abc run', ['[abc'])).toBe(true);
    });
    it('unclosed bracket "[abc" does not match "a"', () => {
      // Without escaping, /[abc/ would throw; raw char-class would match "a"
      expect(matchesDenylist('a run', ['[abc'])).toBe(false);
    });
    it('unclosed paren "(foo" matches literally', () => {
      expect(matchesDenylist('(foo run', ['(foo'])).toBe(true);
    });
    it('unclosed paren "(foo" does not match "foo"', () => {
      expect(matchesDenylist('foo run', ['(foo'])).toBe(false);
    });
    it('trailing backslash "foo\\" matches literally', () => {
      expect(matchesDenylist('foo\\ run', ['foo\\'])).toBe(true);
    });
    it('unmatched curly "x{" matches literally', () => {
      expect(matchesDenylist('x{ run', ['x{'])).toBe(true);
    });
    it('mixed invalid regex "([" matches literally', () => {
      expect(matchesDenylist('([ run', ['(['])).toBe(true);
    });
  });

  describe('resilient to adversarial ReDoS input strings', () => {
    it('handles classic (a+)+$ pattern with long input under 1s', () => {
      const pattern = '(a+)+$';
      const adversarialInput = 'a'.repeat(50000) + '!';
      const start = performance.now();
      const result = matchesDenylist(adversarialInput, [pattern]);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000);
      // The pattern is escaped, so it matches literal "(a+)+$", not the input
      expect(result).toBe(false);
    });

    it('handles (a|a)*$ pattern with long input under 1s', () => {
      const pattern = '(a|a)*$';
      const adversarialInput = 'a'.repeat(50000) + '!';
      const start = performance.now();
      const result = matchesDenylist(adversarialInput, [pattern]);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000);
      expect(result).toBe(false);
    });

    it('handles (a+){10}$ pattern with long input under 1s', () => {
      const pattern = '(a+){10}$';
      const adversarialInput = 'a'.repeat(50000) + '!';
      const start = performance.now();
      const result = matchesDenylist(adversarialInput, [pattern]);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000);
      expect(result).toBe(false);
    });

    it('handles nested quantifier ([a-z]+)*$ with long input under 1s', () => {
      const pattern = '([a-z]+)*$';
      const adversarialInput = 'a'.repeat(50000) + '!';
      const start = performance.now();
      const result = matchesDenylist(adversarialInput, [pattern]);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000);
      expect(result).toBe(false);
    });
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
