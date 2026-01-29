export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'unknown';

export interface ToolchainCommands {
  testCmd?: string;
  lintCmd?: string;
  typecheckCmd?: string;
}

export interface ToolchainProfile {
  packageManager: PackageManager;
  usesTurbo: boolean;
  scripts: {
    test: boolean;
    lint: boolean;
    typecheck: boolean;
  };
  commands: ToolchainCommands;
}

export interface ToolchainDetector {
  detect(rootPath: string): Promise<ToolchainProfile>;
}
