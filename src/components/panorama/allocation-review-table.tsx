"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n/provider";
import type { WorkspaceFunction } from "@/lib/api/client";
import { allocationReviewReason, allocationReviewVersion, type AllocationRow, type AllocationReviewTarget,
  type AllocationReviewResult } from "@/features/workbench/allocation-review";
import { SubsystemSelect } from "./subsystem-select";

type Props = {
  rows: AllocationRow[]; feature?: WorkspaceFunction; capabilities: string[]; active: boolean; busy: boolean;
  onChangeTargets: (id: string, ids: string[]) => void;
  subsystemId?: string;
  onConfirm: (targets: AllocationReviewTarget[]) => Promise<AllocationReviewResult | undefined>;
  onReload: () => void;
};
export function AllocationReviewTable({ rows, feature, capabilities, active, busy, onChangeTargets, subsystemId, onConfirm, onReload }: Props) {
  const { t: tr } = useI18n();
  const [batchMode, setBatchMode] = useState(false), [selected, setSelected] = useState<AllocationReviewTarget[]>([]);
  const [result, setResult] = useState<AllocationReviewResult>(), [submitting, setSubmitting] = useState(false);
  const running = useRef(false), alive = useRef(true), selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scopedRows = rows.filter(row => feature?.functional_requirements.some(fr => fr.id === row.fr_id)
    && (!subsystemId || row.targets.some(target => target.subsystem_id === subsystemId)));
  const eligible = scopedRows.filter(row => !allocationReviewReason(row, capabilities));
  const selectedNow = selected.filter(target => eligible.some(row => row.candidate_id === target.id && allocationReviewVersion(row) === target.version));
  const accepted = scopedRows.filter(row => row.accepted && !row.dirty).length;
  const allSelected = eligible.length > 0 && selectedNow.length === eligible.length;
  const locked = busy || submitting || !active;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedNow.length > 0 && !allSelected; }, [selectedNow.length, allSelected, batchMode]);
  const target = (row: AllocationRow) => ({ id: row.candidate_id, version: allocationReviewVersion(row) });
  async function confirm(targets: AllocationReviewTarget[]) {
    if (running.current || locked || !targets.length) return;
    running.current = true; setSubmitting(true); setResult(undefined);
    try {
      const receipt = await onConfirm(targets);
      if (!alive.current || !receipt) return;
      setResult(receipt); setSelected(old => old.filter(item => !receipt.accepted.includes(item.id)));
    } finally { running.current = false; if (alive.current) setSubmitting(false); }
  }
  const frs = feature?.functional_requirements ?? [];
  const visible = frs.map(fr => ({ fr, row: scopedRows.find(row => row.fr_id === fr.id) }))
    .filter(item => !subsystemId || Boolean(item.row));
  const unallocated = visible.filter(item => !item.row).length;
  return <section className="uc-review-card allocation-review-card" aria-label={tr("FR分配清单")} aria-busy={locked}>
    <header className="uc-review-header"><div><h2>{tr("FR分配清单")}</h2><p>{tr("共 {total} 条 · 已确认 {accepted} 条 · 待确认 {pending} 条", { total: visible.length, accepted, pending: visible.length - accepted })}</p>{unallocated > 0 && <p>{tr("其中 {count} 条尚未生成分配", { count: unallocated })}</p>}</div>
      <div className="uc-review-actions"><button type="button" className="button-secondary" disabled={locked} onClick={onReload}>{tr("读取已保存分配")}</button>
        <button type="button" role="switch" aria-checked={batchMode} className="button-secondary" disabled={locked} onClick={() => { setBatchMode(!batchMode); setSelected([]); setResult(undefined); }}>{tr("批量确认分配")}</button>
        {batchMode && <button type="button" className="button-primary" disabled={locked || !selectedNow.length} onClick={() => void confirm(selectedNow)}>{submitting ? tr("正在确认…") : tr("确认所选（{count}）", { count: selectedNow.length })}</button>}
      </div>
    </header>
    <p className="uc-review-help">{tr("修改子系统后分配变为待确认；点击确认时先保存再确认，离开前请处理未保存修改。")}</p>
    {batchMode && <p className="uc-review-help">{tr("批量保存并确认；成功项保留，失败项可核对后重试，不会确认未选择的分配。")}</p>}
    {result && <div role={result.failed.length ? "alert" : "status"}><p>{tr("已确认 {accepted} 条，未完成 {failed} 条。", { accepted: result.accepted.length, failed: result.failed.length })}</p>
      {result.failed.length > 0 && <ul>{result.failed.map(item => <li key={item.id}>{frs.find(fr => fr.id === rows.find(row => row.candidate_id === item.id)?.fr_id)?.code ?? item.id}：{tr(item.reason)}</li>)}</ul>}</div>}
    <div className="uc-review-scroll"><table className="uc-review-table allocation-review-table"><thead><tr>
      {batchMode && <th scope="col" className="uc-review-select"><label><input ref={selectAll} type="checkbox" checked={allSelected} disabled={locked || !eligible.length} onChange={e => setSelected(e.target.checked ? eligible.map(target) : [])} />{tr("全选")}</label></th>}
      <th scope="col" className="allocation-review-number">{tr("需求编号")}</th><th scope="col" className="allocation-review-source">{tr("需求来源")}</th><th scope="col" className="allocation-review-description">{tr("需求描述")}</th><th scope="col">{tr("子系统")}</th><th scope="col">{tr("确认状态")}</th><th scope="col">{tr("操作")}</th>
    </tr></thead><tbody>{visible.map(({ fr, row }) => {
      const reason = row ? allocationReviewReason(row, capabilities) : "尚未生成分配";
      const isAccepted = Boolean(row?.accepted && !row.dirty);
      const canSave = Boolean(row && capabilities.includes(row.base ? "FR_ALLOCATION.update" : "FR_ALLOCATION.create"));
      return <tr key={fr.id} data-fr-id={fr.id} data-allocation-id={row?.allocationId}>
        {batchMode && <td className="uc-review-select"><input type="checkbox" aria-label={tr("选择分配 {number}", { number: fr.code })} checked={Boolean(row && selectedNow.some(item => item.id === row.candidate_id))} disabled={locked || Boolean(reason)} title={reason ? tr(reason) : undefined} onChange={e => row && setSelected(old => e.target.checked ? [...old.filter(item => item.id !== row.candidate_id), target(row)] : old.filter(item => item.id !== row.candidate_id))} /></td>}
        <td>{fr.code}</td><td>{fr.sources.map(source => source.uc_code + " · " + source.uc_name).join("、") || "—"}</td><td>{fr.description}{row?.unmatched_reason && <small>{tr("未匹配：")}{row.unmatched_reason}</small>}</td>
        <td className="allocation-review-target"><SubsystemSelect number={fr.code} value={row?.targets.map(item => item.subsystem_id) ?? []} options={(feature?.subsystems ?? []).filter(item => item.is_allocatable || row?.targets.some(target => target.subsystem_id === item.id))} active={active && !locked} disabled={locked || !canSave || !row} onChange={ids => row && onChangeTargets(row.candidate_id, ids)} /></td>
        <td><span className={isAccepted ? "uc-review-accepted" : "uc-review-pending"}>{tr(!row ? "尚未生成分配" : isAccepted ? "已确认" : "待确认")}</span></td>
        <td className="allocation-review-operations">{row && <><button type="button" className="button-primary" disabled={locked || Boolean(reason)} onClick={() => void confirm([target(row)])}>{tr(row.dirty ? "保存并确认" : "确认分配")}</button></>}</td>
      </tr>;
    })}{!visible.length && <tr><td colSpan={batchMode ? 7 : 6}>{tr("当前功能暂无需求")}</td></tr>}</tbody></table></div>
  </section>;
}
