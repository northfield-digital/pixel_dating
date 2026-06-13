import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPixelStatus } from '../api';
import Nav from '../components/Nav';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 90_000;

export default function PlaceSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pixelIdRaw = searchParams.get('pixel_id');
  const pixelId = pixelIdRaw ? parseInt(pixelIdRaw, 10) : null;

  const { data, isError, dataUpdatedAt } = useQuery({
    queryKey: ['pixel-status', pixelId],
    queryFn: () => getPixelStatus(pixelId!),
    enabled: pixelId !== null && !Number.isNaN(pixelId),
    // Keep polling until activation flips on, or until we give up.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.is_active) return false;
      if (d?.payment_status === 'failed') return false;
      const startedAt = q.state.dataUpdatedAt || Date.now();
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) return false;
      return POLL_INTERVAL_MS;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });

  const isActive = !!data?.is_active;
  const isFailed = data?.payment_status === 'failed';
  const isTimedOut = !isActive && !isFailed && data && Date.now() - dataUpdatedAt > POLL_TIMEOUT_MS;

  // When the pixel activates, invalidate /me etc. so the rest of the app
  // sees the new state immediately when the user navigates away.
  useEffect(() => {
    if (!isActive) return;
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['my-pixels'] });
    queryClient.invalidateQueries({ queryKey: ['all-pixels'] });
  }, [isActive, queryClient]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav authenticated={true} />

      <div className="page" style={{ textAlign: 'center', paddingTop: '80px' }}>
        <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            width: '48px', height: '48px',
            background: isActive ? '#FF00B8' : '#444c58',
            borderRadius: '4px',
            boxShadow: isActive ? '0 0 40px rgba(255,0,184,0.7)' : 'none',
            animation: isActive ? 'pixel-appear 0.6s ease-out forwards' : 'pixel-pulse 1.4s ease-in-out infinite',
            opacity: isActive ? 1 : 0.6,
          }} />
          <style>{`
            @keyframes pixel-appear {
              0%   { transform: scale(0); opacity: 0; }
              60%  { transform: scale(1.2); opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes pixel-pulse {
              0%, 100% { opacity: 0.35; }
              50%      { opacity: 0.75; }
            }
          `}</style>
        </div>

        <h1 style={{
          color: 'var(--text-bright)', fontFamily: 'var(--mono)',
          fontSize: '28px', fontWeight: 700, marginBottom: '12px',
          letterSpacing: '1px',
        }}>
          {isActive ? t('placeSuccess.title') : isFailed ? t('placeSuccess.failedTitle') : t('placeSuccess.waitingTitle')}
        </h1>

        <p style={{ color: 'var(--text)', marginBottom: '8px', fontSize: '16px' }}>
          {isActive ? t('placeSuccess.body')
            : isFailed ? t('placeSuccess.failedBody')
            : isTimedOut ? t('placeSuccess.slowBody')
            : t('placeSuccess.waitingBody')}
        </p>

        {pixelId !== null && (
          <p style={{ color: 'var(--text)', fontSize: '13px', fontFamily: 'var(--mono)', marginBottom: '32px' }}>
            {t('placeSuccess.pixelId', { id: pixelId })}
          </p>
        )}

        {isError && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>
            {t('placeSuccess.statusError')}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <button
            className="btn-primary"
            onClick={() => navigate('/')}
            disabled={!isActive}
            style={{ minWidth: '220px', opacity: isActive ? 1 : 0.5, cursor: isActive ? 'pointer' : 'not-allowed' }}
          >
            {t('placeSuccess.goMap')}
          </button>
          <button className="btn-secondary" onClick={() => navigate('/inbox')} style={{ minWidth: '220px' }}>
            {t('placeSuccess.goInbox')}
          </button>
          {isFailed && (
            <button className="btn-secondary" onClick={() => navigate('/place')} style={{ minWidth: '220px' }}>
              {t('placeSuccess.tryAgain')}
            </button>
          )}
        </div>

        <p style={{ color: 'var(--text)', fontSize: '12px', marginTop: '40px', lineHeight: 1.6, maxWidth: '400px', margin: '40px auto 0' }}>
          {t('placeSuccess.footer')}
        </p>
      </div>
    </div>
  );
}
