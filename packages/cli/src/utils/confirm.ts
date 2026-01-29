import inquirer from 'inquirer';
import {
  ConfirmationRequested,
  ConfirmationResolved,
  OrchestratorEvent,
} from '@orchestrator/shared';

export interface EventLogger {
  log(event: OrchestratorEvent): Promise<void> | void;
}

export interface ConfirmOptions {
  yes?: boolean;
  nonInteractive?: boolean;
  logger?: EventLogger;
  runId?: string;
}

/**
 * Prompts the user for confirmation.
 *
 * @param action The action being confirmed (e.g. "Delete database")
 * @param details Optional details or warning message
 * @param defaultNo Whether the default choice should be 'No' (default: true)
 * @param options Configuration options including flags and logger
 * @returns boolean indicating if the user confirmed
 */
export async function confirm(
  action: string,
  details?: string,
  defaultNo: boolean = true,
  options: ConfirmOptions = {},
): Promise<boolean> {
  const timestamp = new Date().toISOString();
  const { logger, runId } = options;

  // Log request
  if (logger && runId) {
    const event: ConfirmationRequested = {
      schemaVersion: 1,
      timestamp,
      runId,
      type: 'ConfirmationRequested',
      payload: {
        action,
        details,
        defaultNo,
      },
    };
    await logger.log(event);
  }

  // Handle auto-approval via --yes
  if (options.yes) {
    if (logger && runId) {
      const event: ConfirmationResolved = {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        type: 'ConfirmationResolved',
        payload: {
          approved: true,
          autoResolved: true,
        },
      };
      await logger.log(event);
    }
    return true;
  }

  // Handle non-interactive mode (explicit flag or no TTY)
  // Check process.stdin.isTTY to ensure we can actually prompt
  const isTTY = process.stdin.isTTY;
  if (options.nonInteractive || !isTTY) {
    if (logger && runId) {
      const event: ConfirmationResolved = {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        type: 'ConfirmationResolved',
        payload: {
          approved: false,
          autoResolved: true,
        },
      };
      await logger.log(event);
    }
    return false;
  }

  // Prompt user
  const response = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: details ? `${action}\n${details}` : action,
      default: !defaultNo,
    },
  ]);

  const approved = response.confirmed;

  // Log resolution
  if (logger && runId) {
    const event: ConfirmationResolved = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      type: 'ConfirmationResolved',
      payload: {
        approved,
        autoResolved: false,
      },
    };
    await logger.log(event);
  }

  return approved;
}
