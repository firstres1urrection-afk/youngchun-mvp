import React, { useState, useEffect } from 'react';
import { getInitialLang, setLang as setLangGlobal, t, SupportedLang } from '../lib/i18n';
import LanguageToggle from '../components/LanguageToggle';

const Home: React.FC = () => {
  const [lang, setLang] = useState<SupportedLang>('en');

  useEffect(() => {
    const initial = getInitialLang();
    setLang(initial as SupportedLang);
    setLangGlobal(initial as SupportedLang);
  }, []);

  const handleLangChange = (newLang: SupportedLang) => {
    setLangGlobal(newLang);
    setLang(newLang);
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
      <button>{t('home.cta')}</button>
      <p style={{ fontSize: '0.8rem' }}>{t('home.footnote')}</p>
    </div>
  );
};

export default Home;
