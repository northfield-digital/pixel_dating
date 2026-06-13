import { sendShell } from './shell.js';
import type { Lang } from '../lib/i18n.js';
import { escapeHtml } from './index.js';

export async function sendMatchEmail(
  toEmail: string,
  matchName: string,
  matchEmail: string,
  cityName: string,
  lang: Lang = 'en',
) {
  await sendShell({
    to: toEmail, lang,
    subjectKey: 'match.subject',
    titleKey: 'match.title',
    bodyKey: 'match.body',
    vars: {
      name: escapeHtml(matchName),
      email: escapeHtml(matchEmail),
      city: escapeHtml(cityName),
    },
  });
}
