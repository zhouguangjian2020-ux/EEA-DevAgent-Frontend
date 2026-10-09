import type { WorkspaceObject } from "../workspace/tree";
import type { PrdDocument } from "../prd/model";
import type { ObjectWork, ProjectWorks, PrdWork } from "../workbench/model";
import { getTestFeatures } from "../../mocks/workspace";
import { mockFunctionName } from "../../mocks/prd";

export type GenerationMode = "PRD" | "UC";
export type ConversationRequest = {
  id: string; projectId: string; kind: "send" | "expand"; mode: GenerationMode | null;
  featureId: string | null; featureName: string | null; prompt: string;
  references: WorkspaceObject[];
  sourcePrd: { workId: string; document: PrdDocument } | null;
};
export type ConversationMessage = {
  id: string; role: "user" | "assistant"; content: string;
  references?: { id: string; name: string }[];
  result?: { workId: string; label: string };
};
export type ConversationState = {
  prompt: string; mode: GenerationMode | null; featureId: string | null;
  attachments: WorkspaceObject[]; messages: ConversationMessage[];
  operation: ConversationRequest | null;
  error: { request: ConversationRequest; message: string } | null;
  notice: string; expansionPreview: string | null;
  // Preserve the short topic across automatic expansions; manual edits invalidate it.
  prdNameHint: string | null;
};
export type ConversationResponse = { message: string; expandedPrompt?: string; expansionSource?: "agent"; work?: ObjectWork };
export type ConversationAction =
  | { type: "prompt"; value: string }
  | { type: "mode"; mode: GenerationMode | null; featureId?: string }
  | { type: "feature"; featureId: string | null }
  | { type: "attach"; objects: WorkspaceObject[] }
  | { type: "remove-attachment"; objectId: string }
  | { type: "start"; request: ConversationRequest; retry?: boolean }
  | { type: "expansion-progress"; id: string; text: string }
  | { type: "success"; id: string; response: ConversationResponse }
  | { type: "failed"; id: string; message: string }
  | { type: "cancel"; id: string }
  | { type: "notice"; message: string };

