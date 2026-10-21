"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n/provider";
import type { UcWork } from "@/features/workbench/model";
import { ucReviewReason, ucReviewRevision, type UcReviewTarget, type UcReviewResult } from "@/features/workbench/uc-review";

type Props = { works: UcWork[]; busy?: boolean; onOpen: (id: string) => void; onConfirm: (items: UcReviewTarget[]) => Promise<UcReviewResult> };
export function UcReviewTable({ works, busy = false, onOpen, onConfirm }: Props) {
  const { t: tr } = useI18n();
  const [batchMode, setBatchMode] = useState(false), [selected, setSelected] = useState<UcReviewTarget[]>([]);
  const [submitting, setSubmitting] = useState(false), [result, setResult] = useState<UcReviewResult | null>(null), [error, setError] = useState("");
  const running = useRef(false), alive = useRef(true), selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const rows = works.filter(w => w.session.document);
  const eligible = rows.filter(w => !ucReviewReason(w));
  const selectedNow = selected.filter(s => eligible.some(w => w.id === s.id && ucReviewRevision(w) === s.revisionId));
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
  return <section className="workspace-card uc-review-card" aria-label={tr("功能用例清单")} aria-busy={locked}>
    <header className="workspace-card-header uc-review-header"><div><h2 className="workspace-card-title">{tr("功能用例清单")}</h2><p>{tr("共 {total} 条 · 已确认 {accepted} 条 · 待确认 {pending} 条", { total: rows.length, accepted, pending: rows.length - accepted })}</p></div>
      <div className="uc-review-actions"><button type="button" role="switch" aria-checked={batchMode} className="button-primary batch-review-action batch-review-toggle" disabled={locked} onClick={() => { setBatchMode(!batchMode); setSelected([]); setResult(null); setError(""); }}>{tr("批量确认UC")}</button>
      {batchMode && <button type="button" className="button-primary batch-review-action" disabled={locked || !selectedNow.length} onClick={() => void confirm()}>{submitting ? tr("正在确认…") : tr("确认所选（{count}）", { count: selectedNow.length })}</button>}</div>
    </header>
    {batchMode && <p className="uc-review-help">{tr("仅选择可确认的待确认用例；批量提交，成功项保留，失败项可重试。")}</p>}
    {error && <p role="alert">{error}</p>}
    {result && <div role={result.failed.length ? "alert" : "status"}><p>{tr("已确认 {accepted} 条，未完成 {failed} 条。", { accepted: result.accepted.length, failed: result.failed.length })}</p>
      {result.failed.length > 0 && <ul>{result.failed.map(item => <li key={item.id}>{rows.find(w => w.id === item.id)?.number ?? item.id}：{tr(item.reason)}</li>)}</ul>}</div>}
    <div className="uc-review-scroll"><table className="uc-review-table"><thead><tr>
      {batchMode && <th scope="col" className="uc-review-select"><label><input ref={selectAll} type="checkbox" checked={allSelected} disabled={locked || !eligible.length} onChange={e => setSelected(e.target.checked ? eligible.map(w => ({ id: w.id, revisionId: ucReviewRevision(w) })) : [])} />{tr("全选")}</label></th>}
      <th scope="col">{tr("用例编号")}</th><th scope="col">{tr("用例名称")}</th><th scope="col">{tr("确认状态")}</th></tr></thead>
      <tbody>{rows.map(work => { const reason = ucReviewReason(work), isAccepted = work.session.document!.status === "accepted"; return <tr key={work.id}>
        {batchMode && <td className="uc-review-select"><input type="checkbox" aria-label={tr("选择用例 {number}", { number: work.number })} checked={selectedNow.some(s => s.id === work.id)} disabled={locked || Boolean(reason)} title={reason ? tr(reason) : undefined} onChange={e => setSelected(old => e.target.checked ? [...old.filter(s => s.id !== work.id), { id: work.id, revisionId: ucReviewRevision(work) }] : old.filter(s => s.id !== work.id))} /></td>}
        <td className="review-number"><button type="button" className="uc-review-name" disabled={locked} onClick={() => onOpen(work.id)}>{work.number}</button></td><td>{work.session.document!.content.name}</td>
        <td><span className={isAccepted ? "uc-review-accepted" : "uc-review-pending"}>{tr(isAccepted ? "已确认" : "待确认")}</span></td>
      </tr>; })}{!rows.length && <tr><td colSpan={batchMode ? 4 : 3}>{tr("当前功能暂无用例")}</td></tr>}</tbody></table></div>
  </section>;
}
