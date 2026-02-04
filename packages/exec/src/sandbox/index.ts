import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Configuration for Docker sandbox
 */
export interface DockerSandboxConfig {
  image: string;
  networkMode: 'none' | 'host' | 'bridge';
  readonlyRoot: boolean;
  tmpfsSize: string;
  memoryLimit: string;
  cpuLimit: number;
  seccompProfile: 'default' | 'unconfined';
}

/**
 * Configuration for devcontainer sandbox
 */
export interface DevcontainerSandboxConfig {
  configPath: string;
  workspaceMount?: string;
}

/**
 * Sandbox preparation result
 */
export interface SandboxPrepareResult {
  cwd: string;
  envOverrides?: Record<string, string>;
  cleanup?: () => Promise<void>;
  execPrefix?: string[];
}

export interface SandboxProvider {
  prepare(
    repoRoot: string,
    runId: string,
  ): Promise<SandboxPrepareResult>;
}

/**
 * No-op sandbox provider - runs commands directly on the host
 */
export class NoneSandboxProvider implements SandboxProvider {
  async prepare(
    repoRoot: string,
    _runId: string,
  ): Promise<SandboxPrepareResult> {
    return { cwd: repoRoot };
  }
}

/**
 * Docker-based sandbox provider for isolated command execution
 */
export class DockerSandboxProvider implements SandboxProvider {
  private config: DockerSandboxConfig;

  constructor(config: Partial<DockerSandboxConfig> = {}) {
    this.config = {
      image: config.image ?? 'node:20-slim',
      networkMode: config.networkMode ?? 'none',
      readonlyRoot: config.readonlyRoot ?? true,
      tmpfsSize: config.tmpfsSize ?? '512m',
      memoryLimit: config.memoryLimit ?? '2g',
      cpuLimit: config.cpuLimit ?? 2,
      seccompProfile: config.seccompProfile ?? 'default',
    };
  }

  async prepare(
    repoRoot: string,
    runId: string,
  ): Promise<SandboxPrepareResult> {
    // Verify Docker is available
    try {
      spawnSync('docker', ['--version'], { stdio: 'ignore' });
    } catch {
      throw new Error('Docker is not available. Please install Docker to use sandbox mode.');
    }

    const containerName = `orchestrator-sandbox-${runId}`;
    
    // Build docker run arguments for security hardening
    const dockerArgs = this.buildDockerArgs(repoRoot, containerName);

    return {
      cwd: '/workspace',
      envOverrides: {
        ORCHESTRATOR_SANDBOX: 'docker',
        ORCHESTRATOR_SANDBOX_CONTAINER: containerName,
      },
      execPrefix: ['docker', 'run', ...dockerArgs],
      cleanup: async () => {
        try {
          spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
        } catch {
          // Container may not exist, ignore
        }
      },
    };
  }

  private buildDockerArgs(repoRoot: string, containerName: string): string[] {
    const args: string[] = [
      '--rm',
      '--name', containerName,
      '--network', this.config.networkMode,
      '--memory', this.config.memoryLimit,
      '--cpus', String(this.config.cpuLimit),
      '-v', `${repoRoot}:/workspace:rw`,
      '-w', '/workspace',
    ];

    // Security options
    if (this.config.readonlyRoot) {
      args.push('--read-only');
      args.push('--tmpfs', `/tmp:size=${this.config.tmpfsSize}`);
      args.push('--tmpfs', '/var/tmp:size=256m');
    }

    if (this.config.seccompProfile === 'default') {
      // Use Docker's default seccomp profile for additional syscall filtering
      args.push('--security-opt', 'seccomp=default');
    }

    // Drop all capabilities and only add back what's needed
    args.push('--cap-drop', 'ALL');
    
    // Prevent privilege escalation
    args.push('--security-opt', 'no-new-privileges');

    // Add the image
    args.push(this.config.image);

    return args;
  }
}

/**
 * Devcontainer-based sandbox provider using VS Code devcontainers
 */
export class DevcontainerSandboxProvider implements SandboxProvider {
  private config: DevcontainerSandboxConfig;

  constructor(config: Partial<DevcontainerSandboxConfig> = {}) {
    this.config = {
      configPath: config.configPath ?? '.devcontainer/devcontainer.json',
      workspaceMount: config.workspaceMount,
    };
  }

  async prepare(
    repoRoot: string,
    runId: string,
  ): Promise<SandboxPrepareResult> {
    const configPath = join(repoRoot, this.config.configPath);
    
    if (!existsSync(configPath)) {
      throw new Error(`Devcontainer config not found at ${configPath}`);
    }

    // Verify devcontainer CLI is available
    try {
      spawnSync('devcontainer', ['--version'], { stdio: 'ignore' });
    } catch {
      throw new Error('devcontainer CLI is not available. Please install @devcontainers/cli.');
    }

    const containerName = `orchestrator-devcontainer-${runId}`;
    
    return {
      cwd: '/workspaces/' + repoRoot.split('/').pop(),
      envOverrides: {
        ORCHESTRATOR_SANDBOX: 'devcontainer',
        ORCHESTRATOR_SANDBOX_CONTAINER: containerName,
      },
      execPrefix: [
        'devcontainer',
        'exec',
        '--workspace-folder', repoRoot,
      ],
      cleanup: async () => {
        try {
          spawnSync('devcontainer', ['down', '--workspace-folder', repoRoot], { stdio: 'ignore' });
        } catch {
          // Container may not exist, ignore
        }
      },
    };
  }
}

/**
 * Factory function to create sandbox provider based on configuration
 */
export function createSandboxProvider(
  mode: 'none' | 'docker' | 'devcontainer',
  config?: {
    docker?: Partial<DockerSandboxConfig>;
    devcontainer?: Partial<DevcontainerSandboxConfig>;
  },
): SandboxProvider {
  switch (mode) {
    case 'docker':
      return new DockerSandboxProvider(config?.docker);
    case 'devcontainer':
      return new DevcontainerSandboxProvider(config?.devcontainer);
    case 'none':
    default:
      return new NoneSandboxProvider();
  }
}
