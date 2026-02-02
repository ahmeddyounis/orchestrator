import { UsageError } from '@orchestrator/shared';

/**
 * Defines the interface for interacting with the user,
 * for prompts and confirmations.
 */
export interface UserInterface {
  prompt(message: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
}

/**
 * A user interface that throws an error if any interactive prompt is required.
 * Useful for non-interactive environments.
 */
export class NoopUserInterface implements UserInterface {
  async prompt(_message: string): Promise<string> {
    throw new UsageError('Cannot prompt in non-interactive mode.');
  }

  async confirm(_message: string): Promise<boolean> {
    throw new UsageError('Cannot confirm in non-interactive mode.');
  }
}
