/**
 * Application error with a stable machine-readable code and an HTTP status.
 * Services throw these; the API layer maps them to responses.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string, id?: number | string) =>
  new AppError('NOT_FOUND', id === undefined ? `${what} not found` : `${what} ${id} not found`, 404);

export const conflict = (message: string, details?: unknown) => new AppError('CONFLICT', message, 409, details);

export const badRequest = (message: string, details?: unknown) =>
  new AppError('BAD_REQUEST', message, 400, details);

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
