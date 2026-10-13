import { prdGenerationReason, reducePrdGeneration, type PrdGeneration, type PrdGenerationAction } from "../prd/generation";
import { metadataDraft, metadataDirty, newerVersion, type MetadataDraft, type MetadataAttempt } from "../metadata/model";
import type { FunctionSummary, WorkspaceAllocation } from "../../lib/api/client";
import { synchronizeFeature } from "./feature-metadata";
import { frGenerationGate, snapshotFrSources, sameFrSources, type FrBatchRequest } from "./fr-generation";
import { createConversation, reduceProjectConversation, type ConversationState, type ConversationAction } from "../conversation/model";
import { createPanoramaSession, panoramaId, panoramaTitle, transitionPanorama, type PanoramaKind, type PanoramaAction } from "../panorama/model";
import { PRESET_SUBSYSTEMS } from "../../mocks/subsystems";
import { createPrdSession, transitionPrd, type PrdSession, type PrdAction, type PrdDocument } from "../prd/model";
import { transitionUc, type UcSession, type UcAction } from "../uc/model";
import { createFrOverviewSession, transitionFr, type FrSession, type FrOverviewSession, type FrAction, type FrContent } from "../fr/model";
import { appendAttachments, type WorkspaceObject, type WorkspaceFolder, type WorkspaceNode } from "../workspace/tree";
import type { UcGenerationCandidate } from "./uc-generation-api";

export type BusinessFeature = { hasPrd?: boolean; lockVersion?: string; canUpdate?: boolean; canDelete?: boolean; id: string; name: string; description: string; code?: string; acceptedPrdRevisionId?: string | null; acceptedUcs?: { uc_id: string; uc_revision_id: string; uc_code: string; uc_name: string }[] };
export type DatabaseWork = { artifactId: string; lockVersion: string; revisionId: string; acceptedRevisionId?: string | null; canUpdate: boolean; canAccept: boolean; canDelete: boolean };
export type WorkBase = { id: string; featureId: string; featureName: string; attachments: WorkspaceObject[]; readOnly?: boolean; database?: DatabaseWork; saving?: boolean };
export type PrdWork = WorkBase & { kind: "PRD"; prdGeneration?: PrdGeneration; session: PrdSession; ucTask: string | null; ucRequestFeedback?: { requestId: string; featureName: string; message?: string }; ucBatchSource?: PrdDocument; ucBatchComplete?: boolean; ucGenerationCandidates?: UcGenerationCandidate[] };
export type UcWork = WorkBase & { kind: "UC"; session: UcSession; objectId: string; number: string; originalName: string; sourcePrdWorkId: string };
export type FrOverviewWork = WorkBase & { kind: "FR_OVERVIEW"; rows: FrContent[]; session: FrOverviewSession };
export type FrWork = WorkBase & { kind: "FR"; session: FrSession; objectId: string; number: string; originalName: string; sourceOverviewId: string; sourceUcWorkId?: string };
export type UcDiagramStatus = "idle" | "loading" | "empty" | "unchanged" | "succeeded" | "error";
export type UcDiagramState = {
  status: UcDiagramStatus;
  requestId: string | null;
  sourceVersion: string | null;
  ucCount: number | null;
  diagramFormat: "mermaid" | null;
  diagramCode: string | null;
  message: string | null;
};
export function createUcDiagramState(): UcDiagramState {
  return { status: "idle", requestId: null, sourceVersion: null, ucCount: null, diagramFormat: null, diagramCode: null, message: null };
}
export type UcOverviewWork = WorkBase & { sourceMode?: "database"; kind: "UC_OVERVIEW"; session: FrOverviewSession; frBatch?: FrBatchRequest | null; frBatchComplete?: boolean; frValidationShown?: boolean; ucDiagram: UcDiagramState };
export type AllocationSubsystem = { id: string; code: string; name: string; domainGroup: string | null; isAllocatable: boolean };
export type FrAllocationWork = WorkBase & { selectedAllocationId?: string; allocationPreviews?: import("./allocation-review").AllocationPreview[]; selectedSubsystemId?: string; kind: "FR_ALLOCATION_OVERVIEW"; session: FrOverviewSession; assignments: Record<string, string[]>; allocations: Record<string, WorkspaceAllocation>; subsystems: AllocationSubsystem[] };
export type PanoramaWork = UcOverviewWork | FrAllocationWork;
export type FeatureWork = WorkBase & { kind: "FEATURE_OVERVIEW"; session: FrOverviewSession; metadataDraft?: MetadataDraft; metadataAttempt?: MetadataAttempt<FunctionSummary>; metadataConflict?: boolean };
export type ObjectWork = FeatureWork | PrdWork | UcWork | FrOverviewWork | FrWork | PanoramaWork;
export function isPanorama(w: ObjectWork): w is PanoramaWork { return w.kind === "UC_OVERVIEW" || w.kind === "FR_ALLOCATION_OVERVIEW"; }
export function workStage(w: ObjectWork) { return w.kind === "PRD" ? "PRD生成" : w.kind === "UC" || w.kind === "UC_OVERVIEW" ? "用例生成" : w.kind === "FR_ALLOCATION_OVERVIEW" ? "功能分配" : "功能设计"; }
export function workCategory(w: ObjectWork): "PRD" | "UC" | "FR" | "FR分配" { return w.kind === "PRD" ? "PRD" : w.kind === "UC" || w.kind === "UC_OVERVIEW" ? "UC" : w.kind === "FR_ALLOCATION_OVERVIEW" ? "FR分配" : "FR"; }
export function workBadge(w: ObjectWork) { return w.kind === "FEATURE_OVERVIEW" ? "功能" : workCategory(w); }
export type CloseRequest = { id: string; reason: "dirty" | "running" };
export type ProjectWorks = { deletedArtifactIds?: string[]; deletedFeatureIds?: string[]; features: Record<string, BusinessFeature>; capabilities?: string[]; frBatchReveal?: { workId: string; requestId: string }; ucBatchReveal?: { workId: string; requestId: string; sidebarOnly?: boolean }; conversation: ConversationState; works: Record<string, ObjectWork>; tabs: string[]; activeId: string | null; mru: string[]; closeRequest: CloseRequest | null; notice: string };
export type WorkbenchStore = Record<string, ProjectWorks>;
export function forgetDeletedProjects(store: WorkbenchStore, ids: readonly string[]): WorkbenchStore {
  if (!ids.some(id => id in store)) return store;
  const next = { ...store };
  for (const id of ids) delete next[id];
  return next;
}
export type CloseChoice = "cancel" | "save" | "discard" | "stop";
export type WorkbenchAction =
  | { type: "prd-generation"; id: string; action: PrdGenerationAction }
  | { type: "feature-edit"; id: string }
  | { type: "feature-field"; id: string; field: "name" | "description"; value: string }
  | { type: "feature-cancel"; id: string }
  | { type: "feature-updated"; feature: BusinessFeature }
  | { type: "open-feature"; featureId: string }
  | { type: "manual-feature"; feature: BusinessFeature }
  | { type: "manual-work"; work: ObjectWork }
  | { type: "replace-work"; work: ObjectWork }
  | { type: "conversation"; action: ConversationAction }
  | { type: "open-fr-overview"; featureId: string }
  | { type: "open-panorama"; kind: PanoramaKind; featureId: string; featureName: string; subsystemId?: string; allocationId?: string }
  | { type: "allocation-previews"; featureId: string; previews: import("./allocation-review").AllocationPreview[]; subsystems?: AllocationSubsystem[] }
  | { type: "panorama"; id: string; action: PanoramaAction }
  | { type: "assign-fr"; id: string; frId: string; subsystemIds: string[] }
  | { type: "new-prd"; id: string; featureId: string; name: string }
  | { type: "seed"; works: ObjectWork[]; openId: string }
  | { type: "database-seed"; works: ObjectWork[]; openId?: string; features?: BusinessFeature[]; capabilities?: string[]; savedId?: string; removedArtifactIds?: string[]; removedFeatureIds?: string[] }
  | { type: "open"; id: string } | { type: "home" }
  | { type: "close"; id: string } | { type: "resolve-close"; id: string; choice: CloseChoice }
  | { type: "reorder"; id: string; beforeId: string }
  | { type: "prd"; id: string; action: PrdAction } | { type: "uc"; id: string; action: UcAction } | { type: "fr"; id: string; action: FrAction }
  | { type: "fr-seed"; featureId: string; featureName: string; works: ObjectWork[] }
  | { type: "fr-overview"; id: string; action: FrAction }
  | { type: "attach"; id: string; objects: WorkspaceObject[] } | { type: "remove-attachment"; id: string; objectId: string }
  | { type: "fr-batch-start"; id: string; taskId: string }
  | { type: "fr-batch-ready"; id: string; taskId: string; works: FrWork[] }
  | { type: "fr-batch-failed"; id: string; taskId: string; message: string }
  | { type: "uc-start"; id: string; taskId: string }
  | { type: "uc-ready"; id: string; taskId: string; works: UcWork[] }
  | { type: "uc-candidates-ready"; id: string; taskId: string; candidates: UcGenerationCandidate[] }
  | { type: 'uc-appended'; id: string; taskId: string; count: number }
  | { type: "uc-failed"; id: string; taskId: string; message: string }
  | { type: "uc-diagram-start"; id: string; taskId: string }
  | { type: "uc-diagram-ready"; id: string; taskId: string; state: UcDiagramState }
  | { type: "uc-diagram-failed"; id: string; taskId: string; message: string }
  | { type: "uc-diagram-cancel"; id: string; taskId: string; message: string }
  | { type: "notice"; message: string };
