import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, ZodIssue } from 'zod';

function validationFailed(res: Response, err: ZodError): void {
  res.status(400).json({
    error: 'Validation failed',
    details: err.issues.map((issue: ZodIssue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

/**
 * Express middleware that validates req.body against a Zod schema.
 * Returns 400 with structured error details on validation failure.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        validationFailed(res, err);
        return;
      }
      next(err);
    }
  };
}

/**
 * Validate req.query against a Zod schema. Express 5's req.query is
 * read-only, so the parsed value goes to res.locals.query (see `parsedQuery`).
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      validationFailed(res, result.error);
      return;
    }
    res.locals.query = result.data;
    next();
  };
}

/** The query parsed by `validateQuery`. */
export function parsedQuery<T>(res: Response): T {
  return res.locals.query as T;
}
