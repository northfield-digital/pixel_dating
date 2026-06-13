import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';
import { escapeHtml } from './index.js';

export async function sendPixelActiveEmail(toEmail: string, cityName: string, mapUrl: string, lang: Lang = 'en') {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'pixelActive.subject',
    titleKey: 'pixelActive.subject',
    bodyKey: 'pixelActive.body',
    ctaKey: 'pixelActive.cta',
    ctaUrl: mapUrl,
    vars: { city: escapeHtml(cityName) },
  });
}
