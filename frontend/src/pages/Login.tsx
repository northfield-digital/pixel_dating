import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { login } from '../api';
import Nav from '../components/Nav';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email) { setError(t('login.errors.email')); return; }
    if (!password) { setError(t('login.errors.password')); return; }
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        setError(t('login.errors.invalid'));
      } else {
        setError(t('login.errors.generic'));
      }
    } finally {
      setLoading(false);
    }
  };

  const labelStyle = { display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text)' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav />
      <div className="page">
        <h1 style={{ fontSize: '28px', marginBottom: '8px', color: 'var(--text-bright)' }}>
          {t('login.title')}
        </h1>
        <p style={{ marginBottom: '24px', color: 'var(--text)' }}>{t('login.intro')}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle}>{t('login.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>

          <div>
            <label style={labelStyle}>{t('login.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>

          {error && <p style={{ color: '#ff4444', fontSize: '14px' }}>{error}</p>}

          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading}
            style={{ marginTop: '8px', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
