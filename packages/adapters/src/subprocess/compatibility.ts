export type ParsingStrategy = 'marker' | 'fence' | 'heuristic';

export interface CompatibilityProfile {
  // Regex pattern to detect that the CLI is ready for input.
  promptDetectionPattern: RegExp;

  // Recommended time in ms to wait for prompt after initial spawn.
  // This can be longer than `promptInactivityTimeoutMs` to allow for setup.
  initialPromptTimeoutMs: number;

  // After sending input, how long to wait for a prompt marker to appear
  // while there is an active data stream.
  promptInactivityTimeoutMs: number;

  // How to parse the output to find a diff.
  // If not specified, the system will try all strategies.
  parsingStrategy?: ParsingStrategy;
}

export const DefaultCompatibilityProfile: CompatibilityProfile = {
  promptDetectionPattern: /.*(>|\$|#|%).*$/s,
  initialPromptTimeoutMs: 1500,
  promptInactivityTimeoutMs: 800,
};

export const ClaudeCodeCompatibilityProfile: CompatibilityProfile = {
  // Based on observation, Claude Code uses a fairly standard shell-like prompt
  promptDetectionPattern: /^(?:\(y, n, a, d, ...\)|\[Enter\]).*$/m,
  initialPromptTimeoutMs: 3000,
  promptInactivityTimeoutMs: 1200,
};

export const SubprocessCompatibilityProfiles = {
  default: DefaultCompatibilityProfile,
  'claude-code': ClaudeCodeCompatibilityProfile,
};
