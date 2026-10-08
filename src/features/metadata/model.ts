import type { MetadataPatchInput } from "../../lib/api/client";

export type MetadataDraft = { name: string; description: string; baseVersion: string; originalName: string; originalDescription: string };
export type MetadataAttempt<T> = { input: MetadataPatchInput; result?: T };
export function metadataDraft(resource: { name: string; description?: string | null; lock_version?: string }): MetadataDraft {
  return { name: resource.name, description: resource.description ?? "", originalName: resource.name, originalDescription: resource.description ?? "", baseVersion: resource.lock_version ?? "0" };
}
export function metadataDirty(draft?: MetadataDraft) {
  return Boolean(draft && (draft.name !== draft.originalName || draft.description !== draft.originalDescription));
}
export function metadataError(name: string, description: string, kind: "项目" | "功能") {
  if (name.includes("\0") || description.includes("\0")) return "名称和描述不能包含空字符。";
  const length = Array.from(name.trim()).length;
  if (length < 1 || length > 100) return kind + "名称需为1～100个字符，不能只有空格。";
  if (Array.from(description.trim()).length > 2000) return (kind === "项目" ? "项目简介" : "功能描述") + "不能超过2000个字符。";
  return "";
}
export function metadataInput(draft: MetadataDraft, mutationId: string): MetadataPatchInput {
  return { mutation_id: mutationId, base_lock_version: draft.baseVersion, name: draft.name.trim(), description: draft.description.trim() || null };
}
export function newerVersion(incoming?: string, current?: string) {
  // Missing versions are only for legacy Mock data. Never parse database bigint as Number.
  return !incoming || !current || BigInt(incoming) >= BigInt(current);
}
