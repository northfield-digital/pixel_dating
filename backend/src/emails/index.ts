import { Resend } from 'resend';

const isStubbed = !process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'stub';

// Real Resend client (only used when API key is set)
const resendClient = isStubbed ? null : new Resend(process.env.RESEND_API_KEY);

export const FROM = 'Pixel Dating <noreply@pixeldating.app>';

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const UNSUBSCRIBE_FOOTER = `
  <p style="font-size:12px;color:#8fa8bc;margin-top:32px;border-top:1px solid #222;padding-top:16px;">
    Si no quieres recibir más emails, puedes
    <a href="${process.env.FRONTEND_URL || ''}/account" style="color:#8fa8bc;">gestionar tus preferencias</a>
    o eliminar tu cuenta desde la configuración.
  </p>
`;

// Unified send — logs to console in dev/stub mode, sends for real otherwise
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  if (isStubbed) {
    console.log(`\n📧 [EMAIL STUB] to=${params.to}`);
    console.log(`   subject: ${params.subject}`);
    // Extract clickable links from HTML so dev can copy-paste
    const links = params.html.match(/href="([^"]+)"/g);
    if (links) {
      for (const link of links) {
        const url = link.replace('href="', '').replace('"', '');
        console.log(`   🔗 ${url}`);
      }
    }
    console.log('');
    return;
  }
  await resendClient!.emails.send({ from: FROM, ...params });
}
