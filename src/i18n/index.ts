import { createContext, useContext } from 'react';
import type { AppLocale } from '../domain/types';
import en from '../../locales/en.json';
import es from '../../locales/es-ES.json';

// All UI text comes from the locale catalogs; tests enforce key parity and that every key used in
// the source exists. UI, spoken and content locales are independent settings (SPECS §11).

export const CATALOGS: Record<AppLocale, Record<string, string>> = { en, 'es-ES': es };

export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

export function translate(locale: AppLocale, key: string, params?: Params): string {
  const template = CATALOGS[locale][key] ?? CATALOGS.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export const LocaleContext = createContext<AppLocale>('es-ES');

export function useT(): Translate {
  const locale = useContext(LocaleContext);
  return (key, params) => translate(locale, key, params);
}

export function formatDateTime(locale: AppLocale, iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
