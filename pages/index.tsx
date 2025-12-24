import React, { useState, useEffect } from 'react';
import { getInitialLang, setLang as setLangGlobal, t, SupportedLang } from '../lib/i18n';
import LanguageToggle from '../components/LanguageToggle';

const Home: React.FC = () => {
  const [lang, setLang] = useState<SupportedLang>('en');
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial = getInitialLang();
    setLang(initial as SupportedLang);
    setLangGlobal(initial as SupportedLang);
  }, []);

  const handleLangChange = (newLang: SupportedLang) => {
    setLangGlobal(newLang);
    setLang(newLang);
  };

  const handleCtaClick = async () => {
    setIsRedirecting(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create session');
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('Missing url');
    } catch (err: any) {
      setError(err.message || 'Error');
      setIsRedirecting(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 'bold' }}>Youngchun</div>
        <LanguageToggle lang={lang} onChange={handleLangChange} />
      </div>
      <h1>{t('home.headline')}</h1>
      <p>{t('home.subhead')}</p>
      <ul>
        <li>{t('home.valueProps.roaming')}</li>
        <li>{t('home.valueProps.noAnswerApp')}</li>
        <li>{t('home.valueProps.realtime')}</li>
      </ul>
      <p>{t('home.priceLine')}</p>
      <button onClick={handleCtaClick} disabled={isRedirecting}>
        {isRedirecting ? (lang === 'ko' ? '잠시만 기다려주세요...' : 'Redirecting...') : t('home.cta')}
      </button>
      {error && <p style={{ color: 'red', fontSize: '0.8rem' }}>{error}</p>}
      <p style={{ fontSize: '0.8rem' }}>{t('home.footnote')}</p>
    </div>
  );
};

export default Home;
