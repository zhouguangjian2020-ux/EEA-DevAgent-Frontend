import type { ManualCreate } from "../features/workbench/manual-api";
import { createPrdSession } from "../features/prd/model";
import { createUcSession } from "../features/uc/model";
import { createFrSession } from "../features/fr/model";
import type { BusinessFeature, ObjectWork } from "../features/workbench/model";

// Explicit local-demo adapter; never called for a database project.
export function mockManualWork(f: BusinessFeature, input: Exclude<ManualCreate, { kind: "function" }>): ObjectWork {
  const id = input.creation_id, number = input.kind + "-" + id.slice(0, 8).toUpperCase();
  const base = { id, featureId: f.id, featureName: f.name, attachments: [] };
  if (input.kind === "PRD") return { ...base, kind: "PRD", ucTask: null, session: { ...createPrdSession(), rootName: f.name, document: { id, functionName: f.name, content: "# " + input.name + "\n", revision: 1, status: "pending" }, notice: "本地手动草稿，未写入数据库。" } };
  if (input.kind === "UC") return { ...base, kind: "UC", objectId: id, number, originalName: input.name, sourcePrdWorkId: "", session: createUcSession({ id, featureName: f.name, revision: 1, status: "pending", content: { number, name: input.name, sourcePrdRevisionId: input.prd_revision_id, description: input.description ?? "", actors: input.actors ?? "", preconditions: input.preconditions ?? "", mainFlow: input.main_flow ?? "", branches: ["", "", "", ""], exceptions: ["", "", "", "", ""], postconditions: input.postconditions ?? "", extensions: "", hmi: "", regulations: "", performance: "", nonfunctional: "" } }) };
  return { ...base, kind: "FR", objectId: id, number, originalName: input.description.slice(0, 40), sourceOverviewId: f.id + "-fr-overview", session: createFrSession({ id, featureName: f.name, revision: 1, status: "pending", content: { id: number, description: input.description, source: input.sources.map(s => s.uc_id).join("、"), sources: input.sources, acceptanceCriteria: input.acceptance_criteria ?? "" } }) };
}
