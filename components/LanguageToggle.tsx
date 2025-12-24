import React from 'react';
import { SupportedLang } from '../lib/i18n';

interface Props {
  lang: SupportedLang;
  onChange: (lang: SupportedLang) => void;
}

const LanguageToggle: React.FC<Props> = ({ lang, onChange }) => {
  const handleSelect = (selected: SupportedLang) => {
    if (selected !== lang) {
      onChange(selected);
    }
  };

  return (
    <div role="group" aria-label="Language toggle" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem' }}>
      <button
        onClick={() => handleSelect('en')}
        aria-label="Switch to English"
        style={{
          fontWeight: lang === 'en' ? 'bold' : 'normal',
          textDecoration: lang === 'en' ? 'underline' : 'none',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        EN
      </button>
      <span>|</span>
      <button
        onClick={() => handleSelect('ko')}
        aria-label="Switch to Korean"
        style={{
          fontWeight: lang === 'ko' ? 'bold' : 'normal',
          textDecoration: lang === 'ko' ? 'underline' : 'none',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        KO
      </button>
    </div>
  );
};

export default LanguageToggle;
