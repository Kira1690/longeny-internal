import { AppError } from './base.js';

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_FAILED');
  }
}

export class TokenExpiredError extends AppError {
  constructor() {
    super('Token has expired', 401, 'TOKEN_EXPIRED');
  }
}

export class InvalidTokenError extends AppError {
  constructor() {
    super('Invalid token', 401, 'INVALID_TOKEN');
  }
}

export class AccountLockedError extends AppError {
  constructor(lockedUntil?: Date) {
    super('Account is locked due to too many failed attempts', 423, 'ACCOUNT_LOCKED', true, {
      lockedUntil: lockedUntil?.toISOString(),
    });
  }
}

export class ConsentRequiredError extends AppError {
  constructor(missingConsents: string[]) {
    super('Required consent not granted', 403, 'CONSENT_REQUIRED', true, { missingConsents });
  }
}

export class InsufficientPermissionsError extends AppError {
  constructor(requiredPermission?: string) {
    super('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS', true, {
      requiredPermission,
    });
  }
}
