"use client";
import { AppendFrPanel } from './append-fr-panel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createUuid } from '@/lib/uuid';
import { getProjectWorkspace, type WorkspaceFunction } from '@/lib/api/client';
import { type WriteResult } from '@/features/workbench/manual-api';
import { workflowPost, projectPath, type Generation, type FrCandidate, type AllocationCandidate } from '@/features/workbench/workflow-api';
import { SubsystemSelect } from '../panorama/subsystem-select';
import './workflows.css';
type FrRow = FrCandidate & { selected: boolean; saved: boolean };
type AllocRow = AllocationCandidate & { design: string; sourceVersion?: string; allocationId: string; base: string | null; savedRevision?: string; accepted?: boolean; dirty: boolean; mutation: string; acceptId: string };
type Props = { getTaskThread?: () => string; blockedReason?: string; project: string; featureId: string; mode: 'fr' | 'allocation'; active: boolean; onSaved: () => Promise<unknown> };
function LegacyAllocationPanel({ project, featureId, mode, active, onSaved, blockedReason, getTaskThread }: Props) {
  const [sourceVersion, setSourceVersion] = useState("");
  const [feature, setFeature] = useState<WorkspaceFunction>(), [caps, setCaps] = useState<string[]>([]);
  const [frs, setFrs] = useState<FrRow[]>([]), [allocations, setAllocations] = useState<AllocRow[]>([]);
  const [generating,setGenerating]=useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null), running = useRef(false);
  const dirty = frs.some(r => !r.saved) || allocations.some(r => r.dirty);
  const path = projectPath(project) + '/functions/' + featureId;
  const reload = useCallback(async () => {
    const ws = await getProjectWorkspace(project); const f = ws.functions.find(x => x.id === featureId);
    setFeature(f); setCaps(f?.workflow_capabilities ?? ws.capabilities ?? []); return f;
  }, [project, featureId]);
  useEffect(() => { let alive=true;if(active)getProjectWorkspace(project).then(ws=>{if(alive){setFeature(ws.functions.find(f=>f.id===featureId));setCaps(ws.functions.find(f=>f.id===featureId)?.workflow_capabilities??ws.capabilities??[]);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;}; }, [active,project,featureId]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(()=>{const guard=(event:Event)=>{const e=event as CustomEvent<{project:string;featureId:string;mode:string}>;if(e.detail.project===project&&e.detail.featureId===featureId&&e.detail.mode===mode&&(dirty||busy)&&!window.confirm(busy?'请求尚在进行，关闭会停止等待。继续？':'关闭将丢弃未保存候选，原业务内容不变。继续？'))event.preventDefault();};window.addEventListener('workflow-before-close',guard);return()=>window.removeEventListener('workflow-before-close',guard);},[project,featureId,mode,dirty,busy]);
  useEffect(() => { if (!dirty) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
  async function task(operation: () => Promise<void>) {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(e instanceof Error && e.name === 'AbortError' ? '已停止；原内容未改变。' : e instanceof Error ? e.message : '操作失败'); }
    finally { running.current = false; setBusy(false); controller.current = null; setGenerating(false); }
  }
  function generate() {
    if(blockedReason){setError(blockedReason);return;}
    if (dirty && !window.confirm('重新生成将替换本页未保存候选，已有正式内容不变。继续？')) return;
    void task(async () => {
      const c = new AbortController(); controller.current = c; setGenerating(true); const requestId = createUuid();
      const result = await workflowPost<Generation<FrCandidate | AllocationCandidate>>(path + (mode === 'fr' ? '/fr-generations' : '/allocation-generations'), { client_request_id: requestId, thread_id: getTaskThread?.() }, c.signal);
      if (c.signal.aborted) return;
      if (result.generation_id !== requestId || !Array.isArray(result.candidates) || !result.candidates.length) throw new Error('候选结果身份异常');
      const f = await reload();
      if (c.signal.aborted) return;
      setSourceVersion(result.source_version);
      if (mode === 'fr') setFrs((result.candidates as FrCandidate[]).map(x => ({ ...x, selected: true, saved: false })));
      else setAllocations((result.candidates as AllocationCandidate[]).map(x => { const previous = f?.fr_allocations.find(a => a.fr_id === x.fr_id); return { ...x, note: x.note || x.unmatched_reason, design: result.source.subsystems[0]?.design_version_id ?? "", sourceVersion: result.source_version, allocationId: previous?.id ?? createUuid(), base: previous?.revision.revision_id ?? null, dirty: true, mutation: createUuid(), acceptId: createUuid() }; }));
      setNotice('已生成候选，尚未保存或确认。');
    });
  }
  function loadExisting() { void task(async () => {
    if (dirty && !window.confirm('放弃当前未保存候选并读取已保存分配？')) return;
    const f = await reload();
    setAllocations((f?.fr_allocations ?? []).map(a => ({ candidate_id: a.id, design: a.design_version_id, fr_id: a.fr_id, fr_revision_id: a.fr_revision_id, targets: a.targets.map(t => ({ subsystem_id: t.subsystem_id, rationale: t.rationale ?? '' })), note: a.note ?? '', unmatched_reason: '', allocationId: a.id, base: a.revision.revision_id, savedRevision: a.revision.revision_id, accepted: a.revision.status === 'accepted', dirty: false, mutation: createUuid(), acceptId: createUuid() })));
  }); }
  const updateFr = (id: string, patch: Partial<FrRow>) => setFrs(rows => rows.map(r => r.candidate_id === id ? { ...r, ...patch } : r));
  const updateAllocation = (id: string, patch: Partial<AllocRow>) => setAllocations(rows => rows.map(r => r.candidate_id === id ? { ...r, ...patch, dirty: true, accepted: false, mutation: createUuid() } : r));
  const saveFrs = () => void task(async () => {
    for (const row of frs.filter(r => r.selected && !r.saved)) {
      await workflowPost(path + "/fr-candidates/adopt", { creation_id: row.candidate_id, source_version: sourceVersion, content: { kind: 'FR', description: row.description, acceptance_criteria: row.acceptance_criteria ?? '', sources: row.sources } });
      updateFr(row.candidate_id, { saved: true });
    }
    setNotice('已选候选保存为待确认FR；确认仍为独立操作。'); await onSaved(); await reload();
  });
  const saveAllocation = (row: AllocRow) => void task(async () => {
    const design = row.design; if (!design) throw new Error('没有有效的项目子系统目录');
    const r = await workflowPost<WriteResult>(path + '/allocations', { mutation_id: row.mutation, allocation_id: row.allocationId, base_revision_id: row.base, fr_id: row.fr_id, fr_revision_id: row.fr_revision_id, design_version_id: design, source_version: row.sourceVersion, targets: row.targets, note: row.note });
    if (!r.revision_id) throw new Error('保存未返回修订');
    setAllocations(rows => rows.map(x => x.candidate_id === row.candidate_id ? { ...x, base: r.revision_id, savedRevision: r.revision_id!, dirty: false, accepted: false, acceptId: createUuid() } : x));
    setNotice('分配草稿已保存，尚未确认。'); await onSaved(); await reload();
  });
  const acceptAllocation = (row: AllocRow) => void task(async () => {
    if (!row.savedRevision || row.dirty) throw new Error('请先保存当前修改');
    await workflowPost(projectPath(project) + '/allocations/' + row.allocationId + '/accept', { mutation_id: row.acceptId, revision_id: row.savedRevision });
    setAllocations(rows => rows.map(x => x.candidate_id === row.candidate_id ? { ...x, accepted: true } : x));
    setNotice('分配已确认。'); await onSaved(); await reload();
  });
  const permitted = caps.includes(mode === 'fr' ? 'FR.create' : 'FR_ALLOCATION.create');
  const sourceOptions = feature?.accepted_use_cases ?? [];
  return <section className='workflow-panel' aria-label={mode === 'fr' ? 'FR生成候选' : 'FR分配建议与审阅'}>
    <div className='workflow-toolbar'><strong>{mode === 'fr' ? 'FR生成与人工采纳' : 'FR分配与版本审阅'}</strong><button className='button-primary' disabled={busy || !permitted || Boolean(blockedReason)} title={blockedReason} onClick={generate}>{busy ? '处理中…' : mode === 'fr' ? '一键生成FR' : '一键生成FR分配'}</button>{generating && <button className='button-secondary' onClick={() => controller.current?.abort()}>停止</button>}{mode === 'allocation' && <button className='button-secondary' disabled={busy} onClick={loadExisting}>读取已保存分配</button>}</div>
    {blockedReason && <p role="status">{blockedReason}</p>}
    {!permitted && <p>无生成权限或业务写入未启用；不会使用Mock替代真实结果。</p>}
    {error && <p role='alert'>{error} 原输入已保留；可核对后重试。</p>}{notice && <p role='status'>{notice}</p>}
    {mode === 'fr' && frs.map((r, i) => <fieldset className='workflow-candidate' key={r.candidate_id} disabled={busy || r.saved}><legend><label><input type='checkbox' checked={r.selected} onChange={e => updateFr(r.candidate_id, { selected: e.target.checked })} />候选FR {i + 1} {r.saved ? '已保存草稿' : '未保存'}</label></legend><label>需求描述<textarea aria-label="需求描述" value={r.description} onChange={e => updateFr(r.candidate_id, { description: e.target.value })} /></label><label>验收标准<textarea aria-label="验收标准" value={r.acceptance_criteria ?? ''} onChange={e => updateFr(r.candidate_id, { acceptance_criteria: e.target.value })} /></label><div>来源UC{sourceOptions.map(s => <label key={s.uc_id}><input type='checkbox' checked={r.sources.some(x => x.uc_id === s.uc_id && x.uc_revision_id === s.uc_revision_id)} onChange={e => updateFr(r.candidate_id, { sources: e.target.checked ? [...r.sources.filter(x => x.uc_id !== s.uc_id), { uc_id: s.uc_id, uc_revision_id: s.uc_revision_id }] : r.sources.filter(x => x.uc_id !== s.uc_id) })} />{s.uc_code} · {s.uc_name}</label>)}</div></fieldset>)}
    {mode === 'fr' && frs.length > 0 && <button className='button-primary' disabled={busy || !frs.some(r => r.selected && !r.saved)} onClick={saveFrs}>保存所选为草稿</button>}
    {mode === 'allocation' && allocations.map(r => <div key={r.candidate_id} className='workflow-candidate'><strong>{feature?.functional_requirements.find(f => f.id === r.fr_id)?.code ?? r.fr_id}</strong><p>{feature?.functional_requirements.find(f => f.id === r.fr_id)?.description}</p>{r.unmatched_reason && <p>未匹配：{r.unmatched_reason}</p>}<ul>{r.targets.map(t=><li key={t.subsystem_id}>{feature?.subsystems.find(s=>s.id===t.subsystem_id)?.name ?? t.subsystem_id}：{t.rationale || '人工选择，未填写依据'}</li>)}</ul><SubsystemSelect number={r.fr_id} value={r.targets.map(t => t.subsystem_id)} active={active && !busy} options={(feature?.subsystems ?? []).filter(s => s.is_allocatable)} disabled={busy} onChange={ids => updateAllocation(r.candidate_id, { targets: ids.map(id => r.targets.find(t => t.subsystem_id === id) ?? { subsystem_id: id, rationale: '' }) })} /><label>分配说明<textarea aria-label="分配说明" disabled={busy} value={r.note} onChange={e => updateAllocation(r.candidate_id, { note: e.target.value })} /></label><p>{r.dirty ? '未保存修改' : r.accepted ? '已确认' : '已保存，待确认'}</p><button className='button-secondary' disabled={busy || !r.dirty || !caps.includes(r.base ? 'FR_ALLOCATION.update' : 'FR_ALLOCATION.create')} onClick={() => saveAllocation(r)}>保存草稿</button><button className='button-primary' disabled={busy || r.dirty || r.accepted || !r.savedRevision || !r.targets.length || !caps.includes('FR_ALLOCATION.accept')} onClick={() => acceptAllocation(r)}>确认分配</button></div>)}
  </section>;
}

export function WorkflowPanel(props:Props){
  return props.mode==='fr'?<AppendFrPanel {...props}/>:<LegacyAllocationPanel {...props}/>;
}
