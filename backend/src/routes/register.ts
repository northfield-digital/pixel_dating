import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { issueToken } from '../middleware/auth.js';
import { sendVerificationEmail } from '../emails/verification.js';
import { queueEmail } from '../lib/emailQueue.js';
import { detectLang, SUPPORTED_LANGS, type Lang } from '../lib/i18n.js';
import { isSupportedCountry } from '../lib/countries.js';
import { computeEmailHash } from '../lib/emailHash.js';

const router = Router();

const MIN_AGE = 18;
const currentYear = () => new Date().getUTCFullYear();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  birth_year: z.number().int().min(1940).max(currentYear()),
  gender: z.enum(['male', 'female', 'non-binary', 'other']),
  interested_in: z.array(z.enum(['male', 'female', 'non-binary', 'other'])).min(1),
  country_code: z.string().length(2),
  lang: z.enum(['en', 'es', 'pt']).optional(),
});

// POST /api/register
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join('.') || 'input';
    res.status(400).json({ error: `Invalid ${field}: ${first?.message ?? 'invalid'}` });
    return;
  }

  const { name, birth_year, gender, interested_in, country_code, password } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  if (currentYear() - birth_year < MIN_AGE) {
    res.status(400).json({ error: 'under_18' });
    return;
  }

  if (!isSupportedCountry(country_code.toUpperCase())) {
    res.status(400).json({ error: 'country_unsupported' });
    return;
  }

  // Pick the user's language: explicit body field wins, then Accept-Language,
  // else default to English.
  const lang: Lang = parsed.data.lang
    ?? detectLang(req.headers['accept-language'] as string | undefined);
  if (!SUPPORTED_LANGS.includes(lang)) {
    res.status(400).json({ error: 'Unsupported language' });
    return;
  }

  // Indexed lookup by HMAC; the encrypted blob is still kept for display.
  const emailHash = computeEmailHash(email);
  const existingRes = await query(
    `SELECT id FROM users WHERE email_lookup_hash = $1`,
    [emailHash],
  );
  if (existingRes.rows.length > 0) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const verifyToken = crypto.randomBytes(32).toString('hex');
  const passwordHash = await bcrypt.hash(password, 10);

  const userRes = await query(
    `INSERT INTO users (email, email_lookup_hash, name, birth_year, gender, interested_in, country_code, verify_token, lang, password_hash)
     VALUES (pgp_sym_encrypt($1, $2), $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [email, process.env.EMAIL_ENCRYPTION_KEY, emailHash, name, birth_year, gender, interested_in, country_code, verifyToken, lang, passwordHash],
  );

  const userId = userRes.rows[0].id;
  const verifyUrl = `${process.env.BACKEND_URL}/api/auth/verify-email?token=${verifyToken}`;

  queueEmail('verification', () => sendVerificationEmail(email, verifyUrl, lang));

  res.status(201).json({ user_id: userId });
});

// GET /api/auth/verify-email?token=xxx
router.get('/verify-email', async (req: Request, res: Response): Promise<void> => {
  const token = req.query.token as string;
  if (!token) {
    res.status(400).json({ error: 'Missing token' });
    return;
  }

  const userRes = await query(
    `SELECT id, pgp_sym_decrypt(email, $2) AS email, name, birth_year, gender, interested_in, country_code, lang
     FROM users WHERE verify_token = $1 AND email_verified = false AND deleted_at IS NULL
       AND created_at > now() - interval '24 hours'`,
    [token, process.env.EMAIL_ENCRYPTION_KEY],
  );

  if (userRes.rows.length === 0) {
    res.status(400).json({ error: 'Invalid or expired token' });
    return;
  }

  const user = userRes.rows[0];

  await query(
    'UPDATE users SET email_verified = true, verify_token = NULL, is_active = true WHERE id = $1',
    [user.id],
  );

  issueToken(res, { id: user.id, gender: user.gender, interestedIn: user.interested_in });
  res.redirect(`${process.env.FRONTEND_URL}/place`);
});

// POST /api/auth/logout — clears the session cookie.
// Idempotent and works even when not authenticated.
router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ ok: true });
});

// POST /api/auth/login — email + password sign-in.
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();

  const userRes = await query(
    `SELECT id, gender, interested_in, password_hash
     FROM users
     WHERE email_lookup_hash = $1
       AND email_verified = true AND deleted_at IS NULL`,
    [computeEmailHash(email)],
  );

  const user = userRes.rows[0];
  const validPassword = user?.password_hash
    ? await bcrypt.compare(parsed.data.password, user.password_hash)
    : false;

  if (!user || !validPassword) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  issueToken(res, { id: user.id, gender: user.gender, interestedIn: user.interested_in });
  res.json({ ok: true });
});

export default router;
