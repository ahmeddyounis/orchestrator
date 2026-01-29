import { spawn } from 'child_process';

export interface GitServiceOptions {
  repoRoot: string;
}

export class GitService {
  private repoRoot: string;

  constructor(options: GitServiceOptions) {
    this.repoRoot = options.repoRoot;
  }

  private async exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('git', args, { cwd: this.repoRoot });
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(`Git command failed: git ${args.join(' ')}
${stderr}`),
          );
        }
      });

      process.on('error', (err) => {
        reject(new Error(`Failed to start git process: ${err.message}`));
      });
    });
  }

  async getStatusPorcelain(): Promise<string> {
    return this.exec(['status', '--porcelain']);
  }

  async ensureCleanWorkingTree(options: { allowDirty?: boolean } = {}): Promise<void> {
    const status = await this.getStatusPorcelain();
    if (status && !options.allowDirty) {
      throw new Error(
        `Working tree is dirty. Please commit or stash your changes.\n\n${status}\n\nSet 'execution.allowDirtyWorkingTree: true' to bypass this check.`,
      );
    }
  }

  async currentBranch(): Promise<string> {
    return this.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  async createAndCheckoutBranch(branchName: string): Promise<void> {
    // Check if branch exists
    try {
      await this.exec(['rev-parse', '--verify', branchName]);
      // Branch exists, checkout
      await this.exec(['checkout', branchName]);
    } catch {
      // Branch doesn't exist, create and checkout
      await this.exec(['checkout', '-b', branchName]);
    }
  }

  async stageAll(): Promise<void> {
    await this.exec(['add', '.']);
  }

  async commit(message: string): Promise<void> {
    await this.exec(['commit', '-m', message]);
  }

  async getHeadSha(): Promise<string> {
    return this.exec(['rev-parse', 'HEAD']);
  }

  async diffToHead(): Promise<string> {
    // Using simple diff. For unified diff suitable for patching, usually just 'diff' is enough.
    // 'diff HEAD' shows changes in working directory vs HEAD.
    return this.exec(['diff', 'HEAD']);
  }

  async createCheckpoint(label: string): Promise<string> {
    // We use git commit as the checkpoint mechanism.
    // 1. Check if there are changes to commit.
    const status = await this.getStatusPorcelain();
    if (!status) {
      // Nothing to commit, return current HEAD
      return this.getHeadSha();
    }

    // 2. Stage all changes
    await this.stageAll();

    // 3. Commit with a structured message
    const message = `Checkpoint: ${label}`;
    await this.commit(message);

    // 4. Return new HEAD
    return this.getHeadSha();
  }

  async rollbackToCheckpoint(checkpointRef: string): Promise<void> {
    // Reset hard to the checkpoint ref
    await this.exec(['reset', '--hard', checkpointRef]);

    // Also clean any untracked files that might have been created since then.
    // Preserve run artifacts so the orchestrator can continue logging across retries.
    await this.exec(['clean', '-fd', '-e', '.orchestrator/']);
  }
}
