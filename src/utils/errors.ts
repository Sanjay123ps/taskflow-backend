import type { ApiErrorItem } from './apiResponse';

export class AppError extends Error {
  public readonly status: number;
  public readonly errors?: ApiErrorItem[];
  public readonly isOperational = true;

  constructor(status: number, message: string, errors?: ApiErrorItem[]) {
    super(message);
    this.status = status;
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errors?: ApiErrorItem[]) {
    super(400, message, errors);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors?: ApiErrorItem[]) {
    super(422, message, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You need to sign in to continue.') {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', errors?: ApiErrorItem[]) {
    super(409, message, errors);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please try again later.') {
    super(429, message);
  }
}
