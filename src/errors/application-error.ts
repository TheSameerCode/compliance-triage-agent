export type InfrastructureErrorCode = 'TOOL_EXECUTION_FAILED' | 'DATABASE_FAILURE';

export class ApplicationError<TCode extends string> extends Error {
  readonly code: TCode;
  readonly retryable: boolean;

  constructor(
    name: string,
    code: TCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = name;
    this.code = code;
    this.retryable = retryable;
  }
}

export class ToolExecutionError extends ApplicationError<'TOOL_EXECUTION_FAILED'> {
  constructor(options?: ErrorOptions) {
    super(
      'ToolExecutionError',
      'TOOL_EXECUTION_FAILED',
      'A permitted analysis tool could not be executed',
      false,
      options,
    );
  }
}

export class DatabaseFailureError extends ApplicationError<'DATABASE_FAILURE'> {
  constructor(options?: ErrorOptions) {
    super(
      'DatabaseFailureError',
      'DATABASE_FAILURE',
      'The analysis result could not be persisted',
      false,
      options,
    );
  }
}
