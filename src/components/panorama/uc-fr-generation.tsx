"use client";
import type { ReactNode } from "react";
import { useI18n } from "@/features/i18n/provider";
import type { ProjectWorks, UcOverviewWork } from "../../features/workbench/model";
import { frGenerationGate } from "../../features/workbench/fr-generation";

type Props = { work: UcOverviewWork; projectState: ProjectWorks; onGenerate: () => void; onStop: () => void; onOpenUc: (id: string) => void; onOpenFr: () => void; render?: (actions: ReactNode, feedback: ReactNode) => ReactNode };
export function UcFrGeneration({ work, projectState, onGenerate, onStop, onOpenUc, onOpenFr, render }: Props) {
  const { t: tr } = useI18n();
  const gate = frGenerationGate(projectState, work.featureId), busy = Boolean(work.frBatch);
  const feedback = work.frValidationShown ? gate.reason || "全部 UC 已确认，可以点击一键生成 FR。" : work.session.notice;
  const actions = <>
      <button type="button" className="button-primary" disabled={busy || work.frBatchComplete} onClick={onGenerate}>{busy ? tr("正在生成 FR…") : work.frBatchComplete ? tr("已生成 FR") : tr("生成 FR")}</button>
      {busy && <button type="button" className="button-secondary" onClick={onStop}>{tr("停止 FR 生成")}</button>}
      {work.frBatchComplete && <button type="button" className="button-secondary" onClick={onOpenFr}>{tr("查看 FR 全景")}</button>}
  </>;
  const feedbackContent = feedback && <div className="uc-fr-feedback" role={gate.reason && !busy ? "alert" : "status"}><p>{tr(feedback)}</p>
      {!busy && gate.unconfirmed.length > 0 && <><p>{tr("请先打开以下用例并点击“确认”（保存不等于确认）：")}</p><ul>{gate.unconfirmed.map(uc => <li key={uc.id}><button type="button" className="button-secondary" onClick={() => onOpenUc(uc.id)}>{uc.number} · {uc.session.document?.content.name} →</button></li>)}</ul></>}
    </div>;
  if (render) return render(actions, feedbackContent ? <div className="panorama-generation-feedback">{feedbackContent}</div> : null);
  return <section className="uc-fr-generation" aria-label={tr("生成 FR")} aria-busy={busy}>
    <div className="uc-fr-generation-row"><div><strong>{tr("下一步 · 功能需求")}</strong><p>{tr("已确认 ")}{gate.ucs.length - gate.unconfirmed.length} / {gate.ucs.length}{tr(" 个 UC · 每个 UC 生成 2 条测试 FR（Mock）")}</p></div><div className="uc-fr-actions">
      {actions}
    </div></div>
    {feedbackContent}
    {work.frBatchComplete && <small>{tr("不会重复覆盖已有 FR；后续 UC 新增或变更的重生成策略暂未接入。")}</small>}
  </section>;
}
