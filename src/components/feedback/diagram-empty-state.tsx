"use client";
import { useI18n } from "@/features/i18n/provider";
import "./diagram-empty-state.css";

/** Static artwork for absent confirmed sources; never represents a running task. */
export function DiagramEmptyState({ kind }: { kind: "uc" | "requirement" }) {
  const { t: tr } = useI18n();
  const uc = kind === "uc";
  return <div className="diagram-empty-state" role="status" data-diagram-empty={kind}>
    <svg className="diagram-empty-art" viewBox="0 0 280 176" fill="none" aria-hidden="true">
      <ellipse className="diagram-empty-orbit" cx="140" cy="89" rx="116" ry="69" />
      <path className="diagram-empty-grid" d="M48 44h184M38 72h204M38 100h204M48 128h184M84 28v124M112 22v136M140 20v138M168 22v136M196 28v124" />
      {uc ? <>
        <rect className="diagram-empty-paper" x="91" y="27" width="139" height="123" rx="15" />
        <path className="diagram-empty-detail" d="M108 42h34m-34 5h19" />
        <path className="diagram-empty-wire" d="M66 90h18l32-29M84 90h32M84 90l32 29" />
        <circle className="diagram-empty-line" cx="56" cy="69" r="9" />
        <path className="diagram-empty-line" d="M56 79v27m-14-18h28m-14 18-12 18m12-18 12 18" />
        {[61,90,119].map(y => <g key={y}><rect className="diagram-empty-node" x="116" y={y-10} width="87" height="20" rx="10" /><path className="diagram-empty-detail" d={`M138 ${y}h43`} /></g>)}
      </> : <>
        <path className="diagram-empty-wire" d="M92 87h34m0-36v72m0-72h33m-33 36h33m-33 36h33" />
        <rect className="diagram-empty-paper" x="36" y="57" width="57" height="60" rx="13" />
        <path className="diagram-empty-line" d="m64 70 13 7v16l-13 7-13-7V77l13-7Zm0 14v16m-13-23 13 7 13-7" />
        {[51,87,123].map(y => <g key={y}><rect className="diagram-empty-paper" x="160" y={y-14} width="77" height="28" rx="8" /><rect className="diagram-empty-node" x="171" y={y-5} width="10" height="10" rx="3" /><path className="diagram-empty-detail" d={`M189 ${y-3}h35m-35 6h23`} /></g>)}
        <circle className="diagram-empty-node" cx="126" cy="87" r="4" />
      </>}
      <path className="diagram-empty-star" d="M244 32v10m-5-5h10M29 137v8m-4-4h8" />
      <circle className="diagram-empty-dot" cx="215" cy="158" r="2.5" />
    </svg>
    <strong>{tr(uc ? "暂无已确认 UC" : "暂无已确认 FR 分配")}</strong>
    <p>{tr(uc ? "确认 UC 后，用例图将在这里显示。" : "确认该子系统的 FR 分配后，需求图将在这里显示。")}</p>
  </div>;
}
