import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async route handler to catch errors and forward them
 * to the Express error handler, preventing unhandled promise rejections
 * from crashing the server.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
