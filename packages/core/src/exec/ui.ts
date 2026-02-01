
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
  async prompt(message: string): Promise<string> {
    throw new Error('Cannot prompt in non-interactive mode.');
  }

  async confirm(): Promise<boolean> {
    throw new Error('Cannot confirm in non-interactive mode.');
  }
}
