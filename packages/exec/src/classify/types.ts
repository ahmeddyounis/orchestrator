export type CommandCategory =
  | 'destructive'
  | 'network'
  | 'install'
  | 'test'
  | 'build'
  | 'format'
  | 'lint'
  | 'unknown';

export interface ParsedCommand {
  bin: string;
  args: string[];
  raw: string;
}

export interface ToolClassification {
  category: CommandCategory;
  reason?: string;
}
