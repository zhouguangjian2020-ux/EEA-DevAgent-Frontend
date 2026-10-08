import type { BusinessFeature } from "@/features/workbench/model";
import type { SourceRef } from "@/features/workbench/manual-api";
export function UcSourcePicker({ candidates, value, onChange }: { candidates: NonNullable<BusinessFeature["acceptedUcs"]>; value: SourceRef[]; onChange: (value: SourceRef[]) => void }) {
  const stale = value.filter(s => !candidates.some(c => c.uc_id === s.uc_id && c.uc_revision_id === s.uc_revision_id));
  return <fieldset className="uc-source-picker"><legend>来源 UC（可多选）</legend><p>只列出同一功能当前已确认版本；保存草稿可不选，确认 FR 前至少选一个。</p>
    {!candidates.length && <p>暂无已确认的 UC。</p>}
    {candidates.map(c => <label key={c.uc_id}><input type="checkbox" checked={value.some(s => s.uc_id === c.uc_id && s.uc_revision_id === c.uc_revision_id)} onChange={e => onChange(e.target.checked ? [...value.filter(s => s.uc_id !== c.uc_id), { uc_id: c.uc_id, uc_revision_id: c.uc_revision_id }] : value.filter(s => s.uc_id !== c.uc_id))} /><span>{c.uc_code} · {c.uc_name}<small>版本 {c.uc_revision_id.slice(0, 8)}</small></span></label>)}
    {stale.map(s => <label className="source-stale" key={s.uc_id}><input type="checkbox" checked onChange={() => onChange(value.filter(v => v.uc_id !== s.uc_id))} /><span>原引用 {s.uc_id.slice(0, 8)} / {s.uc_revision_id.slice(0, 8)}<small>已不是当前已确认版本，请取消后重新选择；不会自动替换。</small></span></label>)}
  </fieldset>;
}
