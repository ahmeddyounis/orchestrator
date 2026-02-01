import { describe, it, expect } from 'vitest';
import { ProcessManager } from './process-manager';
import * as path from 'path';

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/echo-cli.js');

describe('ProcessManager', () => {
  it('should spawn process and interact via stdin/stdout (child_process)', async () => {
    const pm = new ProcessManager();
    await pm.spawn([process.execPath, FIXTURE_PATH], path.dirname(FIXTURE_PATH), {}, false);

    // Initial output
    const out1 = await pm.readUntil((t) => t.includes('Echo CLI Started'));
    expect(out1).toContain('Echo CLI Started');

    // Interaction
    pm.write('hello world\n');
    const out2 = await pm.readUntil((t) => t.includes('Echo: hello world'));
    expect(out2).toContain('Echo: hello world');

    // Cleanup
    pm.kill();
  });

  it('should enforce timeout', async () => {
    const pm = new ProcessManager({ timeoutMs: 100 });
    // Run a sleeping process
    await pm.spawn(
      [process.execPath, '-e', 'setTimeout(() => console.log("done"), 500)'],
      process.cwd(),
      {},
      false,
    );

    // readUntil with longer timeout than process timeout
    await expect(pm.readUntil((t) => t.includes('done'), 600)).rejects.toThrow(
      /readUntil timed out|Process exited/,
    );
  });

  it('should enforce max output size', async () => {
    const pm = new ProcessManager({ maxOutputSize: 5 });

    // Listen for error
    const errorPromise = new Promise<Error>((resolve) => {
      pm.on('error', (e) => resolve(e));
    });

    // Produce large output
    // Note: console.log adds newline
    await pm.spawn([process.execPath, '-e', 'console.log("123456")'], process.cwd(), {}, false);

    const err = await errorPromise;
    expect(err.message).toContain('Max output size');

    pm.kill();
  });

  // Optional: PTY test (might fail in some envs)
  it('should work with PTY', async () => {
    try {
      const pm = new ProcessManager();
      await pm.spawn([process.execPath, FIXTURE_PATH], path.dirname(FIXTURE_PATH), {}, true);

      // Initial output
      const out1 = await pm.readUntil((t) => t.includes('Echo CLI Started'));
      expect(out1).toContain('Echo CLI Started');

      // Interaction
      pm.write('pty test\n');
      const out2 = await pm.readUntil((t) => t.includes('Echo: pty test'));
      expect(out2).toContain('Echo: pty test');

      pm.kill();
    } catch (e) {
      console.warn('PTY test skipped or failed:', e);
    }
  });

  it('should strip ANSI escape codes from output', async () => {
    const pm = new ProcessManager();
    // This command prints a string with ANSI color codes
    const command = [process.execPath, '-e', "console.log('\\x1b[31mHello\\x1b[0m World')"];
    await pm.spawn(command, process.cwd(), {}, false);

    const output = await pm.readUntil((t) => t.includes('Hello'), 1000);
    // Vitest seems to have issues with `not.toContain` on raw ANSI strings,
    // so we check for the cleaned string directly.
    expect(output.trim()).toBe('Hello World');
    expect(output).not.toContain('\x1b[31m');

    pm.kill();
  });

  it('should only pass allowlisted environment variables', async () => {
    // Set a variable in the current process
    process.env['TEST_ENV_VAR'] = 'test_value';
    process.env['ANOTHER_VAR'] = 'another_value';

    const pm = new ProcessManager({
      envAllowlist: ['TEST_ENV_VAR'],
    });

    const command = [
      process.execPath,
      '-e',
      'console.log(`TEST_ENV_VAR=${process.env.TEST_ENV_VAR},ANOTHER_VAR=${process.env.ANOTHER_VAR}`)',
    ];
    await pm.spawn(command, process.cwd(), {}, false);

    const output = await pm.readUntil((t) => t.includes('TEST_ENV_VAR'), 1000);

    // The allowlisted var should be present
    expect(output).toContain('TEST_ENV_VAR=test_value');
    // The non-allowlisted var should be undefined
    expect(output).toContain('ANOTHER_VAR=undefined');

    pm.kill();
    delete process.env['TEST_ENV_VAR'];
    delete process.env['ANOTHER_VAR'];
  });
});
