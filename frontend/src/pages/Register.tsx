import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api, { listCountries, type Lang } from '../api';
import Nav from '../components/Nav';
import { COUNTRIES, resolveCountry, countryName } from '../lib/countries';

const GENDERS = ['male', 'female', 'non-binary', 'other'] as const;
const INTERESTS = ['male', 'female', 'non-binary'] as const;

export default function Register() {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState('');
  const [interestedIn, setInterestedIn] = useState<string[]>([]);
  const [countryCode, setCountryCode] = useState('');
  const [countryInput, setCountryInput] = useState('');

  const [verifyEmailSent, setVerifyEmailSent] = useState(false);

  const lang = (i18n.language?.slice(0, 2) ?? 'en') as Lang;
  const { data: supportedData } = useQuery({
    queryKey: ['supported-countries', lang],
    queryFn: () => listCountries(lang),
  });
  const supportedCodes = useMemo(
    () => new Set((supportedData?.countries ?? []).map(c => c.code.toUpperCase())),
    [supportedData],
  );
  const isCountrySupported = (code: string) =>
    supportedCodes.size === 0 || supportedCodes.has(code.toUpperCase());

  useEffect(() => {
    api.get<{ country_code: string | null }>('/api/cities/detect-country')
      .then(r => {
        if (r.data.country_code) {
          const cc = r.data.country_code.toUpperCase();
          setCountryCode(cc);
          setCountryInput(countryName(cc));
        }
      })
      .catch(() => {});
  }, []);

  const toggleInterest = (value: string) => {
    setInterestedIn(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value],
    );
  };

  const handleSubmit = async () => {
    if (!email) { setError(t('register.errors.email')); return; }
    if (!password || password.length < 8) { setError(t('register.errors.password')); return; }
    if (!name) { setError(t('register.errors.name')); return; }
    if (!birthYear) { setError(t('register.errors.birthYear')); return; }
    const birthYearNum = parseInt(birthYear, 10);
    if (Number.isNaN(birthYearNum)) { setError(t('register.errors.birthYear')); return; }
    if (new Date().getUTCFullYear() - birthYearNum < 18) {
      setError(t('register.errors.under18'));
      return;
    }
    if (!gender) { setError(t('register.errors.gender')); return; }
    if (interestedIn.length === 0) { setError(t('register.errors.interests')); return; }
    const resolved = countryCode || resolveCountry(countryInput);
    if (!resolved) { setError(t('register.errors.country')); return; }
    if (!isCountrySupported(resolved)) {
      setError(t('register.errors.countryUnsupported'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.post('/api/register', {
        email,
        password,
        name,
        birth_year: birthYearNum,
        gender,
        interested_in: interestedIn,
        country_code: resolved,
        lang: i18n.language?.slice(0, 2) ?? 'en',
      });
      setVerifyEmailSent(true);
      setStep(2);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: unknown } } };
      const raw = axiosErr?.response?.data?.error;
      const code = typeof raw === 'string' ? raw : '';
      let msg: string;
      if (code === 'under_18') msg = t('register.errors.under18');
      else if (code === 'country_unsupported') msg = t('register.errors.countryUnsupported');
      else msg = code || t('register.errors.generic');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle = { display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text)' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav />
      <div className="page">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
          {[1, 2].map(s => (
            <div key={s} style={{
              height: '3px', flex: 1, borderRadius: '2px',
              background: step >= s ? 'var(--accent)' : 'var(--border)',
            }} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h1 style={{ fontSize: '28px', marginBottom: '8px', color: 'var(--text-bright)' }}>
              {t('register.title')}
            </h1>
            <p style={{ marginBottom: '32px', color: 'var(--text)' }}>{t('register.intro')}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={labelStyle}>{t('register.email')}</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('register.emailPlaceholder')} />
              </div>

              <div>
                <label style={labelStyle}>{t('register.password')}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('register.passwordPlaceholder')} />
              </div>

              <div>
                <label style={labelStyle}>{t('register.name')}</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('register.namePlaceholder')} />
              </div>

              <div>
                <label style={labelStyle}>{t('register.birthYear')}</label>
                <input
                  type="number" value={birthYear}
                  onChange={e => setBirthYear(e.target.value)}
                  placeholder={t('register.birthYearPlaceholder')}
                  min="1940"
                  max={new Date().getUTCFullYear() - 18}
                />
              </div>

              <div>
                <label style={{ ...labelStyle, marginBottom: '8px' }}>{t('register.genderLabel')}</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {GENDERS.map(g => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      style={pillStyle(gender === g)}
                    >
                      {t(`gender.${g}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ ...labelStyle, marginBottom: '4px' }}>{t('register.interestsLabel')}</label>
                <p style={{ color: 'var(--text)', fontSize: '12px', marginBottom: '8px', opacity: 0.75 }}>
                  {t('register.interestsHint')}
                </p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {INTERESTS.map(g => (
                    <button
                      key={g}
                      onClick={() => toggleInterest(g)}
                      style={pillStyle(interestedIn.includes(g))}
                    >
                      {t(`interestPlural.${g}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={labelStyle}>{t('register.countryLabel')}</label>
                <input
                  type="text"
                  list="country-list"
                  value={countryInput}
                  onChange={e => {
                    const v = e.target.value;
                    setCountryInput(v);
                    setCountryCode(resolveCountry(v) ?? '');
                  }}
                  placeholder={t('register.countryPlaceholder')}
                  autoComplete="country-name"
                />
                <datalist id="country-list">
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.name}>{c.code}</option>
                  ))}
                </datalist>
              </div>

              {error && <p style={{ color: '#ff4444', fontSize: '14px' }}>{error}</p>}

              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={loading}
                style={{ marginTop: '8px', opacity: loading ? 0.6 : 1 }}
              >
                {loading ? t('register.submitting') : t('register.submit')}
              </button>
            </div>
          </>
        )}

        {step === 2 && verifyEmailSent && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📧</div>
            <h1 style={{ fontSize: '28px', marginBottom: '12px', color: 'var(--text-bright)' }}>
              {t('register.checkEmail')}
            </h1>
            <p style={{ color: 'var(--text)', marginBottom: '8px' }}>
              {t('register.sentTo', { email })}
            </p>
            <p style={{ color: 'var(--text)', fontSize: '14px' }}>
              {t('register.clickLink')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function pillStyle(selected: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: '4px', fontSize: '14px',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    background: selected ? 'var(--accent-dim)' : 'var(--surface)',
    color: selected ? 'var(--accent)' : 'var(--text)',
    cursor: 'pointer',
  };
}
