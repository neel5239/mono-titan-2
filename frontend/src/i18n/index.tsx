import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import hi from './hi.json';

export type Lang = 'en' | 'hi';
export type TKey = keyof typeof en;
export type Vars = Record<string, string | number>;

// Compile-time guarantee that every English key has a Hindi translation.
const hiDict = hi satisfies Record<TKey, string>;

const DICTS: Record<Lang, Record<TKey, string>> = { en, hi: hiDict };

export const LANG_KEY = 'retinaedge.lang';

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'hi';
}

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, key: TKey, vars?: Vars): string {
  const s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return interpolate(s, vars);
}

export type TFunc = (key: TKey, vars?: Vars) => string;

/** Build a translator bound to a fixed language (used by the patient sheet, which has its own language). */
export function tFor(lang: Lang): TFunc {
  return (key, vars) => translate(lang, key, vars);
}

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunc;
}

const LangContext = createContext<LangContextValue | null>(null);

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (isLang(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LangContextValue>(() => ({ lang, setLang, t: tFor(lang) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useT must be used inside LangProvider');
  return ctx;
}
