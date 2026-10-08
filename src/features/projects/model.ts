import { newerVersion } from "../metadata/model";
import type { CreateProjectInput, ProjectSummary } from "../../lib/api/client";

export function projectFormError(name: string, description: string): string {
  const length = Array.from(name.trim()).length;
  if (length < 1 || length > 100) return "项目名称需为1～100个字符，不能只有空格。";
  if (Array.from(description.trim()).length > 2000) return "项目简介不能超过2000个字符。";
  if (name.includes("\0") || description.includes("\0")) return "项目名称和简介不能包含空字符。";
  return "";
}

export function projectSubmission(creationId: string, name: string, description: string): CreateProjectInput {
  return { creation_id: creationId, name: name.trim(), description: description.trim() || null };
}

export function mergeProjects(existing: ProjectSummary[], incoming: ProjectSummary[]): ProjectSummary[] {
  const byId = new Map(existing.map(project => [project.id, project]));
  for (const project of incoming) if (newerVersion(project.lock_version, byId.get(project.id)?.lock_version)) byId.set(project.id, project);
  return [...byId.values()];
}
