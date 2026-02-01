"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubprocessCompatibilityProfiles = exports.ClaudeCodeCompatibilityProfile = exports.DefaultCompatibilityProfile = void 0;
exports.DefaultCompatibilityProfile = {
    promptDetectionPattern: /.*(>|\$|#|%).*$/s,
    initialPromptTimeoutMs: 1500,
    promptInactivityTimeoutMs: 800,
};
exports.ClaudeCodeCompatibilityProfile = {
    // Based on observation, Claude Code uses a fairly standard shell-like prompt
    promptDetectionPattern: /^(?:\(y, n, a, d, ...\)|\[Enter\]).*$/m,
    initialPromptTimeoutMs: 3000,
    promptInactivityTimeoutMs: 1200,
};
exports.SubprocessCompatibilityProfiles = {
    default: exports.DefaultCompatibilityProfile,
    'claude-code': exports.ClaudeCodeCompatibilityProfile,
};
