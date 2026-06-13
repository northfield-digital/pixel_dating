import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';
import { escapeHtml } from './index.js';

export async function sendPixelExpiredEmail(toEmail: string, cityName: string, deepLink: string, lang: Lang = 'en') {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'pixelExpired.subject',
    titleKey: 'pixelExpired.subject',
    bodyKey: 'pixelExpired.body',
    ctaKey: 'pixelExpired.cta',
    ctaUrl: deepLink,
    vars: { city: escapeHtml(cityName) },
  });
}
