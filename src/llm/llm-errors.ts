import { ApplicationError } from '../errors/application-error.js';

export type LLMErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REJECTED'
  | 'MODEL_REFUSAL'
  | 'INCOMPLETE_RESPONSE'
  | 'INVALID_PROVIDER_RESPONSE';

const publicMessages: Record<LLMErrorCode, string> = {
  TIMEOUT: 'The model provider timed out',
  RATE_LIMITED: 'The model provider rate limit was reached',
  AUTHENTICATION_FAILED: 'The model provider rejected authentication',
  PROVIDER_UNAVAILABLE: 'The model provider is unavailable',
  PROVIDER_REJECTED: 'The model provider rejected the request',
  MODEL_REFUSAL: 'The model refused the analysis request',
  INCOMPLETE_RESPONSE: 'The model returned an incomplete response',
  INVALID_PROVIDER_RESPONSE: 'The model provider returned an invalid response',
};

export class LLMClientError extends ApplicationError<LLMErrorCode> {
  constructor(code: LLMErrorCode, retryable: boolean, options?: ErrorOptions) {
    super('LLMClientError', code, publicMessages[code], retryable, options);
  }
}
