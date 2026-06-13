import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';
import { escapeHtml } from './index.js';

export async function sendLikeExpiredEmail(toEmail: string, cityName: string, lang: Lang = 'en') {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'likeExpired.subject',
    titleKey: 'likeExpired.subject',
    bodyKey: 'likeExpired.body',
    vars: { city: escapeHtml(cityName) },
  });
}
