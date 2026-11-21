/** Every error response is { error: { code, message } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const bad = (message: string) => new ApiError(400, 'validation_error', message);
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);
