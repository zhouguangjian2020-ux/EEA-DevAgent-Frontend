import type { RequirementDiagramResult } from "@/features/workbench/requirement-diagram-api";
import type { FrAllocationWork } from "@/features/workbench/model";
export type RequirementDiagramCache = Map<string, RequirementDiagramResult>;
// Owned by the workbench, never persisted or shared across signed-in users.
export function requirementSourceKey(work: FrAllocationWork) {
  const subsystemId = work.selectedSubsystemId;
  return JSON.stringify(Object.values(work.allocations)
    .filter(row => row.targets.some(target => target.subsystem_id === subsystemId))
    .map(row => [row.id, row.revision.revision_id, row.revision.status, row.fr_revision_id, row.design_version_id])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
export function hasConfirmedSubsystemAllocation(work: FrAllocationWork) {
  return Object.values(work.allocations).some(row => row.revision.status === "accepted"
    && row.targets.some(target => target.subsystem_id === work.selectedSubsystemId));
}
export function requirementCacheKey(projectId: string, functionId: string, subsystemId: string, sourceKey: string) {
  return JSON.stringify([projectId, functionId, subsystemId, sourceKey]);
}
