import type { WorkspaceNode, WorkspaceDeletion } from "./tree";

export const MAX_DELETE_SELECTION = 200;
export function deletionKey(item: Pick<WorkspaceDeletion, "kind" | "id">) { return `${item.kind}:${item.id}`; }

// Search/module projection never owns the selection; one real identity may appear many times.
export function collectDeletionTargets(nodes: WorkspaceNode[]): WorkspaceDeletion[] {
  const found = new Map<string, WorkspaceDeletion>();
  function visit(items: WorkspaceNode[]) {
    for (const item of items) {
      if (item.deletion) found.set(deletionKey(item.deletion), item.deletion);
      if (item.type === "folder") visit(item.children);
    }
  }
  visit(nodes);
  return [...found.values()];
}
export function toggleDeletionSelection(current: WorkspaceDeletion[], target: WorkspaceDeletion) {
  const key = deletionKey(target);
  if (current.some(item => deletionKey(item) === key)) return current.filter(item => deletionKey(item) !== key);
  if (!target.canDelete || current.length >= MAX_DELETE_SELECTION) return current;
  return [...current, target];
}
