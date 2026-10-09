/**
 * An error whose `publicMessage` is safe to return to API clients.
 * Anything else thrown inside a request is reported as a generic 500.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly publicMessage: string,
    options?: { cause?: unknown },
  ) {
    super(publicMessage, options);
    this.name = 'AppError';
  }
}

/** Raised by LLM clients when the upstream AI provider cannot serve the request. */
export class AiUnavailableError extends AppError {
  constructor(readonly reason: string, options?: { cause?: unknown }) {
    super(503, 'GoNex is temporarily unavailable. Please try again shortly.', options);
    this.name = 'AiUnavailableError';
  }
}

export const PUBLIC_MESSAGES: Record<number, string> = {
  400: 'Invalid request.',
  401: 'Unauthorized.',
  403: 'Forbidden.',
  404: 'Not found.',
  405: 'Method not allowed.',
  413: 'Request body is too large.',
  415: 'Content-Type must be application/json.',
  429: 'Too many requests. Please slow down and try again later.',
  500: 'Unable to process the request.',
  503: 'GoNex is temporarily unavailable. Please try again shortly.',
};

export function publicMessageFor(statusCode: number): string {
  return PUBLIC_MESSAGES[statusCode] ?? (statusCode >= 500 ? PUBLIC_MESSAGES[500]! : PUBLIC_MESSAGES[400]!);
}
