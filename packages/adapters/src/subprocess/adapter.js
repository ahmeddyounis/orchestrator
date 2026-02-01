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
exports.SubprocessProviderAdapter = void 0;
const errors_1 = require('../errors');
const process_manager_1 = require('./process-manager');
const shared_1 = require('@orchestrator/shared');
const path = __importStar(require('path'));
const fs = __importStar(require('fs/promises'));
class SubprocessProviderAdapter {
  config;
  constructor(config) {
    this.config = config;
  }
  id() {
    return 'subprocess';
  }
  capabilities() {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'slow',
    };
  }
  /**
   * Detects if a chunk of text from a subprocess indicates it is idle and waiting for a prompt.
   * Subclasses can override this to provide more specific detection logic.
   * @param text The text to inspect.
   * @returns True if the text is a prompt marker.
   */
  isPrompt(text) {
    const trimmed = text.trim();
    // Check for common prompt markers
    return (
      trimmed.endsWith('>') ||
      trimmed.endsWith('$') ||
      trimmed.endsWith('#') ||
      trimmed.endsWith('%')
    );
  }
  async generate(req, ctx) {
    const pm = new process_manager_1.ProcessManager({
      logger: ctx.logger,
      runId: ctx.runId,
      timeoutMs: ctx.timeoutMs,
    });
    const cwd = process.cwd(); // Default to process.cwd() for 'repoRoot' and 'runDir' for MVP
    // Env construction
    const env = {};
    const shouldInherit = !this.config.env;
    if (this.config.env) {
      for (const key of this.config.env) {
        if (process.env[key] !== undefined) {
          env[key] = process.env[key];
        }
      }
    }
    // Logging setup
    // Ensure we don't crash if artifacts dir setup fails or isn't there (though it should be)
    let logPath;
    try {
      const artifacts = (0, shared_1.getRunArtifactPaths)(process.cwd(), ctx.runId);
      logPath = path.join(artifacts.toolLogsDir, `subprocess_${this.id()}.log`);
    } catch {
      // Ignore if can't resolve paths
    }
    const logTranscript = async (chunk) => {
      if (logPath) {
        try {
          await fs.appendFile(logPath, chunk);
        } catch {
          // Ignore logging errors
        }
      }
    };
    // Capture output
    let outputText = '';
    pm.on('output', async (chunk) => {
      outputText += chunk;
      await logTranscript(chunk);
    });
    let timedOut = false;
    pm.on('timeout', () => {
      timedOut = true;
    });
    const isPrompt = (text) => this.isPrompt(text);
    try {
      await pm.spawn(this.config.command, cwd, env, false, shouldInherit);
      // Consume initial prompt
      await pm.readUntilHeuristic(800, isPrompt);
      // Only clear outputText if pm.isRunning after initial read
      // Non-interactive processes exit and their output is the response
      if (pm.isRunning) {
        outputText = '';
      }
      // Render prompt
      const prompt = req.messages
        .filter((m) => m.role === 'system' || m.role === 'user')
        .map((m) => m.content)
        .join('\n');
      // Send input
      // Send input with newline to ensure it's processed
      const input = prompt + '\n';
      // Log input as well? Spec says "raw transcripts". Usually includes input.
      // But process manager 'output' event only covers stdout/stderr.
      // We manually log stdin.
      await logTranscript(input);
      pm.write(input);
      // Wait for termination
      // Heuristic: 800ms silence AND prompt marker appears
      if (pm.isRunning) {
        await pm.readUntilHeuristic(800, isPrompt);
      }
      if (timedOut) {
        throw new errors_1.TimeoutError('Process timed out');
      }
      // Strip trailing prompt marker
      outputText = outputText.trim();
      if (outputText.endsWith('>')) {
        outputText = outputText.slice(0, -1).trim();
      } else if (outputText.endsWith('$') || outputText.endsWith('#') || outputText.endsWith('%')) {
        outputText = outputText.slice(0, -1).trim();
      }
    } catch (e) {
      const err = e;
      if (err instanceof errors_1.TimeoutError) {
        throw err;
      }
      throw new errors_1.ProcessError(`Subprocess execution failed: ${err.message}`);
    } finally {
      pm.kill();
    }
    return {
      text: outputText,
      usage: {
        inputTokens: outputText.length, // Placeholder
        outputTokens: outputText.length,
      },
    };
  }
}
exports.SubprocessProviderAdapter = SubprocessProviderAdapter;
//# sourceMappingURL=adapter.js.map
