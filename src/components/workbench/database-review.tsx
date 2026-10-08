import type { DatabaseWork } from "@/features/workbench/model";
export type Persistence = DatabaseWork & { saving?: boolean; onRefresh: () => void };
export function DatabaseReview({ persistence, status, editing, selected, onSelect, onAccept }: { persistence: Persistence; status?: string; editing: boolean; selected: boolean; onSelect: (value: boolean) => void; onAccept: () => void }) {
  const ready = status === "pending" && !editing && !persistence.saving && persistence.canAccept;
  return <div className="database-review"><label><input type="checkbox" checked={selected} disabled={!ready} onChange={e => onSelect(e.target.checked)} /> 已审阅当前版本</label><button className="button-primary" title={!persistence.canAccept ? "当前账号无确认权限" : editing ? "请先保存草稿" : status === "accepted" ? "当前版本已确认" : !selected ? "请先勾选已审阅当前版本" : "确认当前版本"} disabled={!ready || !selected} onClick={onAccept}>{persistence.saving ? "提交中…" : "确认"}</button><button className="button-secondary" disabled={editing || persistence.saving} onClick={persistence.onRefresh}>刷新数据</button></div>;
}
