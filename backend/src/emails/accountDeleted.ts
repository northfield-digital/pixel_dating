import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';

export async function sendAccountDeletedEmail(toEmail: string, lang: Lang = 'en') {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'accountDeleted.subject',
    titleKey: 'accountDeleted.subject',
    bodyKey: 'accountDeleted.body',
  });
}
