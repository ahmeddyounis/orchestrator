'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.FailureSummarizer = void 0;
const fs_1 = __importDefault(require('fs'));
class FailureSummarizer {
  async summarize(checks) {
    const failedChecks = checks.filter((c) => !c.passed);
    const summaries = [];
    const suspectedFiles = new Set();
    const suggestedNextActions = [];
    for (const check of failedChecks) {
      const summary = await this.summarizeCheck(check);
      summaries.push(summary);
      // Extract files from key errors and snippet
      this.extractFiles(summary.keyErrors.join('\n'), suspectedFiles);
      this.extractFiles(summary.stderrTailSnippet, suspectedFiles);
      // Heuristic actions
      if (check.name.includes('lint')) {
        suggestedNextActions.push('Fix lint errors in the suspected files.');
      } else if (check.name.includes('typecheck') || check.name.includes('tsc')) {
        suggestedNextActions.push('Fix TypeScript type errors in the suspected files.');
      } else if (check.name.includes('test')) {
        suggestedNextActions.push('Fix failing tests. Check stack traces in logs.');
      }
    }
    return {
      failedChecks: summaries,
      suspectedFiles: Array.from(suspectedFiles).sort(),
      suggestedNextActions: Array.from(new Set(suggestedNextActions)),
    };
  }
  async summarizeCheck(check) {
    let stderrContent = '';
    // Prioritize stderr, fallback to stdout if stderr is empty (common in some tools)
    if (check.stderrPath && fs_1.default.existsSync(check.stderrPath)) {
      stderrContent = await fs_1.default.promises.readFile(check.stderrPath, 'utf8');
    }
    if (!stderrContent && check.stdoutPath && fs_1.default.existsSync(check.stdoutPath)) {
      stderrContent = await fs_1.default.promises.readFile(check.stdoutPath, 'utf8');
    }
    const keyErrors = this.extractKeyErrors(stderrContent);
    const stderrTailSnippet = stderrContent.slice(-2048); // Last 2KB
    return {
      name: check.name,
      exitCode: check.exitCode,
      keyErrors,
      stderrTailSnippet,
    };
  }
  extractKeyErrors(output) {
    if (!output) return [];
    const lines = output.split('\n');
    const errors = [];
    // Heuristic: Keep lines that look like errors
    // Limit to top 10 relevant lines to avoid noise
    let count = 0;
    for (const line of lines) {
      if (count >= 10) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Common error patterns
      if (
        trimmed.includes('Error:') ||
        trimmed.includes('error TS') ||
        /^\s*at\s+/.test(line) || // Stack trace
        /Error\s*:/.test(line) ||
        line.includes('FAIL') ||
        line.includes('FAILED')
      ) {
        errors.push(trimmed);
        count++;
      }
    }
    // If no specific patterns found, take the last few non-empty lines as they often contain the summary
    if (errors.length === 0) {
      const nonEmpty = lines.filter((l) => l.trim().length > 0);
      return nonEmpty.slice(-5);
    }
    return errors;
  }
  extractFiles(text, collection) {
    if (!text) return;
    // Regex for common file paths
    // TS/Lint: path/to/file.ts(10,20)
    // Stack trace: (path/to/file.ts:10:20)
    const filePatterns = [
      new RegExp('([a-zA-Z0-9_\\-/.]+\\.(ts|tsx|js|jsx|json|md)):\\d+', 'g'), // path/to/file.ts:10
      new RegExp('([a-zA-Z0-9_\\-/.]+\\.(ts|tsx|js|jsx|json|md))\\(\\d+', 'g'), // path/to/file.ts(10
    ];
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        // Validate if it looks like a project file (simple heuristic)
        const fpath = match[1];
        if (!fpath.includes('node_modules')) {
          collection.add(fpath);
        }
      }
    }
  }
}
exports.FailureSummarizer = FailureSummarizer;
//# sourceMappingURL=summarizer.js.map
