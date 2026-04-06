import { AppError } from './base.js';

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export class ValidationError extends AppError {
  public readonly errors: FieldError[];

  constructor(errors: FieldError[], message = 'Validation failed') {
    super(message, 422, 'VALIDATION_ERROR', true, { errors });
    this.errors = errors;
  }
}
