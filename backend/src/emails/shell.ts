import { sendEmail, escapeHtml, UNSUBSCRIBE_FOOTER } from './index.js';
import { type Lang, t } from '../lib/i18n.js';

/**
 * Render a standard branded email body. All templates share this shell
 * so the visual treatment stays consistent and we can add tracking/CSP
 * tweaks in one place. CTA is optional.
 */
export interface ShellOptions {
  title: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: boolean;
}

export function renderShell(opts: ShellOptions): string {
  const ctaHtml = opts.cta
    ? `<a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#FF00B8;color:#fff;font-weight:bold;text-decoration:none;border-radius:4px;">${escapeHtml(opts.cta.label)}</a>`
    : '';
  return `
    <div style="background:#14202B;color:#a0b4c4;font-family:sans-serif;padding:40px;max-width:500px;margin:0 auto;">
      <h1 style="color:#FF00B8;font-family:monospace;letter-spacing:2px;">PIXEL DATING</h1>
      <h2 style="color:#fff;">${escapeHtml(opts.title)}</h2>
      <p style="color:#fff;">${opts.body}</p>
      ${ctaHtml}
      ${opts.footer === false ? '' : UNSUBSCRIBE_FOOTER}
    </div>
  `;
}

export async function sendShell(params: {
  to: string;
  lang: Lang;
  subjectKey: string;
  titleKey: string;
  bodyKey: string;
  ctaKey?: string;
  ctaUrl?: string;
  vars?: Record<string, string | number>;
}) {
  const subject = t(params.lang, params.subjectKey, params.vars);
  const title = t(params.lang, params.titleKey, params.vars);
  const body = t(params.lang, params.bodyKey, params.vars);
  const cta = params.ctaKey && params.ctaUrl
    ? { label: t(params.lang, params.ctaKey), url: params.ctaUrl }
    : undefined;
  await sendEmail({
    to: params.to,
    subject,
    html: renderShell({ title, body, cta }),
  });
}
