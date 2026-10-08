import type { FrOverviewSession } from "../fr/model";
import type { UcContent } from "../uc/model";

export type PanoramaKind = "UC_OVERVIEW" | "FR_ALLOCATION_OVERVIEW";
export type PanoramaAction = { type: "prompt"; value: string } | { type: "discuss"; messageId: string };
export function panoramaTitle(kind: PanoramaKind) { return kind === "UC_OVERVIEW" ? "UC 全景视图" : "FR 分配全景视图"; }
export function panoramaId(featureId: string, kind: PanoramaKind) { return `panorama:${encodeURIComponent(featureId)}:${kind}`; }
export function createPanoramaSession(feature: string, kind: PanoramaKind): FrOverviewSession {
  return { prompt: "", messages: [{ id: "intro", role: "assistant", content: kind === "UC_OVERVIEW"
    ? `「${feature}」的用例图由源 UC 自动生成并同步。只能查看，不可编辑或点击图中节点。` : `「${feature}」的分配表只允许通过子系统下拉调整关系。前三列只读；预置名单暂用演示数据。` }], operation: null, error: null, notice: "" };
}
export function transitionPanorama(s: FrOverviewSession, a: PanoramaAction, kind: PanoramaKind): FrOverviewSession {
  if (a.type === "prompt") return { ...s, prompt: a.value };
  if (!s.prompt.trim()) return s;
  return { ...s, prompt: "", messages: [...s.messages,
    { id: a.messageId + "-user", role: "user", content: s.prompt.trim() },
    { id: a.messageId + "-assistant", role: "assistant", content: kind === "UC_OVERVIEW"
      ? "已记录你的问题（本地演示，未调用 AI）。本图由当前业务功能的已保存 UC 自动推导；需要调整源内容，请从左侧打开对应 UC。图本身保持只读。"
      : "已记录你的问题（本地演示，未调用 AI）。请在子系统名称下拉中修改当前 FR 的分配；这里不会通过对话改写 FR 原文或自动分配。" }], notice: "对话只在本页内保留；真实 AI 与持久化服务尚未接入。" };
}
export type DiagramRow = { id: string; content: UcContent };
export function diagramActors(rows: DiagramRow[]) {
  const actors = new Map<string, string[]>();
  for (const row of rows) {
    // Only split explicit list separators; never infer actors from narrative text.
    const names = [...new Set(row.content.actors.split(/[、,，;；\n]+/).map(x => x.trim()).filter(Boolean))];
    for (const name of names.length ? names : ["未填写参与者"]) actors.set(name, [...(actors.get(name) ?? []), row.id]);
  }
  return [...actors].map(([name, ids]) => ({ name, ids }));
}
