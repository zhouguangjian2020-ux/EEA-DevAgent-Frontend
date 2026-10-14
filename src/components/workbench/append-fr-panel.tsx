'use client';
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getProjectWorkspace } from '@/lib/api/client';
import { createUuid } from '@/lib/uuid';
import { appendGenerated } from '@/features/workbench/append-api';
import { startTaskFeedback } from '@/features/workbench/task-feedback';
type Props={getTaskThread?:()=>string;project:string;featureId:string;featureName?:string;active:boolean;onSaved:()=>Promise<unknown>;blockedReason?:string;onGenerated?:(originThread?:string)=>void;render?:(actions:ReactNode,feedback:ReactNode)=>ReactNode};
export function AppendFrPanel({project,featureId,featureName,onSaved,blockedReason,active,getTaskThread,render,onGenerated}:Props){
  const { t: tr } = useI18n();
  const [canCreate,setCanCreate]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const originThread=useRef<string|undefined>(undefined);
  const controller=useRef<AbortController|null>(null),requestId=useRef<string|null>(null),running=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
  useEffect(()=>{let current=true;if(active)getProjectWorkspace(project).then(ws=>{if(current){const f=ws.functions.find(x=>x.id===featureId);setCanCreate((f?.workflow_capabilities??ws.capabilities??[]).includes('FR.create'));}}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[active,project,featureId]);
  async function generate(){
    if(running.current||!canCreate)return;
    if(blockedReason){setError(blockedReason);return;}
    running.current=true;setBusy(true);setError('');setNotice('');
    const id=requestId.current??createUuid();
    try { if(!requestId.current) originThread.current=getTaskThread?.(); }
    catch(e) { setError(e instanceof Error?e.message:'会话尚未就绪');running.current=false;setBusy(false);return; }
    requestId.current=id;
    const ac=new AbortController();controller.current=ac;
    const feedback = startTaskFeedback(project, originThread.current, id, 'FR', featureId, featureName);
    try{
      const result=await appendGenerated(project,featureId,'FR',{client_request_id:id,thread_id:originThread.current},ac.signal);
      if(!alive.current||ac.signal.aborted)return;
      feedback.complete(result.items.length);
      try { await onSaved(); }
      catch { setNotice(`已追加 ${result.items.length} 条待确认FR，但目录刷新失败；请刷新工作空间。`);requestId.current=null;return; }
      if(!alive.current)return;
      setNotice(`已追加 ${result.items.length} 条待确认FR，请到需求工程FR目录审阅。已有实例未覆盖。`);requestId.current=null;onGenerated?.(originThread.current);
    }catch(e){if(alive.current)setError((e instanceof Error&&e.name==='AbortError'?'已停止等待，后端可能仍完成保存':e instanceof Error?e.message:'生成失败')+'。重试将复用同一请求，不会重复创建。');}
    finally{feedback.unresolved();running.current=false;controller.current=null;if(alive.current)setBusy(false);}
  }
  const actions = <>
    <button type="button" className="button-primary" disabled={busy || !canCreate || Boolean(blockedReason)} title={!canCreate ? tr("当前账号无创建权限或业务写入未启用") : undefined} onClick={() => void generate()}>{busy ? tr("正在生成并保存…") : error ? tr("重试本次FR生成") : tr("生成 FR")}</button>
    {busy && <button type="button" className="button-secondary" onClick={() => controller.current?.abort()}>{tr("停止等待")}</button>}
  </>;
  const feedback = (notice || error) ? <div className="panorama-generation-feedback">
    {notice && <p role="status">{tr(notice)}</p>}
    {error && <p role="alert">{tr(error)}</p>}
  </div> : null;
  if (render) return render(actions, feedback);
  return <section className='workflow-panel' aria-label={tr("FR生成并追加")} aria-busy={busy}>
    <header className='workflow-toolbar'><strong>{tr("生成功能需求")}</strong>{actions}</header>
    <p>{tr("以当前功能的全部已确认UC为来源；成功后追加待确认FR，已有FR保留，确认仍需人工操作。")}</p>
    {notice&&<p role='status'>{tr(notice)}</p>}{error&&<p role='alert'>{tr(error)}</p>}
  </section>;
}
