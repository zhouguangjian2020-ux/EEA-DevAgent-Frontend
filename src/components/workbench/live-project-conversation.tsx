"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import { request } from '@/lib/api/client';
import { createUuid } from '@/lib/uuid';
import { saveManualRevision, type ManualContent } from '@/features/workbench/manual-api';
import { workflowPost, projectPath, readChatStream, type Modification, type Thread, type Turn } from '@/features/workbench/workflow-api';
import { ChatComposer } from '../workspace/chat-composer';
import type { ProjectConversationProps } from './project-conversation';
import { useTaskRecords } from '@/features/workbench/use-task-records';
import { conversationTimeline, taskLabel, readTaskRecords, type TaskRecord } from '@/features/workbench/task-records';
import './workflows.css';
import { PrdCreationInline } from './prd-creation-inline';
import { conversationFeatures, featureDisabledReason, prdForFeature } from '@/features/conversation/model';
import { canGenerateUcBatch } from '@/features/workbench/model';
type ChatInput = { client_request_id: string; message: string; auto_intent: true; attachments: { artifact_id: string; revision_id: string }[] };
const emptyPrdCreationState = { prompt: '', candidateName: null, input: null, intent: null, busy: false, phase: null, uncertain: false, notFound: false, error: '', notice: '' } as const;
const emptyPrdSnapshot = () => emptyPrdCreationState;
const noopSubscribe = () => () => {};
function ContentPreview({ content }: { content: ManualContent }) {
  if (content.kind === 'PRD') return <ReactMarkdown>{content.markdown_body}</ReactMarkdown>;
  return <dl>{Object.entries(content).filter(([k]) => !['kind', 'prd_revision_id', 'sources'].includes(k)).map(([k,v]) => <div key={k}><dt>{({name:'名称',description:'描述',main_flow:'主流程',branches:'分支流程',exceptions:'异常流程',acceptance_criteria:'验收标准',actors:'参与者',preconditions:'前置条件',postconditions:'后置条件',extensions:'扩展',hmi:'HMI逻辑',regulations:'法规',performance:'性能',nonfunctional:'非功能要求'} as Record<string,string>)[k] ?? k}</dt><dd>{Array.isArray(v) ? v.join(String.fromCharCode(10)) : String(v ?? '')}</dd></div>)}</dl>;
}
export function LiveProjectConversation(props: ProjectConversationProps) {
  const {project,state,visible,docked,onAction,onOpenObject,onSaved,onThreadChange,onMode,onPrdSubmit,onPrdModeExit,prdCreation}=props;
  const c=state.conversation, path=projectPath(project)+'/conversations';
  const prdState = useSyncExternalStore(prdCreation?.subscribe ?? noopSubscribe, prdCreation?.snapshot ?? emptyPrdSnapshot, prdCreation?.snapshot ?? emptyPrdSnapshot);
  const prdMode = c.mode === 'PRD';
  const prdBusy = Boolean(prdState.busy);
  const ucMode = c.mode === "UC";
  const ucFeatures = conversationFeatures(project, state, false);
  const ucSource = c.featureId ? prdForFeature(state, c.featureId) : undefined;
  const prdSubmitted = Boolean(prdState.input);
  const [threads,setThreads]=useState<Thread[]>([]),[thread,setThread]=useState(''),[next,setNext]=useState<number|null>(null);
  const [turns,setTurns]=useState<Turn[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const taskHistory = useTaskRecords(project, thread, visible);
  const timeline = conversationTimeline(turns, taskHistory.tasks);
  const [changes,setChanges]=useState<Modification[]>([]),[retry,setRetry]=useState<ChatInput>();
  const controller=useRef<AbortController|null>(null), running=useRef(false), epoch=useRef(0), createId=useRef(createUuid()), output=useRef<HTMLDivElement>(null), stick=useRef(true);
  const drafts=useRef(new Map<string,{prompt:string;attachments:typeof c.attachments}>());
  const initialThread=useRef<Promise<Thread>|null>(null),initialized=useRef(false);
  useEffect(() => { onThreadChange?.(thread); }, [thread, onThreadChange]);
  const [initializing,setInitializing]=useState(true);
  const listEpoch=useRef(0);
  const list=useCallback(async(offset=0)=>{const version=++listEpoch.current;const r=await request<{threads:Thread[];next_offset:number|null}>(path+'?offset='+offset);if(version!==listEpoch.current)return;setThreads(old=>offset?[...old,...r.threads.filter(t=>!old.some(o=>o.id===t.id))]:r.threads);setNext(r.next_offset);},[path]);
  useEffect(()=>{let alive=true;const version=++listEpoch.current;request<{threads:Thread[];next_offset:number|null}>(path).then(r=>{if(alive&&version===listEpoch.current){setThreads(old=>[...old.filter(t=>!r.threads.some(x=>x.id===t.id)),...r.threads]);setNext(r.next_offset);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;controller.current?.abort();};},[path]);
  useEffect(()=>{
    if(!visible||initialized.current)return;
    let alive=true;
    // Reuse the same promise and idempotency key across StrictMode effect replay.
    initialThread.current??=workflowPost<Thread>(path,{client_request_id:createId.current,title:'新会话'});
    initialThread.current.then(t=>{
      if(!alive)return;
      initialized.current=true;createId.current=createUuid();setThread(t.id);
      setThreads(old=>[t,...old.filter(x=>x.id!==t.id)]);setInitializing(false);
    }).catch(e=>{
      if(alive){initialThread.current=null;setInitializing(false);setError(e instanceof Error?e.message:'自动建立会话失败，请重试新建会话');}
    });
    return()=>{alive=false;};
  },[path,visible]);
  useEffect(()=>{if(!visible)controller.current?.abort();},[visible]);
  useEffect(()=>{if(visible&&stick.current&&output.current)output.current.scrollTop=output.current.scrollHeight;},[turns,changes,taskHistory.tasks,prdState,visible]);
  useEffect(()=>{if(visible&&prdMode)output.current?.parentElement?.querySelector<HTMLTextAreaElement>('textarea[aria-label="项目对话输入"]')?.focus();},[visible,prdMode]);
  useEffect(()=>{if(!changes.length)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[changes]);
  async function select(id:string) {
    if(running.current||loading||initializing)return;
    if(changes.length&&!window.confirm('切换会话将丢弃未应用的AI修改建议，原对象不变。继续？'))return;
    const version=++epoch.current;setLoading(true);setError('');
    try {
      const r=await request<{thread:Thread;turns:Turn[]}>(path+'/'+id);
      if(version!==epoch.current)return;
      drafts.current.set(thread,{prompt:c.prompt,attachments:c.attachments});
      const draft=drafts.current.get(id);
      c.attachments.forEach(a=>onAction({type:'remove-attachment',objectId:a.id}));
      if(draft?.attachments.length)onAction({type:'attach',objects:draft.attachments});
      onAction({type:'prompt',value:draft?.prompt??''});
      onMode?.(null);onThreadChange?.(id);setThread(id);setTurns(r.turns);setChanges([]);setRetry(undefined);setNotice('');
    } catch(e){setError(e instanceof Error?e.message:'读取会话失败');}
    finally{if(version===epoch.current)setLoading(false);}
  }
  async function newThread(){
    if(running.current||loading||initializing)return;
    if(changes.length&&!window.confirm('新建会话将丢弃未应用的AI修改建议。继续？'))return;
    running.current=true;setLoading(true);setError('');
    try {
      const t=await workflowPost<Thread>(path,{client_request_id:createId.current,title:'新会话'});
      initialized.current=true;createId.current=createUuid();drafts.current.set(thread,{prompt:c.prompt,attachments:c.attachments});
      onMode?.(null);onThreadChange?.(t.id);setThread(t.id);setTurns([]);setChanges([]);setRetry(undefined);setNotice('新会话已建立，历史按用户与项目隔离。');
      // Preserve newly supplied workspace attachments for the first thread only.
      if(thread){c.attachments.forEach(a=>onAction({type:'remove-attachment',objectId:a.id}));onAction({type:'prompt',value:''});}
      await list();
    }catch(e){setError(e instanceof Error?e.message:'新建失败');}finally{running.current=false;setLoading(false);}
  }
  async function send(previous?:ChatInput){
    if(running.current||loading||initializing||!thread||c.operation)return;
    let input:ChatInput;
    try {
      input=previous??{client_request_id:createUuid(),message:c.prompt.trim(),auto_intent:true,attachments:c.attachments.map(a=>{
        const w=Object.values(state.works).find(w=>w.id===a.workId||w.database?.artifactId===a.id);
        if(!w?.database?.revisionId)throw new Error('附件没有可读取的已保存版本，请刷新并重新添加。');
        return {artifact_id:w.database.artifactId,revision_id:w.database.revisionId};
      })};
      if(!input.message)throw new Error('请输入问题');
      if(changes.length&&!window.confirm('新请求将丢弃未应用修改建议。继续？'))return;
    }catch(e){setError(e instanceof Error?e.message:'附件无效');return;}
    const version=++epoch.current, ac=new AbortController();controller.current=ac;running.current=true;setBusy(true);setError('');setNotice('');setChanges([]);
    const row:Turn={client_request_id:input.client_request_id,prompt:input.message,body:'',status:'running',created_at:turns.find(t=>t.client_request_id===input.client_request_id)?.created_at??new Date().toISOString()};
    setTurns(old=>old.some(t=>t.client_request_id===input.client_request_id)?old.map(t=>t.client_request_id===input.client_request_id?row:t):[...old,row]);
    if(!previous)onAction({type:'prompt',value:''});
    const patch=(p:Partial<Turn>)=>setTurns(old=>old.map(t=>t.client_request_id===input.client_request_id?{...t,...p}:t));
    let text='';
    try {
      await readChatStream(path+'/'+thread+'/messages/stream',{...input,retry:Boolean(previous)},ac.signal,event=>{
        if(epoch.current!==version)return;
        if(event.type==='status')setNotice(event.message??'正在处理…');
        if(event.type==='token'){setNotice('');text+=event.content??'';patch({body:text});}
        if(event.type==='preview'){setNotice('');if(!Array.isArray(event.changes))throw new Error('修改预览格式异常');setChanges(event.changes);text='AI修改建议已生成；后续应用状态以对象版本为准。';patch({body:text});}
        if(event.type==='done')patch({status:'completed'});
      });
      if(version===epoch.current){setRetry(undefined);await list();}
    }catch(e){
      if(version===epoch.current){setNotice('');patch({status:ac.signal.aborted?'interrupted':'failed'});setChanges([]);setRetry(input);setError(ac.signal.aborted?'已停止，当前回复未完成。':e instanceof Error?e.message:'对话失败');}
    }finally{if(version===epoch.current){controller.current=null;running.current=false;setBusy(false);}}
  }
  async function apply(change:Modification){
    if(running.current)return;running.current=true;setBusy(true);setError('');
    try {
      await saveManualRevision(project,change.artifact_id,{mutation_id:change.candidate_id,base_revision_id:change.base_revision_id,content:change.content});
      setChanges(old=>old.filter(c=>c.candidate_id!==change.candidate_id));setNotice('已应用为新的待确认版本；历史确认版本保留，请到原对象页面确认。');
      await onSaved?.();
    }catch(e){setError(e instanceof Error?e.message:'应用失败，原对象未覆盖');}finally{running.current=false;setBusy(false);}
  }
  async function openTask(task: TaskRecord) {
    const version=epoch.current, selected=thread;
    try {
      const rows=await readTaskRecords(project,selected,new AbortController().signal);
      if(version!==epoch.current)return;
      const current=rows.find(t=>t.id===task.id);
      if(!current?.result_available||!current.result_refs.length)throw new Error('结果不可访问，可能已删除或权限变化。');
      await props.onOpenTaskResult?.(current.result_refs[0].artifact_id);
    }catch(e){if(version===epoch.current)setError(e instanceof Error?e.message:'读取任务结果失败');}
  }
  const locked=busy||loading||initializing||Boolean(c.operation);
  const contentLocked=locked||prdBusy;
  const inlineMatchesThread = !prdState.input?.thread_id || prdState.input.thread_id === thread;
  const inlineTask = prdCreation && inlineMatchesThread ? <PrdCreationInline key={prdState.input?.client_request_id ?? "empty"} session={prdCreation} onExit={onPrdModeExit} onStart={()=>onMode?.("PRD")} /> : null;
  const recordedCreation = taskHistory.tasks.some(t => t.task_kind === "PRD" && t.client_request_id === prdState.input?.client_request_id);
  const sendDisabledReason = initializing ? '正在自动准备新会话' : !thread ? '会话尚未建立，请重试新建会话' : loading ? '正在读取会话' : prdMode && prdSubmitted ? '本次PRD任务已提交，请在任务卡中继续或开始另一项需求' : ucMode ? '请选择功能后点击下方生成UC；输入框中的聊天草稿不会被发送' : undefined;
  const composerBusy = busy ? 'generate' : prdBusy ? 'generate' : c.operation ? 'expand' : null;
  return <section id={'panel-'+project+'-home'} hidden={!visible} role={docked?'complementary':'tabpanel'} aria-label='项目私有AI对话' className={'project-conversation live-project-conversation'+(docked?' docked':' centered')} data-testid='project-conversation'>
    <header className='conversation-thread-toolbar'><label>我的会话<select aria-label='选择会话' value={thread} disabled={locked} onChange={e=>void select(e.target.value)}><option value='' disabled>{initializing?'正在准备新会话…':'请选择会话'}</option>{threads.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><button className='button-secondary' disabled={locked} onClick={()=>void newThread()}>新建会话</button>{next!==null&&<button disabled={locked} onClick={()=>void list(next).catch(e=>setError(e.message))}>更多会话</button>}</header>
    <div className='conversation-output' role='log' aria-label='项目对话记录' aria-live='polite' ref={output} onScroll={e=>{const el=e.currentTarget;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
      {!thread&&<p>{initializing?'正在自动准备新会话…':'会话尚未建立，可点击新建会话重试。'}聊天历史按用户与项目隔离，刷新及重新登录后仍可读取。</p>}
      {thread && !timeline.length && !prdState.input && <div className='conversation-welcome'><span className='conversation-eyebrow'>从一个问题开始</span><h1>{docked ? '对话始终在这里' : '今天，我们一起梳理什么？'}</h1><p>直接提问，或选择输入框下方的快捷任务。<br />PRD生成会先识别功能，再创建功能与待确认PRD。</p><div className='conversation-suggestions'><button disabled={contentLocked} onClick={()=>onAction({type:'prompt',value:'请解释 PRD 与用例的区别。'})}>PRD 与用例有什么区别？ <span>↗</span></button><button disabled={contentLocked} onClick={()=>onAction({type:'prompt',value:'如何梳理功能的使用场景和异常边界？'})}>如何梳理功能边界？ <span>↗</span></button></div></div>}
      {thread&&<div className='conversation-task-tools'><button className='button-secondary' onClick={taskHistory.refresh}>刷新任务记录</button>{taskHistory.error&&<small role='status'>{taskHistory.error}</small>}</div>}
      {timeline.map(entry=>{
        if(entry.task){const t=entry.task;return <article key={entry.key} className='conversation-task-card' data-task-id={t.id} data-task-status={t.status} aria-label='生成任务记录'><strong>系统任务 · {t.task_kind}</strong><p>{taskLabel(t)}</p><small>{new Date(t.created_at).toLocaleTimeString()}</small>{t.task_kind === 'PRD' && t.client_request_id === prdState.input?.client_request_id && inlineTask}{t.result_available&&t.result_refs.length>0&&<button className='button-secondary' onClick={()=>void openTask(t)}>查看已保存结果{t.result_refs.length>1?'（首条）':''}</button>}</article>;}
        const t=entry.turn;return <div key={entry.key} className='live-chat-turn'><article className='conversation-message user'><strong>我</strong><p>{t.prompt}</p></article><article className='conversation-message assistant'><strong>Agent</strong><ReactMarkdown>{t.body}</ReactMarkdown><small>{({running:'生成中…',completed:'已完成',interrupted:'已中断',failed:'未完成'} as Record<string,string>)[t.status]??t.status}</small></article></div>;
      })}
      {!recordedCreation && inlineTask}
      {changes.map(change=><section className='chat-modification-preview' key={change.candidate_id}><header><strong>AI修改预览 · {change.content.kind}</strong><small>基于版本 {change.base_revision_id}</small></header>{change.original_content&&<details><summary>查看原内容</summary><ContentPreview content={change.original_content}/></details>}<ContentPreview content={change.content}/><footer><button className='button-primary' disabled={contentLocked} onClick={()=>void apply(change)}>应用为待确认版本</button><button className='button-secondary' disabled={locked} onClick={()=>setChanges(old=>old.filter(c=>c.candidate_id!==change.candidate_id))}>丢弃建议</button></footer></section>)}
      {c.notice&&<p role='status'>{c.notice}</p>}{notice&&<p role='status'>{notice}</p>}{c.error&&<div role='alert'><p>{c.error.message}</p><button disabled={locked} onClick={()=>props.onSend('expand',true)}>重试自动扩写</button></div>}{error&&<div role='alert' className='conversation-error'><p>{error}</p>{retry&&<button className='button-secondary' disabled={locked} onClick={()=>void send(retry)}>重试原请求</button>}</div>}
    </div>
    <div className='conversation-composer-area'><ChatComposer label='项目对话输入' disabledReason={loading ? '正在切换会话，请稍候…' : undefined} placeholder={prdMode ? '输入新功能名称与需求，例如：AEB自动紧急制动…' : '输入问题，或从工作空间添加对象…'} value={c.expansionPreview??c.prompt} onChange={value=>onAction({type:'prompt',value})} onSend={()=>prdMode && onPrdSubmit ? onPrdSubmit(c.prompt) : void send()} onExpand={()=>props.onSend('expand')} onCancel={()=>prdCreation?.snapshot().busy ? prdCreation.stop() : controller.current?controller.current.abort():props.onStop()} busy={composerBusy} compact={docked} attachments={c.attachments} attachmentsLocked={contentLocked} onRemoveAttachment={objectId=>onAction({type:'remove-attachment',objectId})} onOpenAttachment={onOpenObject} sendDisabledReason={sendDisabledReason}/><div className='conversation-shortcuts' aria-label='快捷生成'>
        {(['PRD','UC'] as const).map(mode=><button key={mode} type='button' aria-pressed={c.mode===mode} className={c.mode===mode?'selected':''} disabled={contentLocked} onClick={()=>onMode?.(c.mode===mode?null:mode)}><span aria-hidden='true'>{c.mode===mode?'✓':'+'}</span>{mode==='PRD'?'PRD生成':'用例生成'}{c.mode===mode&&<span className='shortcut-cancel' aria-hidden='true'>×</span>}</button>)}
      </div>
      {ucMode && <div className='conversation-uc-shortcut' aria-label='用例生成来源'>
        <label>业务功能<select aria-label='业务功能' value={c.featureId??''} disabled={contentLocked} onChange={e=>onAction({type:'feature',featureId:e.target.value||null})}><option value=''>请选择已确认PRD的功能</option>{ucFeatures.map(f=>{const reason=featureDisabledReason(state,'UC',f.id);return <option key={f.id} value={f.id} disabled={Boolean(reason)}>{f.name}{reason?' · '+reason:''}</option>;})}</select></label>
        <button className='button-primary' disabled={contentLocked||!thread||!ucSource||!canGenerateUcBatch(ucSource)||!state.capabilities?.includes('UC.create')} onClick={()=>ucSource&&props.onGenerateUcs?.(ucSource.id)}>生成UC</button>
        <small>仅使用所选功能的已确认PRD；输入框中的聊天草稿保留，不随本任务发送。</small>
      </div>}
      <small>{prdMode?'在这里输入需求并发送；先识别功能，再生成并保存待确认PRD。':'仅读取主动添加的已保存对象附件；未添加时不自动附带当前标签内容。'}</small>
    </div>
  </section>;
}
