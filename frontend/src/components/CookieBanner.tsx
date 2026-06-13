import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const COOKIE_KEY = 'pd_cookie_consent';

export default function CookieBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(COOKIE_KEY)) setVisible(true);
  }, []);

  const accept = () => {
    localStorage.setItem(COOKIE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300,
      background: 'rgba(20,32,43,0.97)', backdropFilter: 'blur(12px)',
      borderTop: '1px solid var(--border)',
      padding: '16px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '16px', flexWrap: 'wrap',
    }}>
      <p style={{ color: 'var(--text)', fontSize: '13px', margin: 0, lineHeight: 1.5, flex: 1, minWidth: '200px' }}>
        {t('cookie.body')}{' '}
        <Link to="/privacy" style={{ color: 'var(--accent)' }}>{t('cookie.privacy')}</Link>
      </p>
      <button
        onClick={accept}
        style={{
          padding: '8px 20px', background: 'var(--accent)', color: '#fff',
          border: 'none', borderRadius: '4px', fontWeight: 700, fontSize: '13px',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {t('cookie.accept')}
      </button>
    </div>
  );
}