export function createProjectWorks(): ProjectWorks { return { features: {}, conversation: createConversation(), works: {}, tabs: [], activeId: null, mru: [], closeRequest: null, notice: "" }; }
export const EMPTY_PROJECT = createProjectWorks();
export function normalizeFeatureName(name: string) { return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
export function workLabel(w: ObjectWork, ui: (value: string) => string = value => value) {
  if (w.kind === "FEATURE_OVERVIEW") return `${ui("功能全景视图")} · ${w.featureName}`;
  if (isPanorama(w)) return `${ui(panoramaTitle(w.kind))} · ${w.featureName}`;
  if (w.kind === "PRD") return `${w.session.document ? "PRD" : ui("新建 PRD")} · ${w.featureName}`;
  if (w.kind === "FR_OVERVIEW") return `${ui("FR全景视图")} · ${w.featureName}`;
  if (w.kind === "FR") return `${w.number} · ${w.originalName}`;
  return `${w.number} · ${w.session.document?.content.name ?? w.originalName}`;
}
export function workObject(w: ObjectWork): WorkspaceObject | null {
  if (w.kind === "FEATURE_OVERVIEW" || isPanorama(w)) return null;
  if (w.kind === "FR_OVERVIEW") return { id: w.id, type: "object", kind: "FR", name: "FR全景视图", functionName: w.featureName, summary: `${w.rows.length} 条功能需求`, status: "pending", selectable: false, interactive: false };
  if (w.kind === "PRD") {
    if (!w.session.document) return null;
    return { id: w.session.document.id, type: "object", kind: "PRD", name: "PRD", functionName: w.featureName, summary: w.session.document.content, status: w.session.document.status, featureId: w.featureId, workId: w.id, deletion: w.database ? { kind: "PRD", id: w.database.artifactId, lockVersion: w.database.lockVersion, canDelete: w.database.canDelete, label: workLabel(w), featureId: w.featureId, workId: w.id } : undefined };
  }
  if (w.kind === "FR") return w.session.document ? { id: w.objectId, type: "object", kind: "FR", name: `${w.number} · ${w.originalName}`, functionName: w.featureName, summary: w.session.document.content.description, status: w.session.document.status, featureId: w.featureId, workId: w.id, deletion: w.database ? { kind: "FR", id: w.database.artifactId, lockVersion: w.database.lockVersion, canDelete: w.database.canDelete, label: workLabel(w), featureId: w.featureId, workId: w.id } : undefined } : null;
  if (!w.session.document) return null;
  return { id: w.objectId, type: "object", kind: "UC", name: `${w.number} · ${w.session.document!.content.name}`, functionName: w.featureName, summary: w.session.document!.content.description, status: w.session.document!.status, featureId: w.featureId, workId: w.id, deletion: w.database ? { kind: "UC", id: w.database.artifactId, lockVersion: w.database.lockVersion, canDelete: w.database.canDelete, label: workLabel(w), featureId: w.featureId, workId: w.id } : undefined };
}export function findObjectWork(p: ProjectWorks, objectId: string) { return Object.values(p.works).find(w => workObject(w)?.id === objectId); }
export function isWorkDirty(w: ObjectWork) {
  if (w.kind === "FEATURE_OVERVIEW") return metadataDirty(w.metadataDraft) || Boolean(w.metadataAttempt);
  if (w.kind === "FR_OVERVIEW" || isPanorama(w)) return false;
  return w.kind === "PRD" ? w.session.editDraft !== null && w.session.editDraft !== w.session.document?.content
    : w.session.editDraft !== null && JSON.stringify(w.session.editDraft) !== JSON.stringify(w.session.document?.content);
}
function sameBatchSource(w: PrdWork) {
  const doc = w.session.document, source = w.ucBatchSource;
  return Boolean(doc && source && doc.id === source.id && doc.revision === source.revision && doc.content === source.content);
}
export function hasGeneratedUcBatch(w: PrdWork) { return !w.database && Boolean(w.ucBatchComplete && sameBatchSource(w)); }
export function canGenerateUcBatch(w: PrdWork) {
  return w.session.document?.status === "accepted" && w.prdGeneration?.status !== "streaming" && !w.ucTask && !w.session.operation && w.session.editDraft === null && !w.session.confirmDiscard && !hasGeneratedUcBatch(w);
}
export function isWorkRunning(w: ObjectWork) { return Boolean(w.saving || w.session.operation || (w.kind === "PRD" && (w.ucTask || w.prdGeneration?.status === "streaming")) || (w.kind === "UC_OVERVIEW" && (w.frBatch || w.ucDiagram.status === "loading"))); }
function activate(p: ProjectWorks, id: string): ProjectWorks {
  if (!p.works[id]) return p;
  const tabs = [...p.tabs]; if (!tabs.includes(id)) tabs.splice(p.activeId ? tabs.indexOf(p.activeId) + 1 : tabs.length, 0, id);
  return { ...p, activeId: id, tabs, mru: [id, ...p.mru.filter(x => x !== id)], notice: "" };
}
function closeNow(p: ProjectWorks, id: string): ProjectWorks {
  const tabs = p.tabs.filter(x => x !== id), mru = p.mru.filter(x => x !== id);
  // Closing is only a view operation. Keep the object's session, content and attachments.
  return { ...p, tabs, mru, activeId: p.activeId === id ? mru.find(x => tabs.includes(x)) ?? tabs.at(-1) ?? null : p.activeId, closeRequest: null };
}
function update(p: ProjectWorks, work: ObjectWork): ProjectWorks { return { ...p, works: { ...p.works, [work.id]: work } }; }
export function transitionWorkbench(p: ProjectWorks, a: WorkbenchAction): ProjectWorks {
  if ((a.type === "feature-updated" || a.type === "manual-feature") && p.deletedFeatureIds?.includes(a.feature.id)) return p;
  if ((a.type === "replace-work" || a.type === "manual-work") &&
      (p.deletedFeatureIds?.includes(a.work.featureId) || (a.work.database && p.deletedArtifactIds?.includes(a.work.database.artifactId)))) return p;
  switch (a.type) {
    case "feature-updated": return synchronizeFeature(p, a.feature);
    case "feature-edit": {
      const w = p.works[a.id];
      if (w?.kind !== "FEATURE_OVERVIEW" || w.saving || w.metadataDraft) return p;
      const f = p.features[w.featureId];
      if (!f || (p.capabilities && !p.capabilities.includes("function.update"))) return p;
      return update(p, { ...w, metadataDraft: metadataDraft({ ...f, lock_version: f.lockVersion }), metadataConflict: false, session: { ...w.session, notice: "" } });
    }
    case "feature-field": {
      const w = p.works[a.id];
      return w?.kind === "FEATURE_OVERVIEW" && w.metadataDraft && !w.saving && !w.metadataAttempt ? update(p, { ...w, metadataDraft: { ...w.metadataDraft, [a.field]: a.value } }) : p;
    }
    case "feature-cancel": {
      const w = p.works[a.id];
      return w?.kind === "FEATURE_OVERVIEW" && !w.saving && !w.metadataAttempt ? update(p, { ...w, metadataDraft: undefined, metadataConflict: false, session: { ...w.session, notice: "" } }) : p;
    }
    case "manual-feature": {
      if (p.features[a.feature.id]) return transitionWorkbench(p, { type: "open-feature", featureId: a.feature.id });
      return transitionWorkbench({ ...p, features: { ...p.features, [a.feature.id]: a.feature } }, { type: "open-feature", featureId: a.feature.id });
    }
    case "manual-work": return activate(update(p, a.work), a.work.id);
    case "replace-work": return update(p, a.work);
    case "open-feature": {
      const f = projectFeatures(p).find(f => f.id === a.featureId);
      if (!f) return p;
      const id = featureOverviewId(f.id);
      const w: FeatureWork = { id, kind: "FEATURE_OVERVIEW", featureId: f.id, featureName: f.name, attachments: [], session: createFrOverviewSession(f.name) };
      return activate(p.works[id] ? p : update(p, w), id);
    }
    case "conversation": return reduceProjectConversation(p, a.action);
    case "open-fr-overview": {
      const f = projectFeatures(p).find(f => f.id === a.featureId);
      const source = f ? { featureId: f.id, featureName: f.name } : undefined;
      if (!source) return p;
      const id = `${a.featureId}-fr-overview`;
      const existing = Object.values(p.works).find(w => w.kind === "FR_OVERVIEW" && w.featureId === a.featureId);
      if (existing) return activate(p, existing.id);
      const work: FrOverviewWork = { id, kind: "FR_OVERVIEW", featureId: source.featureId, featureName: source.featureName, attachments: [], rows: [], session: createFrOverviewSession(source.featureName) };
      return activate(update(p, work), id);
    }
    case "allocation-previews": {
      const id = panoramaId(a.featureId, "FR_ALLOCATION_OVERVIEW"), work = p.works[id];
      if (work?.kind !== "FR_ALLOCATION_OVERVIEW") return p;
      const deleted = new Set(p.deletedArtifactIds ?? []);
      const previews = a.previews.filter(row => !deleted.has(row.allocationId) && !deleted.has(row.frId));
      const subsystems = a.subsystems ?? work.subsystems;
      if (JSON.stringify(work.allocationPreviews ?? []) === JSON.stringify(previews)
        && JSON.stringify(work.subsystems) === JSON.stringify(subsystems)) return p;
      return update(p, { ...work, allocationPreviews: previews, subsystems });
    }
    case "open-panorama": {
      const f = projectFeatures(p).find(f => f.id === a.featureId);
      const source = f ? { featureId: f.id, featureName: f.name } : undefined;
      if (!source) return p;
      const id = panoramaId(a.featureId, a.kind);
      const existing = p.works[id];
      if (existing) return activate(existing.kind === "FR_ALLOCATION_OVERVIEW"
        ? update(p, { ...existing, selectedSubsystemId: a.subsystemId, selectedAllocationId: a.allocationId }) : p, id);
      const base = { selectedSubsystemId: a.subsystemId, selectedAllocationId: a.allocationId, id, featureId: source.featureId, featureName: source.featureName, attachments: [], session: createPanoramaSession(source.featureName, a.kind) };
      const work: PanoramaWork = a.kind === "UC_OVERVIEW" ? { ...base, kind: a.kind, ucDiagram: createUcDiagramState() } : { ...base, kind: a.kind, assignments: {}, allocations: {}, subsystems: [] };
      return activate(update(p, work), id);
    }
    case "panorama": {
      const w = p.works[a.id];
      return w && isPanorama(w) && !w.readOnly ? update(p, { ...w, session: transitionPanorama(w.session, a.action, w.kind) }) : p;
    }
    case "assign-fr": {
      const w = p.works[a.id], fr = p.works[a.frId];
      if (w?.readOnly) return p;
      if (w?.kind !== "FR_ALLOCATION_OVERVIEW" || fr?.kind !== "FR" || fr.featureId !== w.featureId || !fr.session.document) return p;
      const allowed = new Set<string>(PRESET_SUBSYSTEMS.map(s => s.id));
      if (a.subsystemIds.some(id => !allowed.has(id))) return p;
      return update(p, { ...w, assignments: { ...w.assignments, [fr.id]: [...new Set(a.subsystemIds)] } });
    }
    case "new-prd": {
      const name = a.name.trim().replace(/\s+/g, " ");
      if (!name || name.length > 64) return { ...p, notice: "请输入 1～64 字的业务功能名称。" };
      const existing = Object.values(p.works).find(w => w.kind === "PRD" && normalizeFeatureName(w.featureName) === normalizeFeatureName(name));
      if (existing) return { ...activate(p, existing.id), notice: "同名业务功能已有 PRD 工作，已打开原标签。" };
      if (p.works[a.id]) return p;
      const w: PrdWork = { id: a.id, featureId: a.featureId, featureName: name, kind: "PRD", session: { ...createPrdSession(), rootName: name }, attachments: [], ucTask: null };
      return activate(update(p, w), w.id);
    }
    case "database-seed": {
      const removedArtifacts = new Set([...(p.deletedArtifactIds ?? []), ...(a.removedArtifactIds ?? [])]);
      const removedFeatures = new Set([...(p.deletedFeatureIds ?? []), ...(a.removedFeatureIds ?? [])]);
      const isRemoved = (w: ObjectWork) => removedFeatures.has(w.featureId) || Boolean(w.database && removedArtifacts.has(w.database.artifactId)) || ("objectId" in w && removedArtifacts.has(w.objectId));
      const works = Object.fromEntries(Object.entries(p.works).filter(([, w]) => !isRemoved(w))) as Record<string, ObjectWork>;
      for (const w of a.works) {
        if (isRemoved(w)) continue;
        const previous = works[w.id];
        if (w.id !== a.savedId && previous && (isWorkDirty(previous) || isWorkRunning(previous) || (previous.kind === "FEATURE_OVERVIEW" && previous.metadataDraft) || ("editDraft" in previous.session && previous.session.editDraft !== null))) continue;
        if (w.kind === "PRD" && previous?.kind === "PRD" && previous.database?.artifactId === w.database?.artifactId) {
          works[w.id] = { ...w, prdGeneration: previous.prdGeneration,
            ...(w.database?.acceptedRevisionId === previous.database?.acceptedRevisionId && w.database?.revisionId === previous.database?.revisionId
              ? { ucBatchComplete: previous.ucBatchComplete, ucBatchSource: previous.ucBatchSource, ucGenerationCandidates: previous.ucGenerationCandidates }
              : {}) };
        } else if (w.kind === "UC_OVERVIEW" && previous?.kind === "UC_OVERVIEW") {
          // The diagram is a client-side cache. Keep it through a workspace refresh;
          // the next open/refresh request compares its source_version with accepted UC data.
          works[w.id] = { ...w, ucDiagram: previous.ucDiagram };
        } else if (w.kind === "FR_ALLOCATION_OVERVIEW" && previous?.kind === "FR_ALLOCATION_OVERVIEW") {
          works[w.id] = { ...w, selectedSubsystemId: previous.selectedSubsystemId, selectedAllocationId: previous.selectedAllocationId, allocationPreviews: previous.allocationPreviews };
        } else {
          works[w.id] = w;
        }
      }
      // A slow workspace read must not roll back a later metadata PATCH response.
      // Stage 1 never deletes features; missing IDs in an older snapshot stay intact.
      const features = { ...p.features };
      for (const feature of a.features ?? []) if (newerVersion(feature.lockVersion, features[feature.id]?.lockVersion)) features[feature.id] = feature;
      for (const featureId of removedFeatures) delete features[featureId];
      const removedIds = new Set([...(p.deletedArtifactIds ?? []), ...(a.removedArtifactIds ?? [])]);
      const clean = (items: WorkspaceObject[]) => items.filter(item => !removedIds.has(item.id) && !removedFeatures.has(item.featureId ?? ""));
      for (const [id, w] of Object.entries(works)) {
        works[id] = { ...w, attachments: clean(w.attachments) };
        if (w.kind === "FR_ALLOCATION_OVERVIEW" && removedArtifacts.size) {
          const allocations = Object.fromEntries(Object.entries(w.allocations ?? {}).filter(([key, item]) => !removedArtifacts.has(key) && !removedArtifacts.has(item.fr_id)));
          const assignments: Record<string, string[]> = {};
          for (const item of Object.values(allocations)) assignments[`db-fr-${item.fr_id}`] = [...new Set([...(assignments[`db-fr-${item.fr_id}`] ?? []), ...item.targets.map(t => t.subsystem_id)])];
          works[id] = { ...w, attachments: clean(w.attachments), allocations, assignments, allocationPreviews: w.allocationPreviews?.filter(row => !removedArtifacts.has(row.allocationId) && !removedArtifacts.has(row.frId)) };
        }
        if (w.kind === "FR_OVERVIEW" && removedArtifacts.size) {
          const codes = new Set(Object.values(works).filter((item): item is FrWork => item.kind === "FR" && item.featureId === w.featureId).map(item => item.number));
          works[id] = { ...w, attachments: clean(w.attachments), rows: w.rows.filter(row => codes.has(row.id)) };
        }
      }
      const tabs = p.tabs.filter(id => works[id]);
      const mru = p.mru.filter(id => works[id]);
      const activeId = p.activeId === null ? null : works[p.activeId] ? p.activeId : mru.find(id => tabs.includes(id)) ?? tabs.at(-1) ?? null;
      let next: ProjectWorks = { ...p, deletedArtifactIds: [...removedArtifacts], deletedFeatureIds: [...removedFeatures], works, features, capabilities: a.capabilities ?? p.capabilities, tabs, mru, activeId, closeRequest: p.closeRequest && works[p.closeRequest.id] ? p.closeRequest : null, conversation: { ...p.conversation, attachments: clean(p.conversation.attachments) } };
      for (const feature of Object.values(features)) next = synchronizeFeature(next, feature);
      return a.openId ? activate(next, a.openId) : next;
    }
    case "seed": {
      const works = { ...p.works }; const aliases = new Map<string, string>();
      // Explicit examples must not create a second PRD for an already-named feature.
      for (const w of a.works.filter((x): x is PrdWork => x.kind === "PRD")) {
        const existing = Object.values(works).find(x => x.kind === "PRD" && normalizeFeatureName(x.featureName) === normalizeFeatureName(w.featureName));
        if (existing) aliases.set(w.id, existing.id); else if (!works[w.id]) works[w.id] = w;
      }
      for (const w of a.works.filter((x): x is UcWork => x.kind === "UC")) {
        const sourceId = aliases.get(w.sourcePrdWorkId) ?? w.sourcePrdWorkId;
        const source = works[sourceId];
        if (source?.kind !== "PRD" || source.session.document?.status !== "accepted") { if (source) aliases.set(w.id, sourceId); continue; }
        if (!works[w.id]) works[w.id] = { ...w, sourcePrdWorkId: sourceId, featureId: source.featureId, featureName: source.featureName };
      }
      return activate({ ...p, works }, aliases.get(a.openId) ?? a.openId);
    }
    case "open": return activate(p, a.id);
    case "home": return { ...p, activeId: null };
    case "close": {
      const w = p.works[a.id]; if (!w || w.saving || !p.tabs.includes(a.id)) return p;
      if (isWorkDirty(w) || isWorkRunning(w)) return { ...p, closeRequest: { id: a.id, reason: isWorkDirty(w) ? "dirty" : "running" } };
      return closeNow(p, a.id);
    }
    case "resolve-close": {
      if (p.closeRequest?.id !== a.id) return p;
      const w = p.works[a.id]; if (!w) return { ...p, closeRequest: null };
      if (a.choice === "cancel") return { ...p, closeRequest: null };
      if (p.closeRequest.reason === "dirty") {
        if (a.choice !== "save" && a.choice !== "discard") return p;
        if ((w.database || w.kind === "FEATURE_OVERVIEW") && a.choice === "save") return p; // The hook must await the server before closing.
        if (w.kind === "FEATURE_OVERVIEW") {
          if (w.metadataAttempt || w.saving) return p;
          return closeNow(update(p, { ...w, metadataDraft: undefined, metadataConflict: false }), a.id);
        }
        const action = { type: a.choice === "save" ? "save" : "cancel-edit" } as const;
        const next: ObjectWork = w.kind === "PRD" ? { ...w, session: transitionPrd(w.session, action) } : w.kind === "UC" ? { ...w, session: transitionUc(w.session, action) } : w.kind === "FR" ? { ...w, session: transitionFr(w.session, action as never) } : w;
        if (isWorkDirty(next)) return { ...update(p, next), notice: "内容校验未通过，标签尚未关闭。" };
        return closeNow(update(p, next), a.id);
      }
      if (a.choice === "stop" && !isWorkRunning(w)) return closeNow(p, a.id);
      return p;
    }
    case "reorder": {
      if (!p.tabs.includes(a.id) || !p.tabs.includes(a.beforeId) || a.id === a.beforeId) return p;
      const tabs = p.tabs.filter(x => x !== a.id); tabs.splice(tabs.indexOf(a.beforeId), 0, a.id); return { ...p, tabs };
    }
    case "prd-generation": {
      const w = p.works[a.id];
      if (w?.kind !== "PRD") return p;
      if (a.action.type === "start" && prdGenerationReason(w, p.features[w.featureId]?.description)) return p;
      const generation = reducePrdGeneration(w.prdGeneration, a.action);
      return generation === w.prdGeneration ? p : update(p, { ...w, prdGeneration: generation });
    }
    case "prd": {
      const w = p.works[a.id];
      if (w?.database && ["save", "accept", "discard", "start", "generated"].includes(a.action.type)) return p; if (w?.kind !== "PRD" || w.ucTask || w.prdGeneration?.status === "streaming") return p;
      const session = transitionPrd(w.session, a.action);
      const next = update(p, { ...w, session });
      // First successful output activates the original work, never a duplicate PRD tab.
      return !w.session.document && session.document && a.action.type === "generated" ? activate(next, w.id) : next;
    }
    case "uc": { const w = p.works[a.id];
      if (w?.database && ["save", "accept", "discard", "start", "generated"].includes(a.action.type)) return p; return w?.kind === "UC" && !w.readOnly ? update(p, { ...w, session: transitionUc(w.session, a.action) }) : p; }
    case "fr": { const w = p.works[a.id];
      if (w?.database && ["save", "accept", "discard", "start", "generated"].includes(a.action.type)) return p; return w?.kind === "FR" && !w.readOnly ? update(p, { ...w, session: transitionFr(w.session, a.action) }) : p; }
    case "fr-overview": {
      const w = p.works[a.id]; if (w?.kind !== "FR_OVERVIEW" || w.readOnly) return p;
      const action = a.action;
      if (action.type === "prompt") return update(p, { ...w, session: { ...w.session, prompt: action.value } });
      if (action.type === "start") return update(p, { ...w, session: { ...w.session, operation: action.request, error: null, prompt: action.retry ? w.session.prompt : "", messages: action.retry ? w.session.messages : [...w.session.messages, { id: `${action.request.id}-user`, role: "user", content: action.request.prompt }] } });
      if (action.type === "generated") return update(p, { ...w, session: { ...w.session, operation: null, messages: [...w.session.messages, { id: `${action.id}-assistant`, role: "assistant", content: "已完成当前 FR 全景检查。表格结构与内容保留为中性展示，可继续打开单条 FR 处理。" }], notice: "FR 全景检查完成。" } });
      if (action.type === "failed") return update(p, { ...w, session: { ...w.session, operation: null, notice: action.message } });
      if (action.type === "cancel") return update(p, { ...w, session: { ...w.session, operation: null, notice: "本次 FR 全景检查已停止。" } });
      return p;
    }
    case "fr-seed": { const works = { ...p.works }; for (const w of a.works) if (!works[w.id]) works[w.id] = w; return activate({ ...p, works }, a.works.find(w => w.kind === "FR_OVERVIEW")?.id ?? p.activeId ?? ""); }
    case "attach": {
      const w = p.works[a.id]; if (!w || p.activeId !== a.id) return p;
      return update(p, { ...w, attachments: appendAttachments(w.attachments, a.objects.filter(o => o.id !== workObject(w)?.id)) });
    }
    case "remove-attachment": { const w = p.works[a.id]; return w ? update(p, { ...w, attachments: w.attachments.filter(x => x.id !== a.objectId) }) : p; }
    case "fr-batch-start": {
      const w = p.works[a.id]; if (w?.kind !== "UC_OVERVIEW" || isWorkRunning(w)) return p;
      const reason = frGenerationGate(p, w.featureId).reason;
      if (reason || w.frBatchComplete) return update(p, { ...w, frValidationShown: Boolean(reason), session: { ...w.session, notice: reason || "已生成本功能 FR，请查看现有全景；重新生成策略待确认。" } });
      return update(p, { ...w, frValidationShown: false, frBatch: { id: a.taskId, sources: snapshotFrSources(p, w.featureId) }, session: { ...w.session, notice: "正在根据全部已确认 UC 生成 FR（Mock）…" } });
    }
    case "fr-batch-ready": {
      const w = p.works[a.id]; if (w?.kind !== "UC_OVERVIEW" || w.frBatch?.id !== a.taskId) return p;
      const fail = (notice: string) => update(p, { ...w, frBatch: null, session: { ...w.session, notice } });
      if (frGenerationGate(p, w.featureId).reason || !sameFrSources(w.frBatch.sources, snapshotFrSources(p, w.featureId))) return fail("来源 UC 列表、正文或确认状态已变化，未创建 FR，请确认后重试。");
      if (!a.works.length) return fail("没有返回有效 FR，本次未创建对象，请重试。");
      const overviewId = frOverviewId(p, w.featureId);
      const existingOverview = p.works[overviewId];
      if (existingOverview && (existingOverview.kind !== "FR_OVERVIEW" || existingOverview.featureId !== w.featureId)) return fail("FR 全景标识冲突，未创建对象。");
      const ids = new Set<string>(Object.keys(p.works)), objects = new Set(Object.values(p.works).map(work => workObject(work)?.id));
      const numbers = new Set(featureFrs(p, w.featureId).map(fr => fr.number)), covered = new Set<string>();
      for (const child of a.works) {
        const doc = child.session.document, source = w.frBatch.sources.find(s => s.workId === child.sourceUcWorkId);
        if (child.kind !== "FR" || !child.id || child.id === overviewId || ids.has(child.id) || !doc || !doc.id || objects.has(doc.id) || child.objectId !== doc.id || doc.status !== "pending" || doc.featureName !== w.featureName || child.featureId !== w.featureId || child.featureName !== w.featureName || child.sourceOverviewId !== overviewId || !source || doc.content.source !== source.document.content.number || !child.number.trim() || child.number !== doc.content.id || numbers.has(child.number) || !doc.content.description.trim()) return fail("FR 结果存在标识或来源冲突，整批未写入，没有覆盖已有对象，请重试。");
        ids.add(child.id); objects.add(doc.id); numbers.add(child.number); covered.add(source.workId);
      }
      if (covered.size !== w.frBatch.sources.length) return fail("FR 结果未覆盖全部已确认 UC，整批未写入，请重试。");
      const works = { ...p.works };
      if (!existingOverview) works[overviewId] = { id: overviewId, kind: "FR_OVERVIEW", featureId: w.featureId, featureName: w.featureName, attachments: [], rows: [], session: createFrOverviewSession(w.featureName) };
      for (const child of a.works) works[child.id] = child;
      works[w.id] = { ...w, frBatch: null, frBatchComplete: true, session: { ...w.session, notice: `已模拟生成 ${a.works.length} 条 FR，均待审阅，已打开 FR 全景视图。` } };
      return { ...activate({ ...p, works }, overviewId), frBatchReveal: { workId: overviewId, requestId: a.taskId } };
    }
    case "fr-batch-failed": {
      const w = p.works[a.id];
      return w?.kind === "UC_OVERVIEW" && w.frBatch?.id === a.taskId ? update(p, { ...w, frBatch: null, session: { ...w.session, notice: a.message } }) : p;
    }
    case "uc-start": {
      const w = p.works[a.id]; if (w?.kind !== "PRD" || !canGenerateUcBatch(w)) return p;
      return update(p, { ...w, ucTask: a.taskId, ucRequestFeedback: { requestId: a.taskId, featureName: w.featureName }, ucBatchSource: { ...w.session.document! }, ucBatchComplete: false, ucGenerationCandidates: undefined, session: { ...w.session, notice: w.database ? "正在生成并保存待确认 UC…" : "正在基于已确认的 PRD 批量生成 UC（Mock）…" } });
    }
    case "uc-candidates-ready": {
      const w = p.works[a.id]; if (w?.kind !== "PRD" || w.ucTask !== a.taskId) return p;
      const fail = (notice: string) => update(p, { ...w, ucTask: null, session: { ...w.session, notice } });
      if (w.session.document?.status !== "accepted" || !sameBatchSource(w)) return fail("来源 PRD 已变化，未保留本批 UC 候选，请基于已确认版本重试。");
      if (!a.candidates.length) return fail("生成结果未返回有效 UC 候选，请重试。");
      return update(p, {
        ...w,
        ucTask: null,
        ucBatchComplete: true,
        ucGenerationCandidates: a.candidates,
        session: { ...w.session, notice: `已生成 ${a.candidates.length} 条 UC 候选，待后续逐条审阅；尚未写入正式 UC。` },
      });
    }
    case "uc-ready": {
      const w = p.works[a.id]; if (w?.kind !== "PRD" || w.ucTask !== a.taskId) return p; 
      const fail = (notice: string) => update(p, { ...w, ucTask: null, session: { ...w.session, notice } });
      if (w.session.document?.status !== "accepted" || !sameBatchSource(w)) return fail("来源 PRD 已变化，未写入本批 UC，请基于已确认版本重试。");
      if (!a.works.length) return fail("批量生成未返回有效 UC，没有创建对象，请重试。");
      const ids = new Set<string>(), objectIds = new Set(Object.values(p.works).map(work => workObject(work)?.id).filter(Boolean));
      // Validate the entire batch before insertion: no partial success or silent overwrite.
      for (const child of a.works) {
        const doc = child.session.document;
        if (child.kind !== "UC" || !child.id || p.works[child.id] || ids.has(child.id) || !doc || child.objectId !== doc.id || objectIds.has(doc.id) || child.sourcePrdWorkId !== w.id || child.featureId !== w.featureId || child.featureName !== w.featureName || doc.featureName !== w.featureName || doc.status !== "pending") return fail("批量结果标识、来源或状态冲突，没有覆盖现有对象，请重试。");
        ids.add(child.id); objectIds.add(doc.id);
      }
      const works = { ...p.works };
      for (const child of a.works) works[child.id] = child;
      works[w.id] = { ...w, ucTask: null, ucBatchComplete: true, session: { ...w.session, notice: `已模拟批量生成 ${a.works.length} 条 UC，均待审阅。已打开当前功能的 UC 全景视图；补充遗漏请使用工作台“用例生成”。` } };
      // Commit the batch and open/reuse its panorama in one project-local transition.
      const next = transitionWorkbench({ ...p, works }, { type: "open-panorama", kind: "UC_OVERVIEW", featureId: w.featureId, featureName: w.featureName });
      return { ...next, ucBatchReveal: { workId: panoramaId(w.featureId, "UC_OVERVIEW"), requestId: a.taskId } };
    }
    case 'uc-appended': {
      const w=p.works[a.id];
      if(w?.kind!=='PRD'||w.ucTask!==a.taskId)return p;
      const next=update(p,{...w,ucTask:null,ucGenerationCandidates:undefined,ucBatchComplete:false,session:{...w.session,notice:`已追加 ${a.count} 条待确认UC；即将展开需求工程UC目录并打开UC全景视图。`}});
      return {...next,ucBatchReveal:{workId:panoramaId(w.featureId,'UC_OVERVIEW'),requestId:a.taskId,sidebarOnly:true}};
    }
    case "uc-failed": { const w = p.works[a.id]; return w?.kind === "PRD" && w.ucTask === a.taskId ? update(p, { ...w, ucTask: null, ucRequestFeedback: { requestId: a.taskId, featureName: w.ucRequestFeedback?.featureName ?? w.featureName, message: a.message }, session: { ...w.session, notice: a.message } }) : p; }
    case "uc-diagram-start": {
      const w = p.works[a.id];
      if (w?.kind !== "UC_OVERVIEW" || w.ucDiagram.status === "loading") return p;
      return update(p, { ...w, ucDiagram: { ...w.ucDiagram, status: "loading", requestId: a.taskId, message: null } });
    }
    case "uc-diagram-ready": {
      const w = p.works[a.id];
      return w?.kind === "UC_OVERVIEW" && w.ucDiagram.status === "loading" && w.ucDiagram.requestId === a.taskId
        ? update(p, { ...w, ucDiagram: { ...a.state, requestId: a.taskId } }) : p;
    }
    case "uc-diagram-failed": {
      const w = p.works[a.id];
      return w?.kind === "UC_OVERVIEW" && w.ucDiagram.status === "loading" && w.ucDiagram.requestId === a.taskId
        ? update(p, { ...w, ucDiagram: { ...w.ucDiagram, status: "error", requestId: a.taskId, message: a.message } }) : p;
    }
    case "uc-diagram-cancel": {
      const w = p.works[a.id];
      return w?.kind === "UC_OVERVIEW" && w.ucDiagram.status === "loading" && w.ucDiagram.requestId === a.taskId
        ? update(p, { ...w, ucDiagram: { ...w.ucDiagram, status: "idle", requestId: null, message: a.message } }) : p;
    }
    case "notice": return { ...p, notice: a.message };
  }
}
export function workbenchReducer(store: WorkbenchStore, event: { project: string; action: WorkbenchAction }): WorkbenchStore {
  const current = store[event.project] ?? createProjectWorks(); const next = transitionWorkbench(current, event.action);
  return next === current ? store : { ...store, [event.project]: next };
}
export function featureUcs(p: ProjectWorks, featureId: string) {
  return Object.values(p.works).filter((w): w is UcWork => w.kind === "UC" && w.featureId === featureId && Boolean(w.session.document));
}
export function frOverviewId(p: ProjectWorks, featureId: string) {
  return Object.values(p.works).find(w => w.kind === "FR_OVERVIEW" && w.featureId === featureId)?.id ?? `${featureId}-fr-overview`;
}
export function featureFrs(p: ProjectWorks, featureId: string) {
  return Object.values(p.works).filter((w): w is FrWork => w.kind === "FR" && w.featureId === featureId && Boolean(w.session.document));
}
export function workTree(p: ProjectWorks, kind: "PRD" | "UC" | "FR" | "FR分配"): WorkspaceFolder[] {
  const features = new Map<string, WorkspaceFolder>();
  for (const w of Object.values(p.works)) {
    const include = kind === "PRD" ? w.kind === "PRD" : kind === "UC" ? w.kind === "UC" || w.kind === "UC_OVERVIEW" || w.kind === "PRD" && Boolean(w.session.document)
      : w.kind === "FR" || w.kind === "FR_OVERVIEW" || w.kind === "FR_ALLOCATION_OVERVIEW";
    if (!include) continue;
    if (!features.has(w.featureId)) {
      const category: WorkspaceFolder = { id: w.featureId + "-" + kind + "-folder", type: "folder", level: "category", name: kind, children: [], panorama: kind === "PRD" ? undefined : { featureId: w.featureId, featureName: w.featureName, kind: kind === "UC" ? "UC_OVERVIEW" : kind === "FR" ? "FR_OVERVIEW" : "FR_ALLOCATION_OVERVIEW" } };
      features.set(w.featureId, { id: w.featureId + "-" + kind, type: "folder", level: "function", name: w.featureName, children: kind === "PRD" ? [] : [category] });
    }
    if (kind === "FR分配" || (kind !== "PRD" && w.kind !== kind)) continue;
    const object = workObject(w);
    if (object) {
      const feature = features.get(w.featureId)!;
      if (kind === "PRD") feature.children.push(object);
      else (feature.children[0] as WorkspaceFolder).children.push(object);
    }
  }
  return [...features.values()];
}

// One functional identity, two module projections; categories exist before artifacts.
export function projectWorkspaceTree(p: ProjectWorks, module: import("../navigation/model").ModuleKey): WorkspaceFolder[] {
  const features = new Map(projectFeatures(p).map(f => [f.id, f]));
  return [...features].map(([featureId, feature]) => {
    const name = feature.name;
    const objects = Object.values(p.works).filter(w => w.featureId === featureId);
    const featureDeletion = { kind: "function" as const, id: featureId, lockVersion: feature.lockVersion, canDelete: Boolean(feature.canDelete), label: `功能 · ${name}`, featureId };
    const functionFolder: WorkspaceFolder = { id: featureId + "-" + module, type: "folder", level: "function", name, deletion: p.capabilities ? featureDeletion : undefined, children: [], panorama: { featureId, featureName: name, kind: "FEATURE_OVERVIEW" } };
    if (module === "product") {
      functionFolder.children = objects.filter(w => w.kind === "PRD").flatMap(w => { const o = workObject(w); return o ? [o] : []; });
      return functionFolder;
    }
    if (module !== "requirements") return functionFolder;
    functionFolder.children = (["UC", "FR", "FR分配"] as const).map(kind => ({
      id: featureId + "-" + kind + "-folder", type: "folder" as const, level: "category" as const, name: kind,
      panorama: { featureId, featureName: name, kind: kind === "UC" ? "UC_OVERVIEW" as const : kind === "FR" ? "FR_OVERVIEW" as const : "FR_ALLOCATION_OVERVIEW" as const },
      children: kind === "FR分配" ? allocationTree(objects, featureId, name, p.capabilities !== undefined) : objects.filter(w => w.kind === kind).flatMap(w => { const o = workObject(w); return o ? [o] : []; }),
    }));
    return functionFolder;
  });
}

// Resolve display labels from real project metadata, never from identifiers.
export function allocationSubsystemName(work: FrAllocationWork, subsystemId: string, unavailableLabel = "子系统名称暂不可用"): string {
  if (subsystemId === "__empty__") return "未选择子系统";
  const current = work.subsystems.find(item => item.id === subsystemId)?.name.trim();
  if (current) return current;
  for (const allocation of Object.values(work.allocations ?? {})) {
    const saved = allocation.targets.find(item => item.subsystem_id === subsystemId)?.subsystem_name?.trim();
    if (saved) return saved;
  }
  return unavailableLabel;
}

function allocationTree(objects: ObjectWork[], featureId: string, featureName: string, databaseMode: boolean): WorkspaceNode[] {
  const allocation = objects.find((w): w is FrAllocationWork => w.kind === "FR_ALLOCATION_OVERVIEW");
  if (!allocation) return [];
  const frNames = new Map(objects.filter((w): w is FrWork => w.kind === "FR").map(fr => [fr.objectId, `${fr.number} · ${fr.originalName}`]));
  const groups = new Map<string, { name: string; children: WorkspaceObject[] }>();
  if (!databaseMode) {
    // Mock rows remain FR references, not pretend persisted allocation objects.
    return PRESET_SUBSYSTEMS.flatMap(subsystem => {
      const children = objects.filter((w): w is FrWork => w.kind === "FR" && Boolean(allocation.assignments[w.id]?.includes(subsystem.id)))
        .flatMap(w => { const object = workObject(w); return object ? [object] : []; });
      return children.length ? [{ id: `${featureId}-allocation-${subsystem.id}`, type: "folder" as const, level: "category" as const, name: subsystem.name, children }] : [];
    });
  }
  const emptyKey = "__empty__";
  const saved = Object.values(allocation.allocations ?? {});
  const previews = new Map((allocation.allocationPreviews ?? []).map(row => [row.allocationId, row]));
  const ids = new Set([...saved.map(row => row.id), ...previews.keys()]);
  for (const id of ids) {
    const item = allocation.allocations[id], preview = previews.get(id);
    const frId = preview?.frId ?? item?.fr_id;
    if (!frId) continue;
    const targets = preview?.targetIds ?? item?.targets.map(target => target.subsystem_id) ?? [];
    for (const key of new Set(targets.length ? targets : [emptyKey])) {
      const name = allocationSubsystemName(allocation, key);
      if (!groups.has(key)) groups.set(key, { name, children: [] });
      const dirty = preview?.dirty ?? false;
      const status = dirty ? "unsaved" as const : (preview?.accepted ?? item?.revision.status === "accepted") ? "accepted" as const : "pending" as const;
      groups.get(key)!.children.push({
        id, type: "object", kind: "FR分配", name: frNames.get(frId) ?? `${item?.fr_code ?? frId} · 分配`,
        functionName: featureName, summary: name, status, interactive: true, selectable: false, featureId,
        allocation: { subsystemId: key, allocationId: id, frId },
        deletion: item && !dirty ? { kind: "FR_ALLOCATION", id, lockVersion: item.lock_version,
          canDelete: item.can_delete, label: `${item.fr_code} · 分配`, featureId } : undefined,
      });
    }
  }
  return [...groups].map(([key, group]) => ({ id: `${featureId}-allocation-${key}`, type: "folder" as const,
    level: "category" as const, name: group.name, children: group.children,
    panorama: { featureId, featureName, kind: "FR_ALLOCATION_OVERVIEW" as const, subsystemId: key } }));
}


export function featureOverviewId(featureId: string) { return featureId + "-feature-overview"; }
export function projectFeatures(p: ProjectWorks): BusinessFeature[] {
  const features = new Map(Object.values(p.features ?? {}).map(f => [f.id, f]));
  for (const w of Object.values(p.works)) if (!features.has(w.featureId)) features.set(w.featureId, { id: w.featureId, name: w.featureName, description: "" });
  return [...features.values()];
}









