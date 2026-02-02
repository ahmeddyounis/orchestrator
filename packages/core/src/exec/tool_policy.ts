import type { ToolPolicy } from '@orchestrator/shared';

export function denyAllToolPolicy(): ToolPolicy {
  return {
    enabled: false,
    requireConfirmation: true,
    allowlistPrefixes: [],
    denylistPatterns: [],
    networkPolicy: 'deny',
    envAllowlist: [],
    allowShell: false,
    maxOutputBytes: 0,
    timeoutMs: 0,
    autoApprove: false,
    interactive: false,
  };
}

export function allowAllToolPolicy(): ToolPolicy {
  return {
    enabled: true,
    requireConfirmation: false,
    allowlistPrefixes: [],
    denylistPatterns: [],
    networkPolicy: 'allow',
    envAllowlist: [],
    allowShell: true,
    maxOutputBytes: 1024 * 1024,
    timeoutMs: 600_000,
    autoApprove: true,
    interactive: true,
  };
}
