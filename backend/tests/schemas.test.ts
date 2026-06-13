import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Replicate the live schemas from the route files so we can unit-test
// the validation rules without booting the server. Keep these in sync
// with backend/src/routes/register.ts and backend/src/routes/pixel.ts.

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  birth_year: z.number().int().min(1940).max(2010),
  gender: z.enum(['male', 'female', 'non-binary', 'other']),
  interested_in: z.array(z.enum(['male', 'female', 'non-binary', 'other'])).min(1),
  country_code: z.string().length(2),
  lang: z.enum(['en', 'es', 'pt']).optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PlaceSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  type: z.enum(['person', 'event']),
  country_code: z.string().length(2),
  event_text: z.string().min(1).max(100).optional(),
  event_date: isoDate.optional(),
});

describe('RegisterSchema', () => {
  const valid = {
    email: 'test@example.com',
    name: 'Ana',
    birth_year: 1995,
    gender: 'female' as const,
    interested_in: ['male' as const],
    country_code: 'ES',
  };

  it('accepts valid input', () => {
    expect(RegisterSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts multiple interests', () => {
    expect(RegisterSchema.safeParse({ ...valid, interested_in: ['male', 'female'] }).success).toBe(true);
  });

  it('accepts valid lang', () => {
    expect(RegisterSchema.safeParse({ ...valid, lang: 'pt' }).success).toBe(true);
  });

  it('rejects invalid lang', () => {
    expect(RegisterSchema.safeParse({ ...valid, lang: 'fr' }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(RegisterSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects empty name', () => {
    expect(RegisterSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
  });

  it('rejects empty interested_in', () => {
    expect(RegisterSchema.safeParse({ ...valid, interested_in: [] }).success).toBe(false);
  });

  it('rejects invalid country_code length', () => {
    expect(RegisterSchema.safeParse({ ...valid, country_code: 'ESP' }).success).toBe(false);
  });
});

describe('PlaceSchema', () => {
  const validPerson = {
    lat: 40.4168,
    lng: -3.7038,
    type: 'person' as const,
    country_code: 'ES',
  };

  const validEvent = {
    ...validPerson,
    type: 'event' as const,
    event_text: 'Concert tonight',
    event_date: '2026-12-15',
  };

  it('accepts valid person pixel', () => {
    expect(PlaceSchema.safeParse(validPerson).success).toBe(true);
  });

  it('accepts valid event pixel', () => {
    expect(PlaceSchema.safeParse(validEvent).success).toBe(true);
  });

  it('rejects latitude out of range', () => {
    expect(PlaceSchema.safeParse({ ...validPerson, lat: 100 }).success).toBe(false);
  });

  it('rejects longitude out of range', () => {
    expect(PlaceSchema.safeParse({ ...validPerson, lng: -200 }).success).toBe(false);
  });

  it('rejects empty event_text', () => {
    expect(PlaceSchema.safeParse({ ...validEvent, event_text: '' }).success).toBe(false);
  });

  it('rejects event_text over 100 chars', () => {
    expect(PlaceSchema.safeParse({ ...validEvent, event_text: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects malformed event_date', () => {
    expect(PlaceSchema.safeParse({ ...validEvent, event_date: '2026/12/15' }).success).toBe(false);
  });

  it('accepts ISO event_date', () => {
    expect(PlaceSchema.safeParse({ ...validEvent, event_date: '2026-04-30' }).success).toBe(true);
  });
});

// Lead-window logic from routes/pixel.ts.
function isWithinEventLeadWindow(dateStr: string, today: Date = new Date()): boolean {
  const t = new Date(today);
  t.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(target.getTime())) return false;
  const max = new Date(t);
  max.setUTCDate(max.getUTCDate() + 30);
  return target.getTime() >= t.getTime() && target.getTime() <= max.getTime();
}

describe('event lead-time window', () => {
  const today = new Date('2026-04-30T12:00:00Z');

  it('accepts today', () => {
    expect(isWithinEventLeadWindow('2026-04-30', today)).toBe(true);
  });

  it('accepts 30 days out', () => {
    expect(isWithinEventLeadWindow('2026-05-30', today)).toBe(true);
  });

  it('rejects 31 days out', () => {
    expect(isWithinEventLeadWindow('2026-05-31', today)).toBe(false);
  });

  it('rejects yesterday', () => {
    expect(isWithinEventLeadWindow('2026-04-29', today)).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isWithinEventLeadWindow('not-a-date', today)).toBe(false);
  });
});
