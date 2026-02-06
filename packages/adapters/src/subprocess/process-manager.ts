import * as pty from 'node-pty';
import { spawn as spawnChild, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  Logger,
  SubprocessSpawned,
  SubprocessOutputChunked,
  SubprocessExited,
  ProviderError,
  stripAnsi,
  redactForLogs,
} from '@orchestrator/shared';

export interface ProcessManagerOptions {
  cwd?: string;
  env?: Record<string, string>;
  pty?: boolean;
  timeoutMs?: number; // Max duration for the process
  maxOutputSize?: number; // Max bytes to buffer/allow
  logger?: Logger;
  runId?: string; // For event tagging
  envAllowlist?: string[];
}

export interface ProcessOutput {
  type: 'stdout' | 'stderr';
  chunk: string;
}

export class ProcessManager extends EventEmitter {
  private ptyProcess?: pty.IPty;
  private childProcess?: ChildProcess;
  private buffer: string = '';
  private outputSize = 0;
  private isPty = false;
  private killed = false;
  private timeoutTimer?: NodeJS.Timeout;
  private logger?: Logger;
  private runId?: string;
  private pid?: number;
  private startTime = 0;

  constructor(private readonly options: ProcessManagerOptions = {}) {
    super();
    this.logger = options.logger;
    this.runId = options.runId || 'unknown';
  }

  public get isRunning(): boolean {
    return !this.killed;
  }

  clearBuffer(): void {
    this.buffer = '';
  }

  endInput(): void {
    if (this.killed) return;
    if (this.isPty) return;

    if (this.childProcess?.stdin) {
      this.childProcess.stdin.end();
    }
  }

  async spawn(
    command: string[],
    cwd: string,
    env: Record<string, string>,
    usePty: boolean,
  ): Promise<void> {
    if (this.ptyProcess || this.childProcess) {
      throw new ProviderError('Process already running');
    }

    this.isPty = usePty;
    this.startTime = Date.now();
    const cmd = command[0];
    const args = command.slice(1);

    // Create a new environment for the subprocess, isolating it from the main process.
    const finalEnv: Record<string, string> = { ...env };

    // Always pass through PATH so the subprocess can resolve binaries like `node`.
    const processPath = process.env.PATH ?? process.env.Path;
    if (processPath && finalEnv.PATH === undefined && finalEnv.Path === undefined) {
      finalEnv.PATH = processPath;
    }

    // Pass through a minimal set of non-secret environment variables that many CLIs rely on
    // for config and credential discovery.
    const baselineEnvKeys = [
      'HOME',
      'USER',
      'LOGNAME',
      'SHELL',
      'TERM',
      'COLORTERM',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'TMPDIR',
      'TMP',
      'TEMP',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_DATA_HOME',
    ];
    for (const key of baselineEnvKeys) {
      if (finalEnv[key] === undefined && process.env[key] !== undefined) {
        finalEnv[key] = process.env[key] as string;
      }
    }

    // Explicitly add whitelisted environment variables from the current process.
    if (this.options.envAllowlist) {
      for (const key of this.options.envAllowlist) {
        if (process.env[key] !== undefined) {
          finalEnv[key] = process.env[key] as string;
        }
      }
    }

    // Ensure all environment variables are strings.
    const sanitizedEnv: Record<string, string> = {};
    for (const key in finalEnv) {
      const val = finalEnv[key];
      if (val !== undefined) {
        sanitizedEnv[key] = String(val);
      }
    }

    if (this.isPty) {
      try {
        this.ptyProcess = pty.spawn(cmd, args, {
          name: 'xterm-color',
          cols: 80,
          rows: 30,
          cwd,
          env: sanitizedEnv,
        });
      } catch (e) {
        const err = e as Error;
        const hint =
          `PTY spawn failed (${err.message}). ` +
          `Try setting pty=false, or use a Node LTS release (Node ${process.version} may be incompatible with node-pty).`;
        throw new ProviderError(hint);
      }
      this.pid = this.ptyProcess.pid;

      this.ptyProcess.onData((data) => this.handleOutput(data, 'stdout'));
      this.ptyProcess.onExit((e) => this.handleExit(e.exitCode, e.signal ?? null));
    } else {
      this.childProcess = spawnChild(cmd, args, {
        cwd,
        env: sanitizedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.pid = this.childProcess.pid;

      // Writing to stdin can race with process exit and may produce EPIPE.
      // Attach an error handler to avoid uncaught exceptions.
      if (this.childProcess.stdin) {
        this.childProcess.stdin.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EPIPE') {
            return;
          }
          this.emit('error', err);
        });
      }

      if (this.childProcess.stdout) {
        this.childProcess.stdout.setEncoding('utf8');
        this.childProcess.stdout.on('data', (data) => this.handleOutput(data.toString(), 'stdout'));
      }
      if (this.childProcess.stderr) {
        this.childProcess.stderr.setEncoding('utf8');
        this.childProcess.stderr.on('data', (data) => this.handleOutput(data.toString(), 'stderr'));
      }

      this.childProcess.on('close', (code, signal) => this.handleExit(code, signal));
      this.childProcess.on('error', (err) => {
        this.emit('error', err);
        // Ensure we clean up if spawn failed
        this.handleExit(1, null, err.message);
      });
    }

    // Start timeout
    if (this.options.timeoutMs) {
      this.timeoutTimer = setTimeout(() => {
        this.kill('SIGTERM'); // Try graceful first? Or SIGKILL?
        this.emit('timeout');
        // We might want to construct a specific error event
      }, this.options.timeoutMs);
    }

