import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, logout, updatePreferences, type Lang } from '../api';
import { SUPPORTED_LANGS } from '../i18n';
import { useState } from 'react';

interface NavProps {
  authenticated?: boolean;
  onHowItWorks?: () => void;
}

export default function Nav({ authenticated = false, onHowItWorks }: NavProps) {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: authenticated,
    retry: false,
    refetchInterval: 60_000,
  });
  const pendingCount = me?.likes_pending ?? 0;

  const current = (i18n.language?.slice(0, 2) ?? 'en') as Lang;

  const linkStyle = (path: string) => ({
    fontSize: '13px',
    color: pathname === path ? 'var(--accent)' : 'var(--text)',
    textDecoration: 'none',
    letterSpacing: '0.5px',
    transition: 'color 0.15s',
  });

  const onLangChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Lang;
    await i18n.changeLanguage(next);
    if (authenticated) {
      // Best-effort persist; ignore failure.
      updatePreferences({ lang: next }).catch(() => {});
    }
  };

  const onLogout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
    } catch {
      // Even if request fails, clear local state.
    }
    queryClient.clear();
    navigate('/');
  };

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', height: '48px', flexShrink: 0,
      borderBottom: '1px solid var(--border)',
      background: 'var(--nav-bg)',
      backdropFilter: 'blur(12px)',
      position: 'relative', zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <Link to="/" style={{
          fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--accent)',
          fontWeight: 700, letterSpacing: '3px', textDecoration: 'none',
        }}>
          PIXEL DATING
        </Link>
        {onHowItWorks && (
          <button
            onClick={onHowItWorks}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: '11px',
              padding: '3px 10px',
              borderRadius: '10px',
              cursor: 'pointer',
              letterSpacing: '0.3px',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
              (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLElement).style.color = 'var(--text)';
            }}
          >
            {t('nav.howItWorks')}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        <Link to="/" style={linkStyle('/')}>{t('nav.map')}</Link>
        {authenticated && (
          <>
            <Link
              to="/inbox"
              style={{ ...linkStyle('/inbox'), position: 'relative', display: 'inline-flex', alignItems: 'center' }}
            >
              {t('nav.inbox')}
              {pendingCount > 0 && (
                <span
                  aria-label={t('nav.pendingLikes', { count: pendingCount })}
                  style={{
                    marginLeft: '6px',
                    background: '#ff3366',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: 700,
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 5px',
                    borderRadius: '8px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </Link>
            <Link to="/account" style={linkStyle('/account')}>{t('nav.account')}</Link>
          </>
        )}
        <select
          aria-label={t('nav.language')}
          value={current}
          onChange={onLangChange}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: '12px',
            padding: '4px 6px', borderRadius: '4px', cursor: 'pointer',
          }}
        >
          {SUPPORTED_LANGS.map((l) => (
            <option key={l} value={l}>{l.toUpperCase()}</option>
          ))}
        </select>
        {authenticated ? (
          <button
            onClick={onLogout}
            disabled={busy}
            style={{
              fontSize: '12px', padding: '6px 14px',
              background: 'transparent', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: '4px',
              cursor: 'pointer', letterSpacing: '0.5px',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {t('nav.logout')}
          </button>
        ) : (
          <>
            <Link to="/login" style={{
              fontSize: '12px', padding: '6px 14px',
              background: 'transparent', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: '4px',
              textDecoration: 'none', letterSpacing: '0.5px',
            }}>
              {t('nav.login')}
            </Link>
            <Link to="/register" style={{
              fontSize: '12px', padding: '6px 16px',
              background: 'var(--accent)', color: '#fff',
              fontWeight: 700, borderRadius: '4px', textDecoration: 'none',
              letterSpacing: '0.5px',
            }}>
              {t('nav.register')}
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
