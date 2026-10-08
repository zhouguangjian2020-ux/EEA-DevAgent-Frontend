import { request } from "../../lib/api/client";

export type SourceRef = { uc_id: string; uc_revision_id: string };
export type UcBody = {
  kind: "UC"; name: string; prd_revision_id: string; description?: string; actors?: string;
  preconditions?: string; main_flow?: string; branches?: string[]; exceptions?: string[];
  postconditions?: string; extensions?: string; hmi?: string; regulations?: string; performance?: string; nonfunctional?: string;
};
export type FrBody = { kind: "FR"; description: string; acceptance_criteria?: string; sources: SourceRef[] };
export type ManualContent = { kind: "PRD"; markdown_body: string } | UcBody | FrBody;
export type ManualCreate = { creation_id: string } & (
  { kind: "function"; name: string; description: string } |
  { kind: "PRD"; name: string } | UcBody | FrBody
);
export type SaveInput = { mutation_id: string; base_revision_id: string; content: ManualContent };
export type AcceptInput = { mutation_id: string; revision_id: string };
export type WriteResult = { function_id: string; artifact_id: string | null; revision_id: string | null; created: boolean };

const headers = { "X-Project-Request": "1" };
export function createManualWork(project: string, featureId: string | undefined, input: ManualCreate) {
  if (input.kind === "function") {
    return request<WriteResult>("/v1/projects/" + project + "/functions", {
      method: "POST", headers, body: JSON.stringify({ creation_id: input.creation_id, name: input.name, description: input.description }),
    });
  }
  if (!featureId) throw new Error("请选择功能");
  return request<WriteResult>("/v1/projects/" + project + "/functions/" + featureId + "/artifacts", { method: "POST", headers, body: JSON.stringify(input) });
}
export function saveManualRevision(project: string, artifactId: string, input: SaveInput) {
  return request<WriteResult>("/v1/projects/" + project + "/artifacts/" + artifactId + "/revisions", { method: "POST", headers, body: JSON.stringify(input) });
}
export function acceptManualRevision(project: string, artifactId: string, input: AcceptInput) {
  return request<WriteResult>("/v1/projects/" + project + "/artifacts/" + artifactId + "/accept", { method: "POST", headers, body: JSON.stringify(input) });
}
