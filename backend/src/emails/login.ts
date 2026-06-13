import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';

export async function sendLoginEmail(toEmail: string, loginUrl: string, lang: Lang = 'en') {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'login.subject',
    titleKey: 'login.title',
    bodyKey: 'login.body',
    ctaKey: 'login.cta',
    ctaUrl: loginUrl,
  });
}