    // Emit Spawned Event
    // We emit internal events that the adapter can translate to Orchestrator events
    this.emit('spawned', {
      command,
      cwd,
      pid: this.pid,
      pty: this.isPty,
    });

    if (this.logger && this.pid) {
      const event: SubprocessSpawned = {
        type: 'SubprocessSpawned',
        runId: this.runId || '',
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          command,
          cwd,
          pid: this.pid,
          pty: this.isPty,
        },
      };
      this.logger.log(event);
    }
  }

  write(input: string): void {
    if (this.killed) return; // Or throw?

    if (this.isPty && this.ptyProcess) {
      this.ptyProcess.write(input);
    } else if (this.childProcess && this.childProcess.stdin) {
      this.childProcess.stdin.write(input);
    } else {
      throw new ProviderError('Process not running');
    }
  }

  async readUntil(predicate: (text: string) => boolean, timeoutMs: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check immediately in case we already have it
      if (predicate(this.buffer)) {
        const matched = this.buffer;
        this.buffer = ''; // Consume buffer
        resolve(matched);
        return;
      }

      // eslint-disable-next-line prefer-const
      let timer: NodeJS.Timeout;

      const cleanup = () => {
        this.off('output', check);
        this.off('exit', onExit);
        if (timer) clearTimeout(timer);
      };

      const check = () => {
        if (predicate(this.buffer)) {
          cleanup();
          const matched = this.buffer;
          this.buffer = ''; // Consume buffer
          resolve(matched);
        }
      };

      const onExit = () => {
        cleanup();
        reject(new ProviderError('Process exited while waiting'));
      };

      this.on('output', check);
      this.on('exit', onExit);

      timer = setTimeout(() => {
        cleanup();
        reject(new ProviderError(`readUntil timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  async readUntilHeuristic(
    silenceDurationMs: number,
    predicate: (text: string) => boolean,
    timeoutMs: number = 30000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let silenceTimer: NodeJS.Timeout;
      // eslint-disable-next-line prefer-const
      let totalTimeoutTimer: NodeJS.Timeout;

      const cleanup = () => {
        this.off('output', onOutput);
        this.off('exit', onExit);
        if (silenceTimer) clearTimeout(silenceTimer);
        if (totalTimeoutTimer) clearTimeout(totalTimeoutTimer);
      };

      const check = () => {
        if (predicate(this.buffer)) {
          cleanup();
          const matched = this.buffer;
          this.buffer = '';
          resolve(matched);
        }
      };

      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(check, silenceDurationMs);
      };

      const onOutput = () => {
        resetSilenceTimer();
        check();
      };

      const onExit = () => {
        cleanup();
        const matched = this.buffer;
        this.buffer = '';
        resolve(matched);
      };

      this.on('output', onOutput);
      this.on('exit', onExit);

      resetSilenceTimer();

      totalTimeoutTimer = setTimeout(() => {
        cleanup();
        reject(new ProviderError(`readUntilHeuristic timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  // Basic stream interface
  async *readStream(): AsyncGenerator<ProcessOutput, void, unknown> {
    const queue: ProcessOutput[] = [];
    let resolveNext: (() => void) | null = null;
    let finished = false;
    let error: Error | null = null;

    const onData = (chunk: string, type: 'stdout' | 'stderr') => {
      queue.push({ type, chunk });
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    const onExit = (e: { error?: string }) => {
      finished = true;
      if (e.error) error = new Error(e.error);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    this.on('output', onData);
    this.on('exit', onExit);

    try {
      while (!finished || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          if (finished) {
            if (error) throw error;
            break;
          }
          await new Promise<void>((r) => (resolveNext = r));
        }
      }
    } finally {
      this.off('output', onData);
      this.off('exit', onExit);
    }
  }

  kill(signal: string = 'SIGTERM'): void {
    if (this.killed) return;
    this.killed = true;

    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);

    if (this.isPty && this.ptyProcess) {
      try {
        this.ptyProcess.kill(signal);
      } catch (err) {
        // Debug-level intentional: low-severity, no structured event needed
        this.logger?.debug(
          `PTY kill (signal=${signal}, pid=${this.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (this.childProcess) {
      this.childProcess.kill(signal as NodeJS.Signals);
    }
  }

  private handleOutput(chunk: string, stream: 'stdout' | 'stderr') {
    const cleanChunk = stripAnsi(chunk);

    if (
      this.options.maxOutputSize &&
      this.outputSize + cleanChunk.length > this.options.maxOutputSize
    ) {
      this.kill('SIGKILL');
      this.emit(
        'error',
        new ProviderError(`Max output size ${this.options.maxOutputSize} exceeded`),
      );
      return;
    }

    this.outputSize += cleanChunk.length;
    this.buffer += cleanChunk;

    // Emit internal event for readStream and others
    this.emit('output', cleanChunk, stream);

    if (this.logger && this.pid) {
      const event: SubprocessOutputChunked = {
        type: 'SubprocessOutputChunked',
        runId: this.runId || '',
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          pid: this.pid,
          stream,
          chunk: redactForLogs(cleanChunk) as string,
        },
      };
      this.logger.log(event);
    }
  }

  private handleExit(code: number | null, signal: string | number | null, errorMsg?: string) {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.killed = true;

    const durationMs = Date.now() - this.startTime;

    this.emit('exit', {
      code,
      signal,
      durationMs,
      error: errorMsg,
    });

    if (this.logger && this.pid) {
      const event: SubprocessExited = {
        type: 'SubprocessExited',
        runId: this.runId || '',
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          pid: this.pid,
          exitCode: code,
          signal: signal,
          durationMs,
          error: errorMsg,
        },
      };
      this.logger.log(event);
    }
  }
}
