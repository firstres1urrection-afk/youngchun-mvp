import React, { useState, useEffect } from 'react';
import { getInitialLang, setLang as setLangGlobal, t } from '../lib/i18n';
import LanguageToggle from '../components/LanguageToggle';

export default function Home() {
  const [lang, setLang] = useState<'en' | 'ko'>('en');

  useEffect(() => {
    const initial = getInitialLang();
    setLang(initial as 'en' | 'ko');
  }, []);

  const handleLangChange = (newLang: 'en' | 'ko') => {
    setLangGlobal(newLang);
    setLang(newLang);
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontWeight: 'bold' }}>Youngchun</div>
        <LanguageToggle lang={lang} onChange={handleLangChange} />
      </div>
      <h1>{t('home.headline', lang)}</h1>
      <p>{t('home.subhead', lang)}</p>
      <ul>
        <li>{t('home.valueProps.roaming', lang)}</li>
        <li>{t('home.valueProps.noAnswerApp', lang)}</li>
        <li>{t('home.valueProps.realtime', lang)}</li>
      </ul>
      <p>{t('home.priceLine', lang)}</p>
      <button>{t('home.cta', lang)}</button>
      <p style={{ fontSize: '0.8rem', color: '#666' }}>{t('home.footnote', lang)}</p>
    </div>
  );
}
