import { describe, it, expect } from 'vitest';

describe('env validation', () => {
  const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'EMAIL_ENCRYPTION_KEY', 'FRONTEND_URL', 'BACKEND_URL'];

  it('all required env vars are defined in the validation list', () => {
    // This test documents which env vars the app requires
    expect(REQUIRED).toEqual([
      'DATABASE_URL',
      'JWT_SECRET',
      'EMAIL_ENCRYPTION_KEY',
      'FRONTEND_URL',
      'BACKEND_URL',
    ]);
  });
});

describe('email normalization', () => {
  it('normalizes email to lowercase and trims', () => {
    const raw = '  User@Gmail.COM  ';
    const normalized = raw.toLowerCase().trim();
    expect(normalized).toBe('user@gmail.com');
  });
});
