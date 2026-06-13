import { useTranslation } from 'react-i18next';
import Nav from '../components/Nav';

const SECTIONS_EN = [
  {
    h: '1. Data we collect',
    items: [
      'Account: email (encrypted with AES/pgcrypto), name, year of birth, gender, interests, country.',
      'Activity: pixels placed, likes sent/received, matches.',
      'Payments: handled by Stripe. We never store card data.',
      'Technical: IP (used only for country detection at signup, not stored), session cookie.',
    ],
  },
  {
    h: '2. Legal basis (GDPR)',
    items: [
      'Consent: by signing up you accept the processing of your data to operate the service.',
      'Legitimate interest: security, abuse prevention, service improvement.',
      'Contract: payment processing.',
    ],
  },
  {
    h: '3. How we use your data',
    items: [
      'Display your pixel on the map (only first name, age and country — never email).',
      'Enable connections (your email is shared only with a mutual match).',
      'Send transactional emails (likes, matches, pixel expiry).',
    ],
  },
  {
    h: '4. Your rights',
    items: [
      'Access: export your data from the account page.',
      'Erasure: delete your account at any time from settings.',
      'Rectification: edit your interests at any time.',
      'Portability: data exported as JSON.',
    ],
  },
  {
    h: '5. Cookies',
    body: 'We use one strictly-necessary httpOnly cookie to keep you signed in (JWT). No tracking, no advertising cookies.',
  },
  {
    h: '6. Retention',
    items: [
      'Active accounts: while the account exists.',
      'Deleted accounts: personal data is erased immediately; payment records are retained as legally required (up to 7 years).',
    ],
  },
  {
    h: '7. Third parties',
    items: [
      'Stripe: payment processing.',
      'Resend: transactional emails.',
      'Supabase: database (hosted in EU-West-1).',
    ],
  },
  {
    h: '8. Contact',
    body: 'For privacy queries: privacy@pixeldating.app',
  },
];

export default function Privacy() {
  const { t } = useTranslation();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav />
      <div className="page" style={{ maxWidth: '700px' }}>
        <h1 style={{ fontSize: '28px', color: 'var(--text-bright)', marginBottom: '24px' }}>
          {t('privacy.title')}
        </h1>
        <div style={{ color: 'var(--text)', lineHeight: 1.8, fontSize: '14px' }}>
          <p><strong style={{ color: 'var(--text-bright)' }}>{t('privacy.lastUpdated')}</strong> {t('privacy.lastUpdatedDate')}</p>

          {SECTIONS_EN.map(s => (
            <div key={s.h}>
              <h2 style={{ color: 'var(--text-bright)', fontSize: '18px', marginTop: '28px' }}>{s.h}</h2>
              {'items' in s && s.items ? (
                <ul>{s.items.map(it => <li key={it}>{it}</li>)}</ul>
              ) : (
                <p>{s.body}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
