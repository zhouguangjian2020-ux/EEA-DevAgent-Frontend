import type { DeletionKind } from "@/lib/api/client";

export type ObjectKind = "PRD" | "UC" | "FR" | "FR分配";
export type WorkspaceDeletionKind = Exclude<DeletionKind, "project">;

export type WorkspaceDeletion = {
  kind: WorkspaceDeletionKind;
  id: string;
  lockVersion?: string;
  canDelete?: boolean;
  label: string;
  featureId?: string;
  workId?: string;
  hasUnsavedChanges?: boolean;
};

export type WorkspaceObject = {
  id: string;
  type: "object";
  name: string;
  kind: ObjectKind;
  functionName: string;
  summary: string;
  status?: "pending" | "accepted" | "unsaved";
  allocation?: { subsystemId: string; allocationId: string; frId?: string };
  interactive?: boolean;
  selectable?: boolean;
  featureId?: string;
  workId?: string;
  deletionId?: string;
  deletion?: WorkspaceDeletion;
};

export type WorkspaceFolder = {
  id: string;
  type: "folder";
  name: string;
  level: "function" | "category";
  children: WorkspaceNode[];
  panorama?: { featureId: string; featureName: string; kind: "FEATURE_OVERVIEW" | "UC_OVERVIEW" | "FR_OVERVIEW" | "FR_ALLOCATION_OVERVIEW"; subsystemId?: string };
  deletion?: WorkspaceDeletion;
};

export type WorkspaceNode = WorkspaceFolder | WorkspaceObject;

export function collectObjects(nodes: WorkspaceNode[]): WorkspaceObject[] {
  return nodes.flatMap((node) => node.type === "object" ? [node] : collectObjects(node.children));
}

// Preserve ancestors of matches; matching a folder includes its complete subtree.
export function filterWorkspaceTree(nodes: WorkspaceNode[], search: string): WorkspaceNode[] {
  const query = search.trim().toLowerCase();
  if (!query) return nodes;
  return nodes.flatMap((node): WorkspaceNode[] => {
    if (node.name.toLowerCase().includes(query)) return [node];
    if (node.type === "object") return [];
    const children = filterWorkspaceTree(node.children, search);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function appendAttachments(existing: WorkspaceObject[], selected: WorkspaceObject[]): WorkspaceObject[] {
  const ids = new Set(existing.map((object) => object.id));
  return [...existing, ...selected.filter((object) => {
    if (ids.has(object.id)) return false;
    ids.add(object.id);
    return true;
  })];
}



