"use client";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useId, useRef, useState } from "react";
import { isWorkDirty, isWorkRunning, workLabel, workBadge, type ProjectWorks } from "@/features/workbench/model";

type Props = { loadingIds?: readonly string[]; project: string; state: ProjectWorks; onOpen: (id: string) => void; onClose: (id: string) => void; onHome: () => void; onNew: () => void; onReorder: (id: string, beforeId: string) => void };
export function ObjectTabs({ project, state, onOpen, onClose, onHome, onReorder, loadingIds = [] }: Props) {
  const { t: tr } = useI18n();
  const list = useRef<HTMLDivElement>(null); const menu = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const menuId = useId();
  const search = useRef<HTMLInputElement>(null);
  const filteredIds = state.tabs.filter(id => workLabel(state.works[id], tr).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const closingFromKeyboard = useRef(false);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [state.activeId, project]);
  useEffect(() => {
    if (closingFromKeyboard.current && !state.closeRequest) { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); closingFromKeyboard.current = false; }
  }, [state.tabs, state.closeRequest]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (menu.current && !menu.current.contains(e.target as Node)) menu.current.open = false; };
    document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close);
  }, []);
  function activate(id: string | null) { if (id) onOpen(id); else onHome(); }
  return <div className="object-tabbar">
    <div className="object-tab-scroll" role="tablist" aria-label={tr("对象标签")} ref={list} onDragOver={e => {
      if (!e.dataTransfer.types.includes("application/x-ee-tab")) return;
      const bounds = e.currentTarget.getBoundingClientRect();
      if (e.clientX > bounds.right - 44) e.currentTarget.scrollLeft += 24;
      else if (e.clientX < bounds.left + 120) e.currentTarget.scrollLeft -= 24;
    }} onKeyDown={e => {
      if (!(e.target instanceof HTMLElement) || e.target.getAttribute("role") !== "tab") return;
      const ids = [null, ...state.tabs]; const index = ids.indexOf(state.activeId);
      const next = e.key === "ArrowRight" ? (index + 1) % ids.length : e.key === "ArrowLeft" ? (index + ids.length - 1) % ids.length : e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : -1;
      if (next >= 0) { e.preventDefault(); activate(ids[next]); list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus(); }
      if (e.key === "Delete" && state.activeId) { e.preventDefault(); closingFromKeyboard.current = true; onClose(state.activeId); }
    }}>
      <button id={`tab-${project}-home`} role="tab" aria-controls={`panel-${project}-home`} aria-selected={!state.activeId} tabIndex={state.activeId ? -1 : 0} className={`object-tab home-tab${!state.activeId ? " active" : ""}`} onClick={onHome}><span aria-hidden="true">⌂</span>{tr(" 工作台")}</button>
      {state.tabs.map(id => { const w = state.works[id]; const label = workLabel(w, tr); return <div key={id} className={`object-tab-wrap${state.activeId === id ? " active" : ""}`} role="presentation" draggable onDragStart={e => { e.dataTransfer.setData("application/x-ee-tab", id); e.dataTransfer.effectAllowed = "move"; }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={e => { e.preventDefault(); onReorder(e.dataTransfer.getData("application/x-ee-tab"), id); }}>
        <button id={`tab-${project}-${id}`} role="tab" aria-controls={`panel-${project}-${id}`} aria-selected={state.activeId === id} tabIndex={state.activeId === id ? 0 : -1} className="object-tab" title={tr("{0}{1}", { "0": label, "1": isWorkDirty(w) ? " · 未保存" : "" })} onClick={() => onOpen(id)}>
          <span className={`tab-kind ${workBadge(w).toLowerCase()}`}>{tr(workBadge(w))}</span><span className="tab-label">{label}</span>{isWorkRunning(w) || loadingIds.includes(id) ? <span className="loading-icon" aria-label={tr("任务运行中")} /> : isWorkDirty(w) ? <span className="tab-dirty" aria-label={tr("未保存")}>●</span> : null}
        </button><button type="button" className="tab-close" aria-label={tr("关闭标签 {0}", { "0": label })} title={tr("关闭标签，不删除对象")} onClick={() => onClose(id)}>×</button>
      </div>; })}
    </div>
    <details className="all-tabs" ref={menu} onToggle={event => { if (event.currentTarget.open) search.current?.focus(); }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && menu.current) menu.current.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); menu.current!.open = false; menu.current?.querySelector("summary")?.focus(); } }}>
      <summary className="tabbar-action" aria-label={tr("全部标签 {0} 个", { "0": state.tabs.length })} aria-controls={menuId} aria-haspopup="dialog" title={tr("查看全部标签")}>
        <svg className="tabbar-action-icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="12" height="11" rx="2" /><path d="M6 3h9a2 2 0 0 1 2 2v9M6 10h6M6 13h4" /></svg>
        <span className="tabbar-action-label">{tr("查看全部标签")}</span><span className="tab-count" aria-hidden="true">{state.tabs.length}</span>
        <svg className="tabbar-action-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </summary>
      <div id={menuId} className="all-tabs-menu" role="dialog" aria-label={tr("查看全部标签")}>
        <strong>{tr("已打开的对象 · ")}{state.tabs.length}</strong><input ref={search} aria-label={tr("搜索已打开标签")} placeholder={tr("搜索名称或编号…")} value={query} onChange={e => setQuery(e.target.value)} />
        <div>{filteredIds.map(id => { const work = state.works[id]; const selected = state.activeId === id; return <button key={id} type="button" className={selected ? "selected" : ""} aria-current={selected ? "true" : undefined} onClick={() => { onOpen(id); menu.current!.open = false; document.getElementById(`tab-${project}-${id}`)?.focus(); }}>
          <span className={`tab-kind ${workBadge(work).toLowerCase()}`}>{tr(workBadge(work))}</span><span className="all-tabs-item-label">{workLabel(work, tr)}</span>{isWorkRunning(work) && <span className="loading-icon" aria-label={tr("任务运行中")} />}{isWorkDirty(work) && <span className="tab-dirty" aria-label={tr("未保存")}>●</span>}
          {selected && <svg className="all-tabs-selected" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>}
        </button>; })}</div>
        {!filteredIds.length && <p>{tr("没有匹配的标签。")}</p>}
      </div>
    </details>
  </div>;
}
