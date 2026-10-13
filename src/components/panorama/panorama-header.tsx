"use client";
import type { ReactNode } from "react";
import "./panorama.css";
export function PanoramaHeader({ title, context, actions }: { title: string; context: ReactNode; actions?: ReactNode }) {
  return <header className="panorama-toolbar panorama-toolbar-unified">
    <div className="panorama-heading"><h1>{title}</h1><p>{context}</p></div>
    {actions && <div className="panorama-toolbar-actions">{actions}</div>}
  </header>;
}
