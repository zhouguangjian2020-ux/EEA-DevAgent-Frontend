"use client";
import { useEffect, useRef, useState } from "react";
import { isWorkDirty, isWorkRunning, workLabel, workBadge, type ProjectWorks } from "@/features/workbench/model";

type Props = { project: string; state: ProjectWorks; onOpen: (id: string) => void; onClose: (id: string) => void; onHome: () => void; onNew: () => void; onReorder: (id: string, beforeId: string) => void };
export function ObjectTabs({ project, state, onOpen, onClose, onHome, onNew, onReorder }: Props) {
  const list = useRef<HTMLDivElement>(null); const menu = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
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
    <div className="object-tab-scroll" role="tablist" aria-label="对象标签" ref={list} onDragOver={e => {
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
      <button id={`tab-${project}-home`} role="tab" aria-controls={`panel-${project}-home`} aria-selected={!state.activeId} tabIndex={state.activeId ? -1 : 0} className={`object-tab home-tab${!state.activeId ? " active" : ""}`} onClick={onHome}><span aria-hidden="true">⌂</span> 工作台</button>
      {state.tabs.map(id => { const w = state.works[id]; const label = workLabel(w); return <div key={id} className={`object-tab-wrap${state.activeId === id ? " active" : ""}`} role="presentation" draggable onDragStart={e => { e.dataTransfer.setData("application/x-ee-tab", id); e.dataTransfer.effectAllowed = "move"; }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={e => { e.preventDefault(); onReorder(e.dataTransfer.getData("application/x-ee-tab"), id); }}>
        <button id={`tab-${project}-${id}`} role="tab" aria-controls={`panel-${project}-${id}`} aria-selected={state.activeId === id} tabIndex={state.activeId === id ? 0 : -1} className="object-tab" title={`${label}${isWorkDirty(w) ? " · 未保存" : ""}`} onClick={() => onOpen(id)}>
          <span className={`tab-kind ${workBadge(w).toLowerCase()}`}>{workBadge(w)}</span><span className="tab-label">{label}</span>{isWorkRunning(w) ? <span className="loading-icon" aria-label="任务运行中" /> : isWorkDirty(w) ? <span className="tab-dirty" aria-label="未保存">●</span> : null}
        </button><button type="button" className="tab-close" aria-label={`关闭标签 ${label}`} title="关闭标签，不删除对象" onClick={() => onClose(id)}>×</button>
      </div>; })}
    </div>
    <button type="button" className="tabbar-action" aria-label="新建 PRD 任务" title="前往工作台生成 PRD" onClick={onNew}>＋</button>
    <details className="all-tabs" ref={menu} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); menu.current!.open = false; menu.current?.querySelector("summary")?.focus(); } }}>
      <summary className="tabbar-action" aria-label={`全部标签 ${state.tabs.length} 个`} title="查看全部标签">⌄<span className="tab-count">{state.tabs.length}</span></summary>
      <div className="all-tabs-menu"><strong>已打开的对象 · {state.tabs.length}</strong><input aria-label="搜索已打开标签" placeholder="搜索名称或编号…" value={query} onChange={e => setQuery(e.target.value)} />
        <div>{state.tabs.filter(id => workLabel(state.works[id]).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(id => <button key={id} className={state.activeId === id ? "selected" : ""} onClick={() => { onOpen(id); menu.current!.open = false; }}>{workLabel(state.works[id])}{isWorkRunning(state.works[id]) && <span className="loading-icon" />}{isWorkDirty(state.works[id]) && <span aria-label="未保存"> ●</span>}</button>)}</div>
        {!state.tabs.some(id => workLabel(state.works[id]).toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p>没有匹配的标签。</p>}
      </div>
    </details>
  </div>;
}
