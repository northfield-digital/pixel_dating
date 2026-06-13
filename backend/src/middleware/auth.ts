import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  gender: string;
  interestedIn: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractUser(req: Request): AuthUser | null {
  const token = req.cookies?.token;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = extractUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = user;
  next();
}

/** Populates req.user if a valid token is present, but does not reject the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  req.user = extractUser(req) ?? undefined;
  next();
}

export function issueToken(res: Response, payload: AuthUser) {
  // 7-day session: short enough to limit damage from a stolen cookie,
  // long enough that users don't have to re-verify their email weekly.
  //
  // sameSite=lax (not strict) because:
  //  - Frontend and API are usually on different subdomains; strict
  //    silently drops the cookie on cross-site XHR even when both share
  //    an eTLD+1, in some browser/PSL combinations.
  //  - The user returns from Stripe checkout via a top-level navigation
  //    — lax sends the cookie on that GET, strict does not, leaving the
  //    user logged out on the success page.
  // CSRF is still mitigated by the JSON-only API surface, httpOnly
  // cookie, and rate-limited handlers.
  const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
