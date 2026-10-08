"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { PRESET_SUBSYSTEMS } from "@/mocks/subsystems";

type Props = { number: string; value: string[]; onChange: (ids: string[]) => void; active: boolean; options?: readonly { id: string; name: string }[]; disabled?: boolean };
type Position = { top: number; left: number; width: number; maxHeight: number };
export function SubsystemSelect({ number, value, onChange, active, options: catalogue = PRESET_SUBSYSTEMS, disabled = false }: Props) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position>({ top: 0, left: 0, width: 320, maxHeight: 420 });
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const popupId = useId();
  // A hidden object panel must not leave a body-level portal visible or reopen it later.
  if (open && (!active || disabled)) setOpen(false);
  const names = catalogue.filter(s => value.includes(s.id)).map(s => s.name);
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase();
  const options = catalogue.filter(s => s.name.normalize("NFKC").toLocaleLowerCase().includes(normalized));
  function measure(): Position {
    const r = trigger.current!.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 32), below = window.innerHeight - r.bottom - 16, above = r.top - 16;
    const up = below < 360 && above > below, maxHeight = Math.min(420, up ? above : below);
    return { width, maxHeight, left: Math.max(16, Math.min(r.right - width, window.innerWidth - width - 16)), top: up ? Math.max(16, r.top - maxHeight - 4) : r.bottom + 4 };
  }
  function close(restoreFocus = true) { setOpen(false); if (restoreFocus) trigger.current?.focus(); }
  function toggle() { if (open) close(); else { setQuery(""); setPosition(measure()); setOpen(true); } }
  useEffect(() => {
    if (!open || !active) return;
    search.current?.focus();
    const outside = (e: PointerEvent) => { if (!popup.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false); };
    const reposition = (e: Event) => {
      if (popup.current?.contains(e.target as Node)) return;
      const anchor = trigger.current; if (!anchor) return;
      const r = anchor.getBoundingClientRect(), viewport = anchor.closest(".allocation-table-scroll")?.getBoundingClientRect();
      if (viewport && (r.bottom <= viewport.top || r.top >= viewport.bottom)) { setOpen(false); return; }
      const width = Math.min(320, window.innerWidth - 32), below = window.innerHeight - r.bottom - 16, above = r.top - 16;
      const up = below < 360 && above > below, maxHeight = Math.min(420, up ? above : below);
      setPosition({ width, maxHeight, left: Math.max(16, Math.min(r.right - width, window.innerWidth - width - 16)), top: up ? Math.max(16, r.top - maxHeight - 4) : r.bottom + 4 });
    };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", reposition); document.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", reposition); document.removeEventListener("scroll", reposition, true); };
  }, [open, active]);
  function keys(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const inputs = [...popup.current!.querySelectorAll<HTMLInputElement>('.subsystem-option input')];
      if (!inputs.length) return;
      e.preventDefault(); const current = inputs.indexOf(document.activeElement as HTMLInputElement);
      const next = current < 0 ? (e.key === "ArrowDown" ? 0 : inputs.length - 1) : (current + (e.key === "ArrowDown" ? 1 : inputs.length - 1)) % inputs.length;
      inputs[next]?.focus();
    }
    if (e.key === "Tab") {
      const nodes = [...popup.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const first = nodes[0], last = nodes.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }
  return <>
    <button ref={trigger} disabled={disabled} type="button" className="subsystem-trigger" aria-label={number + " 子系统名称"} aria-haspopup="dialog" aria-expanded={open && active} aria-controls={open ? popupId : undefined} onClick={toggle} title={names.join("、") || "请选择子系统"}>
      <span>{names.length ? names[0] + (names.length > 1 ? " 等 " + names.length + " 个" : "") : "请选择子系统"}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && active && createPortal(<div id={popupId} ref={popup} className="subsystem-popup" style={position} role="dialog" aria-label={number + " 子系统选择"} onKeyDown={keys}>
      <div className="subsystem-popup-title"><strong>{number}</strong><button type="button" aria-label="关闭子系统选择" onClick={() => close()}>×</button></div>
      <div className="subsystem-search"><span aria-hidden="true">⌕</span><input ref={search} aria-label="搜索子系统名称" placeholder="搜索子系统名称…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button type="button" aria-label="清空子系统搜索" onClick={() => { setQuery(""); search.current?.focus(); }}>×</button>}</div>
      <p className="subsystem-caption" role="status">{normalized ? "搜索结果 · " + options.length + " 个子系统" : "系统预置 · 支持多选"}</p>
      <div className="subsystem-options">{options.map(s => <label className="subsystem-option" key={s.id}><input type="checkbox" checked={value.includes(s.id)} onChange={() => onChange(value.includes(s.id) ? value.filter(id => id !== s.id) : [...value, s.id])} /><span>{s.name}</span></label>)}{!options.length && <div className="subsystem-empty"><strong>未找到匹配的子系统</strong><p>请换个关键词，或清空搜索查看全部。</p><small>此处不支持新建子系统。</small></div>}</div>
      <div className="subsystem-footer"><span><span aria-live="polite">已选择 {value.length} 个子系统</span><small>勾选即更新当前行（本页内）</small></span><button type="button" className="button-secondary" onClick={() => close()}>完成</button></div>
    </div>, document.body)}
  </>;
}
