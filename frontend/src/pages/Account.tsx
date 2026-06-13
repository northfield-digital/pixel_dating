import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  getMe, updatePreferences, deleteAccount,
  type Lang,
} from '../api';
import { SUPPORTED_LANGS } from '../i18n';
import Nav from '../components/Nav';

const INTERESTS = ['male', 'female', 'non-binary'] as const;

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

export default function Account() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [interestedIn, setInterestedIn] = useState<string[]>([]);
  const [pendingLang, setPendingLang] = useState<Lang | null>(null);

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
  });

  useEffect(() => {
    if (me) {
      setInterestedIn(me.interested_in);
      // Sync UI language to server-stored preference if different.
      if (me.lang && me.lang !== i18n.language?.slice(0, 2)) {
        i18n.changeLanguage(me.lang);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const updateMutation = useMutation({
    mutationFn: () => updatePreferences({
      interested_in: interestedIn,
      ...(pendingLang ? { lang: pendingLang } : {}),
    }),
    onSuccess: async () => {
      if (pendingLang) await i18n.changeLanguage(pendingLang);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setPrefsSaved(true);
      setPendingLang(null);
      setTimeout(() => setPrefsSaved(false), 2000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.clear();
      navigate('/');
    },
  });

  const toggleInterest = (value: string) => {
    setInterestedIn(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value],
    );
  };

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text)' }}>{t('common.loading')}</div>;
  if (!me) {
    navigate('/register');
    return null;
  }

  const confirmWord = t('account.deleteConfirmWord');
  const currentLang = pendingLang ?? me.lang;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav authenticated />
      <div className="page">
        <h1 style={{ fontSize: '28px', color: 'var(--text-bright)', marginBottom: '32px' }}>
          {t('account.title')}
        </h1>

        <section className="card" style={{ marginBottom: '24px' }}>
          <h2 style={{ color: 'var(--text-bright)', fontSize: '16px', marginBottom: '16px', fontWeight: 600 }}>
            {t('account.profile')}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Row label={t('account.name')} value={me.name} />
            <Row label={t('account.country')} value={t(`countries.${me.country_code}`, me.country_code)} />
            <Row label={t('account.birthYear')} value={String(me.birth_year)} />
            <Row label={t('account.gender')} value={t(`gender.${me.gender}`, me.gender)} />

            {me.pixel ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text)', fontSize: '14px' }}>{t('account.pixelPosition')}</span>
                <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
                  {formatCoords(me.pixel.lat, me.pixel.lng)}
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text)', fontSize: '14px' }}>{t('account.pixelLabel')}</span>
                <button
                  className="btn-primary"
                  onClick={() => navigate('/place')}
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                >
                  {t('account.placePixel')}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="card" style={{ marginBottom: '24px' }}>
          <h2 style={{ color: 'var(--text-bright)', fontSize: '16px', marginBottom: '12px', fontWeight: 600 }}>
            {t('account.interactions')}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text)', fontSize: '14px' }}>{t('account.likesRemaining')}</span>
            <span style={{ color: me.likes_remaining > 0 ? 'var(--accent)' : '#8fa8bc', fontFamily: 'var(--mono)', fontWeight: 700 }}>
              {me.likes_remaining} / {me.daily_like_limit}
            </span>
          </div>
          {me.likes_reset_at && me.likes_remaining === 0 && (
            <p style={{ color: 'var(--text)', fontSize: '12px', marginTop: '8px' }}>
              {t('account.resetsAt', { time: new Date(me.likes_reset_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
            </p>
          )}
        </section>

        <section className="card" style={{ marginBottom: '24px' }}>
          <h2 style={{ color: 'var(--text-bright)', fontSize: '16px', marginBottom: '16px', fontWeight: 600 }}>
            {t('account.preferences')}
          </h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {INTERESTS.map(opt => (
              <button
                key={opt}
                onClick={() => toggleInterest(opt)}
                style={{
                  padding: '8px 16px', borderRadius: '4px', fontSize: '14px',
                  border: `1px solid ${interestedIn.includes(opt) ? 'var(--accent)' : 'var(--border)'}`,
                  background: interestedIn.includes(opt) ? 'var(--accent-dim)' : 'var(--surface)',
                  color: interestedIn.includes(opt) ? 'var(--accent)' : 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                {t(`interestPlural.${opt}`)}
              </button>
            ))}
          </div>

          <h2 style={{ color: 'var(--text-bright)', fontSize: '14px', marginBottom: '8px', fontWeight: 600 }}>
            {t('account.languagePref')}
          </h2>
          <select
            value={currentLang}
            onChange={e => setPendingLang(e.target.value as Lang)}
            style={{
              width: '180px', padding: '8px 12px', marginBottom: '16px',
              background: 'var(--surface)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: '4px',
            }}
          >
            {SUPPORTED_LANGS.map(l => (
              <option key={l} value={l}>{t(`lang.${l}`)}</option>
            ))}
          </select>

          <div>
            <button
              className="btn-primary"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || interestedIn.length === 0}
              style={{ padding: '10px 20px', opacity: updateMutation.isPending ? 0.6 : 1 }}
            >
              {prefsSaved ? t('common.saved') : t('common.save')}
            </button>
          </div>
        </section>

        <section className="card" style={{ borderColor: '#ff444433' }}>
          <h2 style={{ color: '#ff4444', fontSize: '16px', marginBottom: '8px', fontWeight: 600 }}>
            {t('account.deleteTitle')}
          </h2>
          <p style={{ color: 'var(--text)', fontSize: '14px', marginBottom: '16px' }}>
            {t('account.deleteBody')}
          </p>
          <button className="btn-danger" onClick={() => setShowDeleteModal(true)}>
            {t('account.deleteCta')}
          </button>
        </section>

        {showDeleteModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}>
            <div className="card" style={{ maxWidth: '400px', width: '90%' }}>
              <h2 style={{ color: '#ff4444', marginBottom: '12px', fontSize: '20px' }}>
                {t('account.deleteConfirm')}
              </h2>
              <p style={{ color: 'var(--text)', fontSize: '14px', marginBottom: '20px' }}>
                {t('account.deleteConfirmBody', { word: confirmWord })}
              </p>
              <input
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder={t('account.deleteInputPlaceholder')}
                style={{ marginBottom: '16px' }}
              />
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="btn-secondary"
                  onClick={() => { setShowDeleteModal(false); setDeleteConfirm(''); }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="btn-danger"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteConfirm !== confirmWord || deleteMutation.isPending}
                  style={{ opacity: (deleteConfirm !== confirmWord || deleteMutation.isPending) ? 0.4 : 1 }}
                >
                  {deleteMutation.isPending ? t('account.deleting') : t('account.confirmDelete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text)', fontSize: '14px' }}>{label}</span>
      <span style={{ color: 'var(--text-bright)', fontFamily: 'var(--mono)', fontSize: '14px' }}>{value}</span>
    </div>
  );
}
