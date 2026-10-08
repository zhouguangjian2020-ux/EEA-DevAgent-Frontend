'use client';
import { useEffect, useRef, useState } from 'react';
import { getProjectWorkspace } from '@/lib/api/client';
import { createUuid } from '@/lib/uuid';
import { appendGenerated } from '@/features/workbench/append-api';
type Props={getTaskThread?:()=>string;project:string;featureId:string;active:boolean;onSaved:()=>Promise<unknown>;blockedReason?:string};
export function AppendFrPanel({project,featureId,onSaved,blockedReason,active,getTaskThread}:Props){
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
    try{
      const result=await appendGenerated(project,featureId,'FR',{client_request_id:id,thread_id:originThread.current},ac.signal);
      if(!alive.current||ac.signal.aborted)return;
      try { await onSaved(); }
      catch { setNotice(`已追加 ${result.items.length} 条待确认FR，但目录刷新失败；请刷新工作空间。`);requestId.current=null;return; }
      if(!alive.current)return;
      setNotice(`已追加 ${result.items.length} 条待确认FR，请到需求工程FR目录审阅。已有实例未覆盖。`);requestId.current=null;
    }catch(e){if(alive.current)setError((e instanceof Error&&e.name==='AbortError'?'已停止等待，后端可能仍完成保存':e instanceof Error?e.message:'生成失败')+'。重试将复用同一请求，不会重复创建。');}
    finally{running.current=false;controller.current=null;if(alive.current)setBusy(false);}
  }
  return <section className='workflow-panel' aria-label='FR生成并追加' aria-busy={busy}>
    <header className='workflow-toolbar'><strong>生成功能需求</strong><button className='button-primary' disabled={busy||!canCreate||Boolean(blockedReason)} onClick={()=>void generate()}>{busy?'正在生成并保存…':error?'重试本次FR生成':'生成 FR'}</button>{busy&&<button className='button-secondary' onClick={()=>controller.current?.abort()}>停止等待</button>}</header>
    <p>以当前功能的全部已确认UC为来源；成功后追加待确认FR，已有FR保留，确认仍需人工操作。</p>
    {blockedReason&&<p role='status'>{blockedReason}</p>}{notice&&<p role='status'>{notice}</p>}{error&&<p role='alert'>{error}</p>}
  </section>;
}
