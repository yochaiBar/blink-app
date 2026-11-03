import { Router, Request, Response, NextFunction } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the named route params as UUIDs once, for every route of
 * `router` that declares them (Express `router.param`). Answers 400
 * `Invalid <name> format` before any handler runs.
 */
export function uuidParams(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req: Request, res: Response, next: NextFunction, value: string) => {
      if (!UUID_REGEX.test(value)) {
        res.status(400).json({ error: `Invalid ${name} format` });
        return;
      }
      next();
    });
  }
}
