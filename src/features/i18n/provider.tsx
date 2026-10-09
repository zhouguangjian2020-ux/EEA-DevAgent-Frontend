"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { localeStorageKey, normalizeLocale, translate, type Locale, type UiParams } from "./core";
const eventName = "ts:interface-language";
let current: Locale | null = null;
function snapshot(): Locale {
  if (current !== null) return current;
  try { current = normalizeLocale(window.localStorage.getItem(localeStorageKey)); } catch { current = "zh-CN"; }
  return current;
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === localeStorageKey || event.key === null) { current = null; notify(); } };
  window.addEventListener(eventName, notify);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(eventName, notify); window.removeEventListener("storage", onStorage); };
}
const serverSnapshot = (): Locale => "zh-CN";
const defaultContext = { locale: "zh-CN" as Locale, setLocale: (() => {}) as (locale: Locale) => void, t: (source: string, params?: UiParams) => translate("zh-CN", source, params) };
const I18nContext = createContext(defaultContext);
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setLocale = useCallback((next: Locale) => {
    current = normalizeLocale(next);
    try { window.localStorage.setItem(localeStorageKey, current); } catch { /* Preference still works in this tab. No credentials are stored. */ }
    window.dispatchEvent(new Event(eventName));
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: (source: string, params?: UiParams) => translate(locale, source, params) }), [locale, setLocale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "en" ? "Tianshu · Engineering Workspace" : "天枢 · 研发工作空间";
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() { return useContext(I18nContext); }
