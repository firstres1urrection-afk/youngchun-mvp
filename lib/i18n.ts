import en from '../locales/en.json';
import ko from '../locales/ko.json';

export type SupportedLang = 'en' | 'ko';

const translations: Record<SupportedLang, any> = {
  en,
  ko,
};

const defaultLang: SupportedLang = 'en';
let currentLang: SupportedLang = defaultLang;

export function getInitialLang(): SupportedLang {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('lang');
    if (stored === 'en' || stored === 'ko') {
      currentLang = stored as SupportedLang;
      return stored as SupportedLang;
    }
  }
  return defaultLang;
}

export function setLang(lang: SupportedLang): void {
  currentLang = lang;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('lang', lang);
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((prev: any, key: string) => {
    return prev && prev[key] !== undefined ? prev[key] : undefined;
  }, obj);
}

export function t(path: string, lang: SupportedLang = currentLang): string {
  const value = getNestedValue(translations[lang], path);
  if (typeof value === 'string') {
    return value;
  }
  return '';
}
