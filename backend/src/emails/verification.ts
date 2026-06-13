import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';

export async function sendVerificationEmail(toEmail: string, verifyUrl: string, lang: Lang = 'en') {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'verification.subject',
    titleKey: 'verification.title',
    bodyKey: 'verification.body',
    ctaKey: 'verification.cta',
    ctaUrl: verifyUrl,
  });
}
