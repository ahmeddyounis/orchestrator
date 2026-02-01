import { ParsedCommand } from './types';

// A simple classifier to identify commands that are likely to use the network.
const NETWORK_COMMANDS = new Set([
  'curl',
  'wget',
  'fetch',
  'ssh',
  'scp',
  'rsync',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'docker',
  'gcloud',
  'aws',
  'az',
  'kubectl',
]);

export function isNetworkCommand(parsed: ParsedCommand): boolean {
  if (!parsed.bin) {
    return false;
  }
  return NETWORK_COMMANDS.has(parsed.bin);
}
