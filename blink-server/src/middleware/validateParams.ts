import { Request, Response, NextFunction } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuidParams(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const name of paramNames) {
      const value = req.params[name] as string | undefined;
      if (value && !UUID_REGEX.test(value)) {
        res.status(400).json({ error: `Invalid ${name} format` });
        return;
      }
    }
    next();
  };
}
