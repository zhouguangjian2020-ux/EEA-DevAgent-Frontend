import { request } from "../../lib/api/client";
import { assertSafeRequirementDiagram } from "../panorama/mermaid-safety";

export const REQUIREMENT_DIAGRAM_SCENE = "FROM_SS_ASSIGNMENT_CREATE_REQ_DIAGRAM" as const;
export type RequirementDiagramResult = {
  generation_id: string;
  scene: typeof REQUIREMENT_DIAGRAM_SCENE;
  status: "empty" | "succeeded";
  source: { project_id: string; function_id: string; subsystem_id: string; subsystem_name: string; allocation_count: number; fr_count: number };
  source_version: string;
  markdown?: string | null;
  diagram_format?: "mermaid" | null;
  diagram_code?: string | null;
};
export type RequirementDiagramInput = { projectId: string; functionId: string; subsystemId: string; clientRequestId: string };

export function validateRequirementDiagram(value: RequirementDiagramResult, input: RequirementDiagramInput) {
  if (!value || value.scene !== REQUIREMENT_DIAGRAM_SCENE || value.generation_id !== input.clientRequestId
      || value.source?.project_id !== input.projectId || value.source?.function_id !== input.functionId
      || value.source?.subsystem_id !== input.subsystemId || !/^[a-f0-9]{64}$/.test(value.source_version)
      || typeof value.source.subsystem_name !== "string"
      || ![value.source.fr_count, value.source.allocation_count].every(n => Number.isInteger(n) && n >= 0 && n <= 100))
    throw new Error("需求图结果与当前项目、功能或子系统不匹配，未应用结果");
  if (value.status === "empty") {
    if (value.source.fr_count !== 0 || value.source.allocation_count !== 0 || value.diagram_code || value.markdown)
      throw new Error("需求图空结果与来源数量不一致");
  } else if (value.status === "succeeded" && value.source.fr_count > 0 && value.source.allocation_count > 0
      && value.diagram_format === "mermaid" && typeof value.diagram_code === "string"
      && typeof value.markdown === "string" && value.markdown.trim() && value.markdown.length <= 200000) {
    assertSafeRequirementDiagram(value.diagram_code);
  } else throw new Error("Agent未返回完整的子系统需求图");
  return value;
}

export async function requestRequirementDiagram(input: RequirementDiagramInput, signal: AbortSignal) {
  const value = await request<RequirementDiagramResult>("/v1/agent/requirement-diagram", {
    method: "POST", signal,
    headers: { "X-Project-Request": "1", "Idempotency-Key": input.clientRequestId },
    body: JSON.stringify({ scene: REQUIREMENT_DIAGRAM_SCENE, project_id: input.projectId,
      function_id: input.functionId, subsystem_id: input.subsystemId, client_request_id: input.clientRequestId }),
  });
  return validateRequirementDiagram(value, input);
}
