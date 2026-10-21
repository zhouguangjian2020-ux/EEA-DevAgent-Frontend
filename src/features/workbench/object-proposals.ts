import type { ManualContent } from "./manual-api";
import type { Modification } from "./workflow-api";
import { isWorkRunning, type ObjectWork, type ProjectWorks } from "./model";

export type ProposalStatus = "pending" | "saving" | "uncertain" | "saved" | "discarded";
export type ObjectProposal = Modification & {
  threadId: string;
  requestId: string;
  status: ProposalStatus;
  message?: string;
  savedRevisionId?: string;
  refreshFailed?: boolean;
  refreshing?: boolean;
};
export type ProposalCollection = Record<string, ObjectProposal[]>;
export const proposalScope = (project: string, thread: string) => JSON.stringify([project, thread]);
export const proposalNeedsReview = (proposal: ObjectProposal) => !["saved", "discarded"].includes(proposal.status);

/** Unknown writes to an object block another session from submitting it again. */
export function hasObjectProposalWrite(collection: ProposalCollection, project: string, artifactId: string | undefined, exceptId?: string) {
  if (!artifactId) return false;
  return Object.entries(collection).some(([scope, items]) => items.some(item =>
    scope === proposalScope(project, item.threadId) && item.artifact_id === artifactId && item.candidate_id !== exceptId &&
    (item.status === "saving" || item.status === "uncertain" || Boolean(item.refreshing)),
  ));
}

/** Received suggestions are immutable. A later turn must never replace pending review. */
export function appendObjectProposals(previous: ObjectProposal[], threadId: string, requestId: string, changes: Modification[]): ObjectProposal[] {
  const ids = new Set(previous.map(item => item.candidate_id));
  const additions: ObjectProposal[] = [];
  for (const change of changes) {
    if (ids.has(change.candidate_id)) continue;
    ids.add(change.candidate_id);
    additions.push({ ...change, threadId, requestId, status: "pending" });
  }
  return [...previous, ...additions];
}

/** UI guidance only: the backend repeats permission and version checks inside its transaction. */
export function proposalBlockedReason(proposal: ObjectProposal, work: ObjectWork, state: ProjectWorks): string {
  if (!["PRD", "UC", "FR"].includes(work.kind) || !work.database || work.database.artifactId !== proposal.artifact_id) return "对象不在当前工作空间或已不可访问，请重新读取。";
  if (!work.database.canUpdate || !work.database.canAccept) return "当前账号没有同时修改并确认该对象的权限。";
  if (work.kind === "PRD" || work.kind === "UC" || work.kind === "FR") {
    if (work.session.editDraft !== null) return "存在人工编辑草稿，请先保存或取消编辑；AI 建议不会覆盖草稿。";
  }
  if (isWorkRunning(work)) return "该对象正在执行其他操作，请等待完成后再审查。";
  if (work.database.revisionId !== proposal.base_revision_id) return "对象工作版本已经变化，请重新生成建议，不能覆盖较新的版本。";
  if (proposal.content.kind === "UC") {
    const accepted = state.features[work.featureId]?.acceptedPrdRevisionId;
    if (accepted !== proposal.content.prd_revision_id) return "来源 PRD 的已确认版本已经变化或不可访问，请重新生成建议。";
  }
  if (proposal.content.kind === "FR") {
    const accepted = state.features[work.featureId]?.acceptedUcs ?? [];
    if (!proposal.content.sources.length || proposal.content.sources.some(source => !accepted.some(item => item.uc_id === source.uc_id && item.uc_revision_id === source.uc_revision_id))) return "来源 UC 的已确认版本已经变化或不可访问，请重新生成建议。";
  }
  return "";
}

export const proposalFieldLabels: Record<string, string> = {
  markdown_body: "PRD 正文", name: "名称", description: "描述", actors: "参与者", preconditions: "前置条件",
  main_flow: "主事件流", branches: "分支流程", exceptions: "异常流程", postconditions: "后置条件",
  extensions: "扩展用例", hmi: "HMI 逻辑", regulations: "法规", performance: "性能", nonfunctional: "非功能要求",
  acceptance_criteria: "验收标准", prd_revision_id: "来源 PRD 版本", sources: "来源 UC 版本",
};
export function proposalFieldText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "（空）";
  if (Array.isArray(value)) return value.length ? value.map(item => typeof item === "string" ? item : JSON.stringify(item)).join("\n") : "（空）";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
export function proposalFields(original: ManualContent | undefined, content: ManualContent) {
  const before = (original ?? {}) as Record<string, unknown>, after = content as Record<string, unknown>;
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(key => key !== "kind").map(key => ({
    key, label: proposalFieldLabels[key] ?? key, before: proposalFieldText(before[key]), after: proposalFieldText(after[key]),
    changed: JSON.stringify(before[key] ?? "") !== JSON.stringify(after[key] ?? ""),
  }));
}
