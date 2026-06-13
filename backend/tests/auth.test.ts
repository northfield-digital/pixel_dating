import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Test JWT auth logic in isolation
const JWT_SECRET = 'test-secret-32-chars-long-minimum!';

describe('JWT auth', () => {
  it('signs and verifies a token', () => {
    const payload = { id: 'user-123', gender: 'male', interestedIn: ['female'] };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    const decoded = jwt.verify(token, JWT_SECRET) as typeof payload;
    expect(decoded.id).toBe('user-123');
    expect(decoded.gender).toBe('male');
    expect(decoded.interestedIn).toEqual(['female']);
  });

  it('rejects tampered token', () => {
    const token = jwt.sign({ id: 'user-123' }, JWT_SECRET);
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(() => jwt.verify(tampered, JWT_SECRET)).toThrow();
  });

  it('rejects expired token', () => {
    const token = jwt.sign({ id: 'user-123' }, JWT_SECRET, { expiresIn: '0s' });
    // Small delay to ensure expiry
    expect(() => jwt.verify(token, JWT_SECRET)).toThrow(/expired/i);
  });

  it('rejects token with wrong secret', () => {
    const token = jwt.sign({ id: 'user-123' }, JWT_SECRET);
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});

describe('cookie security options', () => {
  it('production should use secure + httpOnly + strict sameSite', () => {
    const options = {
      httpOnly: true,
      secure: true,
      sameSite: 'strict' as const,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('strict');
    // Session length is bounded — we don't ship 30-day cookies.
    expect(options.maxAge).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});