export function createConversation(): ConversationState {
  return { prompt: "", mode: null, featureId: null, attachments: [], messages: [], operation: null, error: null, notice: "", expansionPreview: null, prdNameHint: null };
}
export function conversationFeatures(projectId: string, p: ProjectWorks, includeTestFeatures = true): { id: string; name: string }[] {
  const features = new Map((includeTestFeatures ? getTestFeatures(projectId) : []).map(f => [f.id, f]));
  for (const feature of Object.values(p.features ?? {})) features.set(feature.id, { id: feature.id, name: feature.name });
  for (const work of Object.values(p.works)) features.set(work.featureId, { id: work.featureId, name: work.featureName });
  return [...features.values()];
}
export function prdForFeature(p: ProjectWorks, featureId: string): PrdWork | undefined {
  return Object.values(p.works).find((w): w is PrdWork => w.kind === "PRD" && w.featureId === featureId && Boolean(w.session.document));
}
export function featureDisabledReason(p: ProjectWorks, mode: GenerationMode, featureId: string): string {
  const prd = prdForFeature(p, featureId);
  if (mode === "PRD") return prd || p.features?.[featureId]?.hasPrd ? "已有 PRD" : "";
  if (!prd) return "尚未生成 PRD";
  return prd.session.document?.status === "accepted" ? "" : "PRD 尚未确认";
}
export function validateConversationRequest(p: ProjectWorks, r: ConversationRequest): string {
  if (!r.prompt.trim()) return "请输入问题或生成要求。";
  // Expansion only rewrites the input, regardless of generation mode or source eligibility.
  if (r.kind === "expand") return Array.from(r.prompt).length > 4000 ? "自动扩写最多支持 4000 个字符，请缩短输入后重试。" : "";
  if (r.mode && r.references.length) return "生成模式不能同时引用对象附件。";
  if (r.mode === "PRD" && r.kind === "send") {
    if (!r.featureId || !r.featureName?.trim()) return "新功能信息不完整，请重新提交 PRD 生成。";
    const features = conversationFeatures(r.projectId, p);
    const existing = features.find(f => f.id === r.featureId);
    if (existing) {
      if (existing.name !== r.featureName) return "所选功能已变化，请重新选择。";
      if (featureDisabledReason(p, "PRD", existing.id)) return "该功能已有PRD，未生成或覆盖。";
    } else if (features.some(f => f.name.trim().replace(/\s+/g, " ").toLowerCase() === r.featureName!.trim().replace(/\s+/g, " ").toLowerCase())) return "该功能已存在，本次生成已终止。";
  }
  if (r.mode === "UC") {
    const feature = conversationFeatures(r.projectId, p).find(f => f.id === r.featureId);
    if (!feature) return "请先选择当前项目的业务功能。";
    const reason = featureDisabledReason(p, "UC", feature.id);
    if (reason) return `${feature.name}：${reason}。`;
    if (feature.name !== r.featureName) return "所选功能已发生变化，请重新选择。";
    if (r.kind === "send") {
      const source = prdForFeature(p, feature.id);
      if (!r.sourcePrd || source?.id !== r.sourcePrd.workId || source.session.document?.id !== r.sourcePrd.document.id || source.session.document.revision !== r.sourcePrd.document.revision || source.session.document.content !== r.sourcePrd.document.content) return "来源 PRD 已发生变化，请重新提交用例生成。";
    }
  }
  return "";
}
export function buildConversationRequest(projectId: string, p: ProjectWorks, id: string, kind: "send" | "expand"): ConversationRequest {
  const c = p.conversation;
  const feature = c.mode === "UC" || c.mode === "PRD" && kind === "send" ? conversationFeatures(projectId, p).find(f => f.id === c.featureId) : undefined;
  const prdName = c.mode === "PRD" ? c.prdNameHint ?? mockFunctionName(c.prompt) : null;
  const source = feature && c.mode === "UC" ? prdForFeature(p, feature.id) : undefined;
  return {
    id, projectId, kind, mode: c.mode,
    featureId: c.mode === "PRD" && kind === "send" && !feature ? `${projectId}-feature-${id}` : feature?.id ?? null,
    featureName: feature?.name ?? prdName,
    prompt: c.prompt.trim(), references: c.attachments.map(o => ({ ...o })),
    sourcePrd: source?.session.document ? { workId: source.id, document: { ...source.session.document } } : null,
  };
}
function withConversation(p: ProjectWorks, conversation: ConversationState): ProjectWorks { return { ...p, conversation }; }
function failed(p: ProjectWorks, request: ConversationRequest, message: string): ProjectWorks {
  const c = p.conversation;
  return withConversation(p, { ...c, operation: null, expansionPreview: null, error: { request, message }, prompt: c.prompt || request.prompt, prdNameHint: c.prompt ? c.prdNameHint : request.mode === "PRD" ? request.featureName : null, notice: "" });
}
export function reduceProjectConversation(p: ProjectWorks, a: ConversationAction): ProjectWorks {
  const c = p.conversation;
  switch (a.type) {
    case "prompt": return c.operation?.kind === "expand" ? p : withConversation(p, { ...c, prompt: a.value, prdNameHint: a.value === c.prompt ? c.prdNameHint : null });
    case "mode":
      if (c.operation) return withConversation(p, { ...c, notice: "请等待当前回复完成，或先停止本次请求。" });
      return withConversation(p, { ...c, mode: a.mode, featureId: a.mode === "UC" ? a.featureId ?? null : null, attachments: a.mode ? [] : c.attachments, error: null, notice: a.mode && c.attachments.length ? "已移除对话附件，切换为快捷生成。" : "" });
    case "feature": return c.operation || !c.mode ? p : withConversation(p, { ...c, featureId: a.featureId, error: null, notice: "" });
    case "attach": {
      if (c.operation || !a.objects.length) return p;
      const attachments = new Map(c.attachments.map(o => [o.id, o]));
      for (const o of a.objects) attachments.set(o.id, { ...o });
      return withConversation(p, { ...c, mode: null, featureId: null, attachments: [...attachments.values()], error: null, notice: "对象已加入项目对话；快捷生成已取消。未发送，也未切换标签。" });
    }
    case "remove-attachment": return c.operation ? p : withConversation(p, { ...c, attachments: c.attachments.filter(o => o.id !== a.objectId) });
    case "notice": return withConversation(p, { ...c, notice: a.message });
    case "start": {
      if (c.operation) return p;
      const message = validateConversationRequest(p, a.request);
      if (message) return withConversation(p, { ...c, notice: message });
      const r = a.request;
      return withConversation(p, { ...c, operation: r, expansionPreview: null, error: null, notice: "", prompt: r.kind === "expand" || a.retry && c.prompt.trim() !== r.prompt ? c.prompt : "", prdNameHint: r.kind === "expand" || a.retry && c.prompt.trim() !== r.prompt ? c.prdNameHint : null, messages: r.kind === "expand" || a.retry ? c.messages : [...c.messages, {
        id: `${r.id}-user`, role: "user", content: r.prompt,
        references: r.references.map(o => ({ id: o.id, name: `${o.functionName} / ${o.name}` })),
      }] });
    }
    case "expansion-progress":
      return c.operation?.id === a.id && c.operation.kind === "expand"
        ? withConversation(p, { ...c, expansionPreview: a.text }) : p;
    case "failed": return c.operation?.id === a.id ? failed(p, c.operation, a.message) : p;
    case "cancel": {
      if (c.operation?.id !== a.id) return p;
      return withConversation(p, { ...c, operation: null, expansionPreview: null, error: null, prompt: c.prompt || c.operation.prompt, prdNameHint: c.prompt ? c.prdNameHint : c.operation.mode === "PRD" ? c.operation.featureName : null, notice: c.operation.kind === "expand" ? "已停止扩写等待或逐字回填，原输入已恢复。已发出的 Agent 推理不保证随之取消。" : "本次请求已停止，没有创建新对象。" });
    }
    case "success": {
      const r = c.operation;
      if (!r || r.id !== a.id) return p;
      const conflict = validateConversationRequest(p, r);
      if (conflict) return failed(p, r, conflict);
      if (r.kind === "expand") {
        if (!a.response.expandedPrompt?.trim()) return failed(p, r, "扩写结果为空，原输入已保留。");
        return withConversation(p, { ...c, operation: null, expansionPreview: null, error: null, prompt: a.response.expandedPrompt, prdNameHint: r.mode === "PRD" ? r.featureName : null, notice: a.response.expansionSource === "agent" ? "扩写完成，已回填输入框，未自动发送。" : "提示词已模拟扩写，仅回填输入框，尚未提交。" });
      }
      const work = a.response.work;
      if (r.mode && (!work || work.kind !== r.mode || work.featureId !== r.featureId || work.featureName !== r.featureName || !('document' in work.session) || !work.session.document)) return failed(p, r, "生成结果与本次功能信息不一致，没有创建对象。");
      if (!r.mode && work) return failed(p, r, "普通问答不会隐式创建对象，请使用明确的生成入口。");
      if (work && (p.works[work.id] || work.kind === "UC" && work.sourcePrdWorkId !== r.sourcePrd?.workId)) return failed(p, r, "对象标识或来源冲突，没有覆盖现有对象。");
      const message: ConversationMessage = { id: `${r.id}-assistant`, role: "assistant", content: a.response.message, ...(work ? { result: { workId: work.id, label: `${work.kind} · ${work.featureName}` } } : {}) };
      const next = withConversation(p, { ...c, operation: null, error: null, mode: work ? null : c.mode, featureId: work ? null : c.featureId, messages: [...c.messages, message], notice: "" });
      if (!work) return next;
      const tabs = [...p.tabs]; tabs.splice(p.activeId ? tabs.indexOf(p.activeId) + 1 : tabs.length, 0, work.id);
      return { ...next, works: { ...p.works, [work.id]: work }, tabs, activeId: work.id, mru: [work.id, ...p.mru.filter(id => id !== work.id)] };
    }
  }
}
