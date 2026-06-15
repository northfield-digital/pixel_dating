import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const SEEN_KEY = 'pd_how_it_works_seen';

export default function HowItWorksOverlay({
  skip = false,
  open = false,
  onClose,
}: {
  skip?: boolean;
  open?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [autoShow, setAutoShow] = useState(false);

  useEffect(() => {
    if (skip || localStorage.getItem(SEEN_KEY)) return;
    const id = setTimeout(() => setAutoShow(true), 900);
    return () => clearTimeout(id);
  }, [skip]);

  const visible = open || autoShow;
  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, '1');
    setAutoShow(false);
    onClose?.();
  };

  const steps = [
    { emoji: '✉️', num: 1, color: '#6B9FD4', title: t('howItWorks.step1Title'), body: t('howItWorks.step1Body') },
    { emoji: '📍', num: 2, color: '#E06878', title: t('howItWorks.step2Title'), body: t('howItWorks.step2Body') },
    { emoji: '💖', num: 3, color: '#E06878', title: t('howItWorks.step3Title'), body: t('howItWorks.step3Body') },
    { emoji: '🎉', num: 4, color: '#F09840', title: t('howItWorks.step4Title'), body: t('howItWorks.step4Body') },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(5,6,8,0.68)',
        backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        overflowY: 'auto',
        padding: '16px',
        animation: 'hiw-backdrop 0.3s ease both',
      }}
      onClick={dismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          background: 'rgba(14,15,17,0.97)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderTop: '2px solid #E06878',
          borderRadius: '16px',
          padding: 'clamp(20px, 5vw, 40px)',
          paddingTop: 'clamp(32px, 5vw, 40px)',
          maxWidth: '780px',
          width: '100%',
          margin: 'auto',
          animation: 'hiw-panel 0.5s cubic-bezier(0.22,1,0.36,1) both',
        }}
      >
        <button
          onClick={dismiss}
          aria-label={t('common.close')}
          style={{
            position: 'absolute', top: '14px', right: '16px',
            background: 'rgba(255,255,255,0.08)', border: 'none',
            color: 'rgba(255,255,255,0.6)',
            fontSize: '18px', lineHeight: 1, cursor: 'pointer',
            width: '32px', height: '32px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.15)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; }}
        >
          ×
        </button>

        <div style={{ textAlign: 'center', marginBottom: 'clamp(16px, 3vw, 28px)' }}>
          <p style={{
            fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase',
            color: '#E06878', fontFamily: 'var(--mono)', marginBottom: '10px',
            animation: 'hiw-item 0.4s 0.05s both',
          }}>
            pixel.dating
          </p>
          <h2 style={{
            fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: 700, color: '#fff',
            letterSpacing: '-0.5px', marginBottom: '8px',
            animation: 'hiw-item 0.4s 0.15s both',
          }}>
            {t('howItWorks.title')}
          </h2>
          <p style={{
            color: 'rgba(255,255,255,0.4)', fontSize: 'clamp(12px, 3vw, 14px)', lineHeight: 1.5,
            animation: 'hiw-item 0.4s 0.2s both',
          }}>
            {t('howItWorks.subtitle')}
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: 'clamp(16px, 3vw, 28px)' }}>
          {steps.map((step, i) => (
            <div
              key={i}
              style={{
                flex: '1 1 140px',
                background: `${step.color}08`,
                border: `1px solid ${step.color}25`,
                borderRadius: '12px',
                padding: 'clamp(14px, 3vw, 20px) clamp(10px, 2vw, 14px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center', gap: '8px',
                animation: `hiw-item 0.4s ${0.28 + i * 0.1}s both`,
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = `${step.color}55`;
                el.style.boxShadow = `0 0 24px ${step.color}14`;
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = `${step.color}25`;
                el.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: 'clamp(40px, 8vw, 52px)', height: 'clamp(40px, 8vw, 52px)', borderRadius: '50%',
                  background: `${step.color}18`,
                  border: `1.5px solid ${step.color}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'clamp(18px, 4vw, 22px)',
                }}>
                  {step.emoji}
                </div>
                <span style={{
                  position: 'absolute', top: '-3px', right: '-5px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: step.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', fontWeight: 700, color: '#fff',
                  fontFamily: 'var(--mono)',
                }}>
                  {step.num}
                </span>
              </div>
              <p style={{ color: '#fff', fontWeight: 700, fontSize: 'clamp(12px, 2.5vw, 13px)', lineHeight: 1.35 }}>
                {step.title}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 'clamp(11px, 2vw, 12px)', lineHeight: 1.5 }}>
                {step.body}
              </p>
            </div>
          ))}
        </div>

        <div style={{
          display: 'flex', gap: '16px', justifyContent: 'center',
          alignItems: 'center', flexWrap: 'wrap',
        }}>
          <button
            onClick={() => { dismiss(); navigate('/register'); }}
            className="btn-primary"
            style={{ padding: '12px 36px', fontSize: '15px' }}
          >
            {t('howItWorks.ctaRegister')}
          </button>
          <button
            onClick={dismiss}
            style={{
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.35)', fontSize: '13px', cursor: 'pointer',
              padding: '8px 0', transition: 'color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)'; }}
          >
            {t('howItWorks.ctaSkip')}
          </button>
        </div>
      </div>
    </div>
  );
}
