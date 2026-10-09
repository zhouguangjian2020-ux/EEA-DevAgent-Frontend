"use client";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function WorkDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t: tr } = useI18n();
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!; dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); else document.querySelector<HTMLElement>('.object-tab[aria-selected="true"]')?.focus(); };
  }, []);
  return <dialog ref={ref} className="work-dialog" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><h2 id={titleId}>{tr(title)}</h2><button type="button" className="close-button" aria-label={tr("关闭对话框")} onClick={onClose}>×</button></div>{children}
  </dialog>;
}
