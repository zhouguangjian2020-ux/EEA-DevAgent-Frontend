import type { PrdWork } from "../workbench/model";

export type PrdGeneration = {
  id: string;
  status: "streaming" | "succeeded" | "failed" | "cancelled";
  text: string;
  error?: string;
  requestId?: string;
};
export type PrdGenerationAction =
  | { type: "start"; id: string }
  | { type: "progress"; id: string; text: string }
  | { type: "done"; id: string; output: string; requestId: string }
  | { type: "failed"; id: string; message: string }
  | { type: "cancel"; id: string };

export function prdGenerationReason(w: PrdWork, definition: string | undefined): string | null {
  if (!w.database) return "仅数据库项目支持真实 PRD 生成。";
  if (w.readOnly || !w.database.canUpdate) return "当前账号没有 PRD 编辑权限。";
  if (w.prdGeneration?.status === "streaming" || w.session.operation || w.ucTask || w.saving) return "当前对象仍有任务运行，请稍后再试。";
  if (w.session.editDraft !== null || w.session.confirmDiscard) return "请先结束当前编辑或审阅操作。";
  if (w.prdGeneration?.status === "succeeded") return "已生成预览；本轮不覆盖或保存原 PRD。";
  if (!definition?.trim()) return "请先在功能标签页完善并保存功能描述。";
  return null;
}

// Preview is deliberately separate from session.document/editDraft/database revision.
export function reducePrdGeneration(state: PrdGeneration | undefined, action: PrdGenerationAction): PrdGeneration | undefined {
  if (action.type === "start") {
    if (state?.status === "streaming" || state?.status === "succeeded") return state;
    return { id: action.id, status: "streaming", text: "" };
  }
  if (!state || state.id !== action.id || state.status !== "streaming") return state;
  switch (action.type) {
    case "progress": return { ...state, text: action.text };
    case "done": return { ...state, status: "succeeded", text: action.output, requestId: action.requestId };
    case "failed": return { ...state, status: "failed", text: "", error: action.message };
    case "cancel": return { ...state, status: "cancelled", text: "" };
  }
}
