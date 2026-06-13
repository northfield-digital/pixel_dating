import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Nav from '../components/Nav';

export default function RegisterSuccess() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setAnimating(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav authenticated={true} />
      <div className="page" style={{ textAlign: 'center' }}>
        <div style={{
          width: '80px', height: '80px', margin: '40px auto 32px',
          background: '#FF00B8',
          borderRadius: '6px',
          boxShadow: `0 0 ${animating ? '60px' : '24px'} #FF00B8`,
          transition: 'box-shadow 1.2s ease',
          animation: 'pulse 2s ease-in-out infinite',
        }} />
        <style>{`
          @keyframes pulse {
            0%, 100% { box-shadow: 0 0 24px #FF00B8; }
            50% { box-shadow: 0 0 48px #FF00B8, 0 0 80px rgba(255,0,184,0.3); }
          }
        `}</style>

        <h1 style={{ fontSize: '32px', color: 'var(--text-bright)', marginBottom: '12px' }}>
          {t('registerSuccess.title')}
        </h1>
        <p style={{ color: 'var(--text)', marginBottom: '8px', maxWidth: '400px', margin: '0 auto 8px' }}>
          {t('registerSuccess.body')}
        </p>
        <p style={{ color: 'var(--text)', fontSize: '13px', marginBottom: '40px' }}>
          {t('registerSuccess.pricing', { price: '€1.50' })}
        </p>
        <button
          className="btn-primary"
          onClick={() => navigate('/place')}
          style={{ fontSize: '17px', padding: '14px 32px' }}
        >
          {t('registerSuccess.cta')}
        </button>
      </div>
    </div>
  );
}
