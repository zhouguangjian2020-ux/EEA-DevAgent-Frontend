"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/features/i18n/provider";

export type DiagramView = { scale: number; x: number; y: number };
export function zoomDiagram(view: DiagramView, scale: number, anchor = { x: 0, y: 0 }): DiagramView {
  const next = Math.min(4, Math.max(.25, scale));
  const ratio = next / view.scale;
  return { scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio };
}

/** Viewport gestures transform only an inert SVG image, never execute diagram content. */
export function DiagramViewport({ src, label, children }: { src: string; label: string; children?: ReactNode }) {
  const { t: tr } = useI18n();
  const helpId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const [view, setView] = useState<DiagramView>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current) return;
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      const factor = Math.exp(-Math.max(-200, Math.min(200, delta)) * .002);
      const anchor = { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
      setView(old => zoomDiagram(old, old.scale * factor, anchor));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function reset() { drag.current = null; setDragging(false); setView({ scale: 1, x: 0, y: 0 }); }
  return <>
    <div className="diagram-preview-toolbar">
      <button type="button" className="button-secondary" aria-label={tr("缩小")} disabled={view.scale <= .25} onClick={() => setView(old => zoomDiagram(old, old.scale - .25))}>−</button>
      <output aria-live="polite">{Math.round(view.scale * 100)}%</output>
      <button type="button" className="button-secondary" aria-label={tr("放大")} disabled={view.scale >= 4} onClick={() => setView(old => zoomDiagram(old, old.scale + .25))}>+</button>
      <button type="button" className="button-secondary" onClick={reset}>{tr("适应窗口")}</button>
      {children}
      <span id={helpId} className="diagram-preview-help">{tr("拖拽移动 · 滚轮缩放")}</span>
    </div>
    <div ref={viewport} className={`diagram-preview-viewport${dragging ? " is-dragging" : ""}`} tabIndex={0}
      aria-label={tr("图形预览，支持拖拽和滚轮缩放")} aria-describedby={helpId}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
        setDragging(true);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        setView(old => ({ ...old, x: current.startX + event.clientX - current.x, y: current.startY + event.clientY - current.y }));
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = null; setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onKeyDown={event => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); const step = event.shiftKey ? 80 : 32;
          setView(old => ({ ...old, x: old.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0), y: old.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0) }));
        } else if (["+", "=", "-"].includes(event.key)) {
          event.preventDefault(); setView(old => zoomDiagram(old, old.scale + (event.key === "-" ? -.25 : .25)));
        } else if (event.key === "Home" || event.key === "0") { event.preventDefault(); reset(); }
      }}>
      <div className="diagram-preview-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Isolated local SVG blob, no executable diagram DOM. */}
        <img src={src} alt={label} draggable={false} />
      </div>
    </div>
  </>;
}
