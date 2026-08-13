import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

type Target = 'body' | 'query' | 'params';

/**
 * Validates and *replaces* req[target] with the parsed (and coerced) data,
 * so downstream handlers can trust the shape without re-checking it.
 */
export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Please check the form and try again.', errors);
    }
    (req as Record<Target, unknown>)[target] = result.data;
    next();
  };
}
