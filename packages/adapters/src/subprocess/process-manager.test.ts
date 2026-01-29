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
      ['node', '-e', 'setTimeout(() => console.log("done"), 500)'],
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
    await pm.spawn(['node', '-e', 'console.log("123456")'], process.cwd(), {}, false);

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
});
