export class PolicyDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyDeniedError';
  }
}

export class ConfirmationDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmationDeniedError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ProcessError extends Error {
  constructor(
    message: string,
    public exitCode: number,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}
