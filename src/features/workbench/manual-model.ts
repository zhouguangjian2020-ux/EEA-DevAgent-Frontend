import type { ManualContent } from "./manual-api";
import { featureUcs, type BusinessFeature, type ObjectWork, type ProjectWorks } from "./model";

export function acceptedPrd(p: ProjectWorks, featureId: string) {
  const saved = p.features[featureId]?.acceptedPrdRevisionId;
  if (saved) return saved;
  const prd = Object.values(p.works).find(w => w.kind === "PRD" && w.featureId === featureId);
  return prd?.kind === "PRD" && !prd.database && prd.session.document?.status === "accepted" ? prd.session.document.id : undefined;
}
export function acceptedUcs(p: ProjectWorks, featureId: string): NonNullable<BusinessFeature["acceptedUcs"]> {
  return p.features[featureId]?.acceptedUcs ?? featureUcs(p, featureId).filter(w => !w.database && w.session.document?.status === "accepted").map(w => ({ uc_id: w.objectId, uc_revision_id: w.session.document!.id, uc_code: w.number, uc_name: w.session.document!.content.name }));
}
export function draftBody(w: ObjectWork): ManualContent {
  if (w.kind === "PRD" && w.session.editDraft !== null) return { kind: "PRD", markdown_body: w.session.editDraft };
  if (w.kind === "UC" && w.session.editDraft) {
    const c = w.session.editDraft;
    return { kind: "UC", name: c.name, prd_revision_id: c.sourcePrdRevisionId ?? "", description: c.description, actors: c.actors, preconditions: c.preconditions, main_flow: c.mainFlow, branches: c.branches, exceptions: c.exceptions, postconditions: c.postconditions, extensions: c.extensions, hmi: c.hmi, regulations: c.regulations, performance: c.performance, nonfunctional: c.nonfunctional };
  }
  if (w.kind === "FR" && w.session.editDraft) {
    const c = w.session.editDraft;
    return { kind: "FR", description: c.description, acceptance_criteria: c.acceptanceCriteria ?? "", sources: c.sources ?? [] };
  }
  throw new Error("请先进入编辑模式");
}
export function acceptanceIssue(w: ObjectWork): string {
  if (w.kind === "PRD") return w.session.document?.content.trim() ? "" : "请补充 PRD 正文后再确认。";
  if (w.kind === "UC") { const c = w.session.document?.content; return c?.name.trim() && c.description.trim() && c.mainFlow.trim() ? "" : "确认 UC 前需要补充名称、描述和主事件流。"; }
  if (w.kind === "FR") { const c = w.session.document?.content; return !c?.description.trim() ? "请补充需求描述。" : !c.sources?.length ? "确认 FR 前请至少选择一个已确认的 UC 来源。" : ""; }
  return "不支持此操作";
}
