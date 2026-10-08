import type { ProjectWorks, UcWork } from "./model";
import type { UcDocument } from "../uc/model";

export type FrSource = { workId: string; document: UcDocument };
export type FrBatchRequest = { id: string; sources: FrSource[] };
export function frGenerationGate(p: ProjectWorks, featureId: string) {
  const ucs = Object.values(p.works).filter((w): w is UcWork => w.kind === "UC" && w.featureId === featureId && Boolean(w.session.document));
  const unconfirmed = ucs.filter(w => w.session.document?.status !== "accepted" || w.session.editDraft !== null || Boolean(w.session.operation || w.session.confirmDiscard));
  const growing = Object.values(p.works).some(w => w.kind === "PRD" && w.featureId === featureId && w.ucTask) || Boolean(p.conversation.operation?.kind === "send" && p.conversation.operation.mode === "UC" && p.conversation.operation.featureId === featureId);
  const reason = !ucs.length ? "当前功能下还没有 UC，请先生成并确认用例。" : growing ? "当前功能仍在生成 UC，请等待完成后再生成 FR。" : unconfirmed.length ? `还有 ${unconfirmed.length} 个 UC 未确认或尚在编辑/处理中，请逐一确认后再生成 FR。` : "";
  return { ucs, unconfirmed, reason };
}
export function snapshotFrSources(p: ProjectWorks, featureId: string): FrSource[] {
  return frGenerationGate(p, featureId).ucs.map(w => ({ workId: w.id, document: structuredClone(w.session.document!) })).sort((a, b) => a.workId.localeCompare(b.workId));
}
export function sameFrSources(a: FrSource[], b: FrSource[]) { return JSON.stringify(a) === JSON.stringify(b); }
