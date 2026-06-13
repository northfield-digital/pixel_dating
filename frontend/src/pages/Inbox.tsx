import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getConnections, respondToConnection,
  type PendingConnection, type MatchedConnection, type SentConnection,
} from '../api';
import Nav from '../components/Nav';

type Tab = 'pending' | 'matched' | 'sent';

function formatCountdown(expiresAt: string, expiredLabel: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return expiredLabel;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function Inbox() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('pending');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    refetchInterval: 30_000,
  });

  type ConnectionsData = {
    pending: PendingConnection[];
    matched: MatchedConnection[];
    sent: SentConnection[];
  };

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      respondToConnection(id, accept),
    // Optimistically drop the responded card from pending immediately so
    // the user doesn't keep seeing it until the next refetch. The full
    // matched card (email, name) is populated by the invalidate on success.
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['connections'] });
      const previous = queryClient.getQueryData<ConnectionsData>(['connections']);
      if (previous) {
        queryClient.setQueryData<ConnectionsData>(['connections'], {
          ...previous,
          pending: previous.pending.filter(c => c.id !== id),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['connections'], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  const tabStyle = (id: Tab): React.CSSProperties => ({
    padding: '8px 20px',
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`,
    color: tab === id ? 'var(--accent)' : 'var(--text)',
    fontSize: '15px',
    cursor: 'pointer',
    fontWeight: tab === id ? 600 : 400,
  });

  const locale = i18n.language;
  const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString(locale) : '—';

  const expiredLabel = t('inbox.expired');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav authenticated />
      <div className="page">
        <h1 style={{ fontSize: '28px', color: 'var(--text-bright)', marginBottom: '24px' }}>
          {t('inbox.title')}
        </h1>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '24px' }}>
          <button style={tabStyle('pending')} onClick={() => setTab('pending')}>
            {t('inbox.pending')} {data?.pending.length ? `(${data.pending.length})` : ''}
          </button>
          <button style={tabStyle('matched')} onClick={() => setTab('matched')}>
            {t('inbox.matched')} {data?.matched.length ? `(${data.matched.length})` : ''}
          </button>
          <button style={tabStyle('sent')} onClick={() => setTab('sent')}>
            {t('inbox.sent')}
          </button>
        </div>

        {isLoading && <p style={{ color: 'var(--text)' }}>{t('common.loading')}</p>}
        {error && <p style={{ color: '#ff4444' }}>{t('common.error')}</p>}

        {tab === 'pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data?.pending.length === 0 && (
              <p style={{ color: 'var(--text)' }}>{t('inbox.empty.pending')}</p>
            )}
            {data?.pending.map((c: PendingConnection) => (
              <div key={c.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ color: 'var(--text-bright)', fontWeight: 600, marginBottom: '4px' }}>
                    {t('inbox.incomingFrom', { name: c.from_name, age: c.from_age })}
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--mono)' }}>
                    {t('inbox.expiresIn', { time: formatCountdown(c.expires_at, expiredLabel) })}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn-secondary"
                    style={{ padding: '8px 16px', fontSize: '14px' }}
                    onClick={() => respond.mutate({ id: c.id, accept: false })}
                    disabled={respond.isPending}
                  >
                    {t('inbox.reject')}
                  </button>
                  <button
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: '14px' }}
                    onClick={() => respond.mutate({ id: c.id, accept: true })}
                    disabled={respond.isPending}
                  >
                    {t('inbox.accept')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'matched' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data?.matched.length === 0 && (
              <p style={{ color: 'var(--text)' }}>{t('inbox.empty.matched')}</p>
            )}
            {data?.matched.map((c: MatchedConnection) => (
              <div key={c.id} className="card" style={{ borderColor: 'var(--accent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: '4px' }}>
                      {t('inbox.matchTitle')}
                    </p>
                    <p style={{ color: 'var(--text-bright)', fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                      {c.match_name}, {c.match_age}
                    </p>
                    <p style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: '15px', marginBottom: '4px' }}>
                      {c.match_email}
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text)' }}>
                      {fmtDate(c.matched_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'sent' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data?.sent.length === 0 && (
              <p style={{ color: 'var(--text)' }}>{t('inbox.empty.sent')}</p>
            )}
            {data?.sent.map((c: SentConnection) => (
              <div key={c.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ color: 'var(--text-bright)', fontWeight: 600, marginBottom: '4px' }}>
                      {t('inbox.sentTo', { name: c.to_name, age: c.to_age })}
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--mono)' }}>
                      {fmtDate(c.created_at)}
                    </p>
                  </div>
                  <span style={{
                    padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontFamily: 'var(--mono)',
                    background: c.status === 'expired' ? '#33333a' : c.status === 'rejected' ? '#ff444433' : 'var(--accent-dim)',
                    color: c.status === 'expired' ? '#888' : c.status === 'rejected' ? '#ff4444' : 'var(--accent)',
                  }}>
                    {t(`inbox.status${c.status.charAt(0).toUpperCase() + c.status.slice(1)}`)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
