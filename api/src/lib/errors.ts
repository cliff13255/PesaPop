/** Every error the API returns has the shape { error: { code, message } }. */
export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_credentials'
  | 'draft_expired'
  | 'rate_limited'
  | 'assistant_unavailable'
  | 'provider_error'
  | 'internal_error';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  validation: (message: string) => new ApiError(400, 'validation_error', message),
  unauthorized: (message = 'Please log in again.') => new ApiError(401, 'unauthorized', message),
  forbidden: (message = 'You are not allowed to do that.') => new ApiError(403, 'forbidden', message),
  notFound: (message = 'Not found.') => new ApiError(404, 'not_found', message),
  conflict: (message: string) => new ApiError(409, 'conflict', message),
};
