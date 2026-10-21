import type { WorkspaceObject } from "@/features/workspace/tree";
import { isWorkDirty, workObject, type ProjectWorks } from "@/features/workbench/model";

export const MAX_OPERATION_OBJECTS = 20;
export type OperationObjectItem = { object: WorkspaceObject; revisionId?: string; hasDraft: boolean; unavailable: boolean; readOnly: boolean };

/** Resolve by object identity, never by a reusable tab/work id or an old history snapshot. */
export function operationObjectItems(state: ProjectWorks, objects: WorkspaceObject[], databaseMode: boolean): OperationObjectItem[] {
  return objects.map(selected => {
    const work = Object.values(state.works).find(w => w.database?.artifactId === selected.id || workObject(w)?.id === selected.id);
    const current = work ? workObject(work) : null;
    return {
      object: current ?? selected,
      revisionId: work?.database?.revisionId,
      hasDraft: Boolean(work && isWorkDirty(work)),
      unavailable: !current || databaseMode && !work?.database?.revisionId,
      readOnly: Boolean(databaseMode && work?.database && !work.database.canUpdate),
    };
  });
}

export function operationObjectReferences(state: ProjectWorks, objects: WorkspaceObject[]) {
  if (objects.length > MAX_OPERATION_OBJECTS) throw new Error('当前关联对象最多支持20个，请先移除部分对象。');
  return operationObjectItems(state, objects, true).map(item => {
    if (item.unavailable || !item.revisionId) throw new Error('当前关联对象已失效或没有已保存版本，请刷新工作空间或移除后重试。');
    return { artifact_id: item.object.id, revision_id: item.revisionId };
  });
}

export const operationObjectsStorageKey = (project: string, thread: string) => 'ee-operation-objects:v1:' + project + ':' + thread;

// The optional browser hint contains identity/type only, never business text, versions, tokens, or inferred history attachments.
export function encodeOperationObjects(objects: WorkspaceObject[]): string {
  return JSON.stringify(objects.map(({ id, kind }) => ({ id, kind })));
}
export function restoreOperationObjects(raw: string | null, state: ProjectWorks): WorkspaceObject[] {
  if (!raw) return [];
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > MAX_OPERATION_OBJECTS) return [];
    const seen = new Set<string>();
    return values.flatMap(value => {
      if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 200 || !['PRD', 'UC', 'FR', 'FR分配'].includes(value.kind) || seen.has(value.id)) return [];
      seen.add(value.id);
      const work = Object.values(state.works).find(w => w.database?.artifactId === value.id || workObject(w)?.id === value.id);
      const current = work ? workObject(work) : null;
      return [current ?? { id: value.id, kind: value.kind, type: 'object' as const, name: '不可用对象', functionName: '', summary: '' }];
    });
  } catch { return []; }
}
