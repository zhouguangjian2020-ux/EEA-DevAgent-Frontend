import { getProjectWorkspace, type ProjectWorkspace, type WorkspaceFunction } from "@/lib/api/client";
import { createPanoramaSession, panoramaId } from "../panorama/model";
import { createPrdSession, type PrdDocument } from "../prd/model";
import { createUcSession, type UcDocument } from "../uc/model";
import { createFrOverviewSession, createFrSession, type FrDocument } from "../fr/model";
import { createUcDiagramState, featureOverviewId, type BusinessFeature, type ObjectWork, type AllocationSubsystem } from "./model";

function revisionNumber(revisionNo: string) {
  const value = Number(revisionNo);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function status(value: string): "pending" | "accepted" {
  return value === "accepted" ? "accepted" : "pending";
}

function buildPrd(workspace: ProjectWorkspace, feature: WorkspaceFunction): ObjectWork | null {
  const prd = feature.prd;
  if (!prd) return null;
  const document: PrdDocument = { id: prd.id, functionName: feature.name, content: prd.markdown_body, revision: revisionNumber(prd.revision.revision_no), status: status(prd.revision.status) };
  return {
    id: "db-prd-" + feature.id, kind: "PRD", featureId: feature.id, featureName: feature.name,
    attachments: [], readOnly: false, database: databaseMeta(workspace, "PRD", prd),
    session: { ...createPrdSession(), rootName: feature.name, document, selected: false, notice: "" }, ucTask: null,
  };
}

function databaseMeta(workspace: ProjectWorkspace, kind: string, object: { id: string; lock_version?: string; can_delete?: boolean; revision: { revision_id: string; accepted_revision_id?: string | null } }) {
  return { artifactId: object.id, lockVersion: object.lock_version ?? "0", revisionId: object.revision.revision_id, acceptedRevisionId: object.revision.accepted_revision_id,
    canUpdate: Boolean(workspace.capabilities?.includes(kind + ".update")), canAccept: Boolean(workspace.capabilities?.includes(kind + ".accept")), canDelete: Boolean(object.can_delete && workspace.capabilities?.includes(kind + ".archive")) };
}

function buildUc(workspace: ProjectWorkspace, feature: WorkspaceFunction, prdWorkId: string, uc: WorkspaceFunction["use_cases"][number]): ObjectWork {
  const document: UcDocument = {
    id: uc.id,
    featureName: feature.name,
    revision: revisionNumber(uc.revision.revision_no),
    status: status(uc.revision.status),
    content: {
      sourcePrdRevisionId: uc.prd_revision_id,
      name: uc.name,
      description: uc.description,
      number: uc.code,
      actors: uc.actors,
      preconditions: uc.preconditions,
      mainFlow: uc.main_flow,
      branches: [...uc.branches],
      exceptions: [...uc.exceptions],
      postconditions: uc.postconditions,
      extensions: uc.extensions,
      hmi: uc.hmi,
      regulations: uc.regulations,
      performance: uc.performance,
      nonfunctional: uc.nonfunctional,
    },
  };
  return {
    id: `db-uc-${uc.id}`,
    kind: "UC",
    featureId: feature.id,
    featureName: feature.name,
    attachments: [],
    readOnly: false, database: databaseMeta(workspace, "UC", uc),
    objectId: uc.id,
    number: uc.code,
    originalName: uc.name,
    sourcePrdWorkId: prdWorkId,
    session: { ...createUcSession(document), selected: false, notice: "" },
  };
}

function buildFr(workspace: ProjectWorkspace, feature: WorkspaceFunction, overviewId: string, fr: WorkspaceFunction["functional_requirements"][number]): ObjectWork {
  const sourceName = fr.sources.length ? fr.sources.map(source => source.uc_code).join("、") : "无来源";
  const document: FrDocument = {
    id: fr.id,
    featureName: feature.name,
    revision: revisionNumber(fr.revision.revision_no),
    status: status(fr.revision.status),
    content: { id: fr.code, source: sourceName, description: fr.description, sources: fr.sources.map(s => ({ uc_id: s.uc_id, uc_revision_id: s.uc_revision_id })), acceptanceCriteria: fr.acceptance_criteria ?? "" },
  };
  return {
    id: `db-fr-${fr.id}`,
    kind: "FR",
    featureId: feature.id,
    featureName: feature.name,
    attachments: [],
    readOnly: false, database: databaseMeta(workspace, "FR", fr),
    objectId: fr.id,
    number: fr.code,
    originalName: fr.description.slice(0, 40),
    sourceOverviewId: overviewId,
    sourceUcWorkId: fr.sources[0] ? `db-uc-${fr.sources[0].uc_id}` : undefined,
    session: { ...createFrSession(document), selected: false, notice: "" },
  };
}

function buildFunctionWorks(workspace: ProjectWorkspace, feature: WorkspaceFunction): ObjectWork[] {
  const prd = buildPrd(workspace, feature);
  const ucWorks = feature.use_cases.map(uc => buildUc(workspace, feature, "db-prd-" + feature.id, uc));
  const ucOverviewId = panoramaId(feature.id, "UC_OVERVIEW");
  const ucOverview: ObjectWork = {
    id: ucOverviewId,
    sourceMode: 'database',
    kind: "UC_OVERVIEW",
    featureId: feature.id,
    featureName: feature.name,
    attachments: [],
    readOnly: true,
    session: { ...createPanoramaSession(feature.name, "UC_OVERVIEW"), notice: "UC 全景基于当前功能的数据库用例绘制。" },
    frBatch: null,
    ucDiagram: createUcDiagramState(),
  };
  const frOverviewId = `${feature.id}-fr-overview`;
  const frWorks = feature.functional_requirements.map(fr => buildFr(workspace, feature, frOverviewId, fr));
  const frOverview: ObjectWork = {
    id: frOverviewId,
    kind: "FR_OVERVIEW",
    featureId: feature.id,
    featureName: feature.name,
    attachments: [],
    readOnly: true,
    rows: feature.functional_requirements.map(fr => ({ id: fr.code, source: fr.sources.map(source => source.uc_code).join("、") || "无来源", description: fr.description })),
    session: { ...createFrOverviewSession(feature.name), notice: "来自数据库的只读 FR 全景。" },
  };
  const allocations: Record<string, string[]> = {};
  const allocationObjects: Record<string, WorkspaceFunction["fr_allocations"][number]> = {};
  for (const allocation of feature.fr_allocations) {
    allocations[`db-fr-${allocation.fr_id}`] = [...new Set([...(allocations[`db-fr-${allocation.fr_id}`] ?? []), ...allocation.targets.map(target => target.subsystem_id)])];
    allocationObjects[allocation.id] = allocation;
  }
  const subsystems: AllocationSubsystem[] = feature.subsystems.map(subsystem => ({
    id: subsystem.id,
    code: subsystem.code,
    name: subsystem.name,
    domainGroup: subsystem.domain_group,
    isAllocatable: subsystem.is_allocatable,
  }));
  const allocationOverview: ObjectWork = {
    id: panoramaId(feature.id, "FR_ALLOCATION_OVERVIEW"),
    kind: "FR_ALLOCATION_OVERVIEW",
    featureId: feature.id,
    featureName: feature.name,
    attachments: [],
    readOnly: true,
    session: { ...createPanoramaSession(feature.name, "FR_ALLOCATION_OVERVIEW"), notice: "来自数据库的只读 FR 分配全景。" },
    assignments: allocations,
    allocations: allocationObjects,
    subsystems,
  };
  const overview: ObjectWork = { id: featureOverviewId(feature.id), kind: "FEATURE_OVERVIEW", featureId: feature.id, featureName: feature.name, attachments: [], readOnly: true, session: createFrOverviewSession(feature.name) };
  return [overview, ...(prd ? [prd] : []), ucOverview, ...ucWorks, frOverview, ...frWorks, allocationOverview];
}

export function databaseWorkspaceWorks(workspace: ProjectWorkspace) {
  const works = workspace.functions.flatMap(feature => buildFunctionWorks(workspace, feature));
  const first = works.find(work => work.kind === "PRD") ?? works.find(work => work.kind === "UC_OVERVIEW") ?? works[0];
  const features: BusinessFeature[] = workspace.functions.map(f => ({ id: f.id, code: f.code, name: f.name, description: f.description ?? "", lockVersion: f.lock_version, canUpdate: Boolean(f.can_update), ...(f.can_delete ? { canDelete: true } : {}), acceptedPrdRevisionId: f.prd?.revision.accepted_revision_id, acceptedUcs: f.accepted_use_cases ?? [] }));
  return { works, features, capabilities: workspace.capabilities ?? [], openId: first?.id ?? "" };
}

export async function loadDatabaseWorkspace(projectId: string) {
  const workspace = await getProjectWorkspace(projectId);
  return { workspace, ...databaseWorkspaceWorks(workspace) };
}




