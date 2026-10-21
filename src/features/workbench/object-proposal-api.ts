import { request } from "@/lib/api/client";
import type { SaveInput, WriteResult } from "./manual-api";
import { projectPath } from "./workflow-api";
export type AiReviewReceipt = { status: "confirmed" | "not_found"; artifact_id: string; function_id: string; revision_id: string | null };
const path = (project: string, artifact: string) => projectPath(project) + "/artifacts/" + encodeURIComponent(artifact) + "/ai-review";
export function confirmObjectProposal(project: string, artifact: string, input: SaveInput) {
  return request<WriteResult>(path(project, artifact) + "/accept", { method: "POST", headers: { "X-Project-Request": "1" }, body: JSON.stringify(input) });
}
export function readObjectProposalReceipt(project: string, artifact: string, mutationId: string) {
  return request<AiReviewReceipt>(path(project, artifact) + "/" + encodeURIComponent(mutationId));
}
