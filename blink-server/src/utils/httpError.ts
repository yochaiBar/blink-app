/**
 * An error that carries its HTTP status. Throw it from a route or service;
 * the error handler in app.ts answers `{ error: message }` with that status.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
