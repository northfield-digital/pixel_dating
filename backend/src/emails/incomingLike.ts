import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';
import { escapeHtml } from './index.js';

export async function sendIncomingLikeEmail(toEmail: string, cityName: string, inboxUrl: string, lang: Lang = 'en') {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'incomingLike.subject',
    titleKey: 'incomingLike.title',
    bodyKey: 'incomingLike.body',
    ctaKey: 'incomingLike.cta',
    ctaUrl: inboxUrl,
    vars: { city: escapeHtml(cityName) },
  });
}
