'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, '__esModule', { value: true });
exports.ProcessManager = void 0;
const pty = __importStar(require('node-pty'));
const child_process_1 = require('child_process');
const events_1 = require('events');
class ProcessManager extends events_1.EventEmitter {
  options;
  ptyProcess;
  childProcess;
  buffer = '';
  outputSize = 0;
  isPty = false;
  killed = false;
  timeoutTimer;
  logger;
  runId;
  pid;
  startTime = 0;
  constructor(options = {}) {
    super();
    this.options = options;
    this.logger = options.logger;
    this.runId = options.runId || 'unknown';
  }
  get isRunning() {
    return !this.killed;
  }
  async spawn(command, cwd, env, usePty, inheritEnv = true) {
    if (this.ptyProcess || this.childProcess) {
      throw new Error('Process already running');
    }
    this.isPty = usePty;
    this.startTime = Date.now();
    const cmd = command[0];
    const args = command.slice(1);
    // Ensure env has basic PATH if not provided or merged
    const rawEnv = inheritEnv ? { ...process.env, ...env } : env;
    const sanitizedEnv = {};
    for (const key in rawEnv) {
      const val = rawEnv[key];
      if (val !== undefined) {
        sanitizedEnv[key] = String(val);
      }
    }
    if (this.isPty) {
      this.ptyProcess = pty.spawn(cmd, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd,
        env: sanitizedEnv,
      });
      this.pid = this.ptyProcess.pid;
      this.ptyProcess.onData((data) => this.handleOutput(data, 'stdout'));
      this.ptyProcess.onExit((e) => this.handleExit(e.exitCode, e.signal ?? null));
    } else {
      this.childProcess = (0, child_process_1.spawn)(cmd, args, {
        cwd,
        env: sanitizedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.pid = this.childProcess.pid;
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
      const event = {
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
  write(input) {
    if (this.killed) return; // Or throw?
    if (this.isPty && this.ptyProcess) {
      this.ptyProcess.write(input);
    } else if (this.childProcess && this.childProcess.stdin) {
      this.childProcess.stdin.write(input);
    } else {
      throw new Error('Process not running');
    }
  }
  async readUntil(predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      // Check immediately in case we already have it
      if (predicate(this.buffer)) {
        const matched = this.buffer;
        this.buffer = ''; // Consume buffer
        resolve(matched);
        return;
      }
      // eslint-disable-next-line prefer-const
      let timer;
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
        reject(new Error('Process exited while waiting'));
      };
      this.on('output', check);
      this.on('exit', onExit);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`readUntil timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
  async readUntilHeuristic(silenceDurationMs, predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      let silenceTimer;
      // eslint-disable-next-line prefer-const
      let totalTimeoutTimer;
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
        reject(new Error(`readUntilHeuristic timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
  // Basic stream interface
  async *readStream() {
    const queue = [];
    let resolveNext = null;
    let finished = false;
    let error = null;
    const onData = (chunk, type) => {
      queue.push({ type, chunk });
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };
    const onExit = (e) => {
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
          yield queue.shift();
        } else {
          if (finished) {
            if (error) throw error;
            break;
          }
          await new Promise((r) => (resolveNext = r));
        }
      }
    } finally {
      this.off('output', onData);
      this.off('exit', onExit);
    }
  }
  kill(signal = 'SIGTERM') {
    if (this.killed) return;
    this.killed = true;
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.isPty && this.ptyProcess) {
      try {
        this.ptyProcess.kill(signal);
      } catch {
        // ignore if already dead
      }
    } else if (this.childProcess) {
      this.childProcess.kill(signal);
    }
  }
  handleOutput(chunk, stream) {
    if (this.options.maxOutputSize && this.outputSize + chunk.length > this.options.maxOutputSize) {
      this.kill('SIGKILL');
      this.emit('error', new Error(`Max output size ${this.options.maxOutputSize} exceeded`));
      return;
    }
    this.outputSize += chunk.length;
    this.buffer += chunk;
    // Emit internal event for readStream and others
    this.emit('output', chunk, stream);
    if (this.logger && this.pid) {
      const event = {
        type: 'SubprocessOutputChunked',
        runId: this.runId || '',
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          pid: this.pid,
          stream,
          chunk,
        },
      };
      this.logger.log(event);
    }
  }
  handleExit(code, signal, errorMsg) {
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
      const event = {
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
exports.ProcessManager = ProcessManager;
//# sourceMappingURL=process-manager.js.map
