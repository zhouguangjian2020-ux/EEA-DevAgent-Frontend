"use client";
import type { ProjectWorks, UcOverviewWork } from "../../features/workbench/model";
import { frGenerationGate } from "../../features/workbench/fr-generation";

type Props = { work: UcOverviewWork; projectState: ProjectWorks; onGenerate: () => void; onStop: () => void; onOpenUc: (id: string) => void; onOpenFr: () => void };
export function UcFrGeneration({ work, projectState, onGenerate, onStop, onOpenUc, onOpenFr }: Props) {
  const gate = frGenerationGate(projectState, work.featureId), busy = Boolean(work.frBatch);
  const feedback = work.frValidationShown ? gate.reason || "全部 UC 已确认，可以点击一键生成 FR。" : work.session.notice;
  return <section className="uc-fr-generation" aria-label="生成 FR" aria-busy={busy}>
    <div className="uc-fr-generation-row"><div><strong>下一步 · 功能需求</strong><p>已确认 {gate.ucs.length - gate.unconfirmed.length} / {gate.ucs.length} 个 UC · 每个 UC 生成 2 条测试 FR（Mock）</p></div><div className="uc-fr-actions">
      <button type="button" className="button-primary" disabled={busy || work.frBatchComplete} onClick={onGenerate}>{busy ? <><span className="loading-icon" aria-hidden="true" />正在生成 FR…</> : work.frBatchComplete ? "已生成 FR" : "一键生成 FR"}</button>
      {busy && <button type="button" className="button-secondary" onClick={onStop}>停止 FR 生成</button>}
      {work.frBatchComplete && <button type="button" className="button-secondary" onClick={onOpenFr}>查看 FR 全景</button>}
    </div></div>
    {feedback && <div className="uc-fr-feedback" role={gate.reason && !busy ? "alert" : "status"}><p>{feedback}</p>
      {!busy && gate.unconfirmed.length > 0 && <><p>请先打开以下用例并点击“确认”（保存不等于确认）：</p><ul>{gate.unconfirmed.map(uc => <li key={uc.id}><button type="button" className="button-secondary" onClick={() => onOpenUc(uc.id)}>{uc.number} · {uc.session.document?.content.name} →</button></li>)}</ul></>}
    </div>}
    {work.frBatchComplete && <small>不会重复覆盖已有 FR；后续 UC 新增或变更的重生成策略暂未接入。</small>}
  </section>;
}
