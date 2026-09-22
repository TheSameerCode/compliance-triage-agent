export interface ErrorIssue {
  readonly path: string;
  readonly message: string;
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly issues: readonly ErrorIssue[] | undefined;

  constructor(statusCode: number, code: string, message: string, issues?: readonly ErrorIssue[]) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}
