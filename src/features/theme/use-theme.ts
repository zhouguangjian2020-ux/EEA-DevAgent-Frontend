"use client";
import { useSyncExternalStore } from "react";
export type Theme = "light" | "dark";
let fallback: Theme = "light";
function readTheme(): Theme {
  try { return localStorage.getItem("ts-theme") === "dark" ? "dark" : "light"; } catch { return fallback; }
}
function subscribe(notify: () => void) {
  const storage = (e: StorageEvent) => { if (e.key === "ts-theme" || e.key === null) notify(); };
  window.addEventListener("storage", storage);
  window.addEventListener("ee-theme-change", notify);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener("ee-theme-change", notify); };
}
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  function setTheme(next: Theme) {
    fallback = next;
    try { localStorage.setItem("ts-theme", next); } catch { /* Private browsing may block storage; retain this session's choice. */ }
    window.dispatchEvent(new Event("ee-theme-change"));
  }
  return [theme, setTheme] as const;
}
