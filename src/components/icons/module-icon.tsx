import type { ReactNode } from "react";
import type { PrimaryKey } from "@/features/navigation/model";

const shapes: Record<PrimaryKey, ReactNode> = {
  architecture: <><rect x="9" y="3" width="6" height="5" rx="1.1"/><rect x="3" y="16" width="6" height="5" rx="1.1"/><rect x="15" y="16" width="6" height="5" rx="1.1"/><path d="M12 8v4M6 16v-4h12v4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></>,
  development: <><path d="m7.5 6.5-5 5.5 5 5.5M16.5 6.5l5 5.5-5 5.5M14 4.5l-4 15"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></>,
  product: <><path d="m12 3 8.5 4.7v8.6L12 21l-8.5-4.7V7.7L12 3Z"/><path d="m3.5 7.7 8.5 4.7 8.5-4.7M12 12.4V21M7.75 5.35l8.5 4.7"/><circle cx="16.25" cy="10.05" r="1.25" fill="currentColor" stroke="none"/></>,
  requirements: <><path d="M13.5 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-10L13.5 3Z"/><path d="M13 3v6h6.5M8 13h8M8 17h5"/><circle cx="16" cy="17" r="1.2" fill="currentColor" stroke="none"/></>,
  safety: <><path d="m12 2.8 8 3.3v5.7c0 4.5-3.2 7.5-8 9.4-4.8-1.9-8-4.9-8-9.4V6.1l8-3.3Z"/><path d="M7.5 12h2l1.5-3 2.5 6 1.5-3h1.5"/><circle cx="16.5" cy="12" r="1.1" fill="currentColor" stroke="none"/></>,
  test: <><path d="M8 5H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 18 5h-2"/><rect x="8" y="2.5" width="8" height="5" rx="1.3"/><path d="m8 13 2.8 2.8L16 10.5"/><circle cx="16" cy="10.5" r="1.1" fill="currentColor" stroke="none"/></>,
  workbench: <><rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M3 8h18M9 8v12M12.5 13h5M12.5 16.5h3"/><circle cx="17.5" cy="16.5" r="1.15" fill="currentColor" stroke="none"/></>,
};

/** Approved engineering-blueprint family. Color follows the navigation state. */
export function ModuleIcon({ name, size = 20, className = "" }: { name: PrimaryKey; size?: number; className?: string }) {
  return <svg className={`module-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
