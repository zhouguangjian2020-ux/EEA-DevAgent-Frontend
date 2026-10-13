"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n/provider";
import type { FrWork } from "@/features/workbench/model";
import { frReviewReason, frReviewRevision, type FrReviewTarget, type FrReviewResult } from "@/features/workbench/fr-review";

type Props = { works: FrWork[]; busy?: boolean; onOpen: (id: string) => void; onOpenSource: (id: string) => void; onConfirm: (items: FrReviewTarget[]) => Promise<FrReviewResult> };
export function FrReviewTable({ works, busy = false, onOpen, onOpenSource, onConfirm }: Props) {
  const { t: tr } = useI18n();
  const [batchMode, setBatchMode] = useState(false), [selected, setSelected] = useState<FrReviewTarget[]>([]);
  const [submitting, setSubmitting] = useState(false), [result, setResult] = useState<FrReviewResult | null>(null), [error, setError] = useState("");
  const running = useRef(false), alive = useRef(true), selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const rows = works.filter(w => w.session.document);
  const eligible = rows.filter(w => !frReviewReason(w));
  const selectedNow = selected.filter(s => eligible.some(w => w.id === s.id && frReviewRevision(w) === s.revisionId));
  const accepted = rows.filter(w => w.session.document?.status === "accepted").length;
  const allSelected = eligible.length > 0 && selectedNow.length === eligible.length;
  const locked = busy || submitting;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedNow.length > 0 && !allSelected; }, [selectedNow.length, allSelected, batchMode]);
  async function confirm() {
    if (running.current || locked || !selectedNow.length) return;
    running.current = true; setSubmitting(true); setError(""); setResult(null);
    try {
      const receipt = await onConfirm(selectedNow);
      if (!alive.current) return;
      setResult(receipt); setSelected(old => old.filter(s => !receipt.accepted.includes(s.id)));
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : tr("确认失败，请重试")); }
    finally { running.current = false; if (alive.current) setSubmitting(false); }
  }
  return <section className="uc-review-card" aria-label={tr("功能需求清单")} aria-busy={locked}>
    <header className="uc-review-header"><div><h2>{tr("功能需求清单")}</h2><p>{tr("共 {total} 条 · 已确认 {accepted} 条 · 待确认 {pending} 条", { total: rows.length, accepted, pending: rows.length - accepted })}</p></div>
      <div className="uc-review-actions"><button type="button" role="switch" aria-checked={batchMode} className="button-secondary" disabled={locked} onClick={() => { setBatchMode(!batchMode); setSelected([]); setResult(null); setError(""); }}>{tr("批量确认FR")}</button>
      {batchMode && <button type="button" className="button-primary" disabled={locked || !selectedNow.length} onClick={() => void confirm()}>{submitting ? tr("正在确认…") : tr("确认所选（{count}）", { count: selectedNow.length })}</button>}</div>
    </header>
    {batchMode && <p className="uc-review-help">{tr("仅选择可确认的待确认需求；批量提交，成功项保留，失败项可重试。")}</p>}
    {error && <p role="alert">{error}</p>}
    {result && <div role={result.failed.length ? "alert" : "status"}><p>{tr("已确认 {accepted} 条，未完成 {failed} 条。", { accepted: result.accepted.length, failed: result.failed.length })}</p>
      {result.failed.length > 0 && <ul>{result.failed.map(item => <li key={item.id}>{rows.find(w => w.id === item.id)?.number ?? item.id}：{tr(item.reason)}</li>)}</ul>}</div>}
    <div className="uc-review-scroll"><table className="uc-review-table"><thead><tr>
      {batchMode && <th scope="col" className="uc-review-select"><label><input ref={selectAll} type="checkbox" checked={allSelected} disabled={locked || !eligible.length} onChange={e => setSelected(e.target.checked ? eligible.map(w => ({ id: w.id, revisionId: frReviewRevision(w) })) : [])} />{tr("全选")}</label></th>}
      <th scope="col">{tr("需求编号")}</th><th scope="col">{tr("需求来源")}</th><th scope="col">{tr("需求描述")}</th><th scope="col">{tr("确认状态")}</th></tr></thead>
      <tbody>{rows.map(work => { const reason = frReviewReason(work), isAccepted = work.session.document!.status === "accepted"; return <tr key={work.id}>
        {batchMode && <td className="uc-review-select"><input type="checkbox" aria-label={tr("选择需求 {number}", { number: work.number })} checked={selectedNow.some(s => s.id === work.id)} disabled={locked || Boolean(reason)} title={reason ? tr(reason) : undefined} onChange={e => setSelected(old => e.target.checked ? [...old.filter(s => s.id !== work.id), { id: work.id, revisionId: frReviewRevision(work) }] : old.filter(s => s.id !== work.id))} /></td>}
        <td><button type="button" className="uc-review-name" disabled={locked} onClick={() => onOpen(work.id)}>{work.number}</button></td><td>{work.sourceUcWorkId ? <button type="button" className="uc-review-name" disabled={locked} onClick={() => onOpenSource(work.sourceUcWorkId!)}>{work.session.document!.content.source}</button> : work.session.document!.content.source}</td><td><button type="button" className="uc-review-name" disabled={locked} onClick={() => onOpen(work.id)}>{work.session.document!.content.description}</button></td>
        <td><span className={isAccepted ? "uc-review-accepted" : "uc-review-pending"}>{tr(isAccepted ? "已确认" : "待确认")}</span></td>
      </tr>; })}{!rows.length && <tr><td colSpan={batchMode ? 5 : 4}>{tr("当前功能暂无需求")}</td></tr>}</tbody></table></div>
  </section>;
}
