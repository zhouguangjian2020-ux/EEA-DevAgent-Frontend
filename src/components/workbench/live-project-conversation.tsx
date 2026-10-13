"use client";
import { LoadingIllustration } from "@/components/feedback/loading";
import { TaskProgress } from "@/components/feedback/task-progress";
import { canSubmitComposer } from "@/features/conversation/composer-eligibility";
import { useI18n } from "@/features/i18n/provider";
import { AgentTaskDuration } from "./agent-task-duration";
import { validDurationMs } from "@/features/conversation/task-duration";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AgentMarkdown } from "./agent-markdown";
import { ConversationAttachments } from "./conversation-attachments";
import { chatAttachmentItems } from "@/features/conversation/attachments";
import { request } from '@/lib/api/client';
import { createUuid } from '@/lib/uuid';
import { saveManualRevision, type ManualContent } from '@/features/workbench/manual-api';
import { workflowPost, projectPath, readChatStream, type Modification, type Thread, type Turn } from '@/features/workbench/workflow-api';
import { ConversationHistoryMenu } from "./conversation-history-menu";
import { ChatComposer } from '../workspace/chat-composer';
import type { ProjectConversationProps } from './project-conversation';
import { useTaskRecords } from '@/features/workbench/use-task-records';
import { conversationTimeline, taskRequestPrompt, taskFailureMessage } from '@/features/workbench/task-records';
import './workflows.css';
import { PrdCreationInline } from './prd-creation-inline';
import { ConversationTaskMessage } from './conversation-task-message';
import { canResetCreation, canRetryCreation } from '@/features/prd/creation';
import { parsePrdCommand } from '@/features/conversation/prd-command';
import { restoreConversation, type ConversationHistory } from '@/features/conversation/restore-history';
import { conversationFeatures, featureDisabledReason, prdForFeature } from '@/features/conversation/model';
import { canGenerateUcBatch } from '@/features/workbench/model';
type ChatInput = { client_request_id: string; message: string; auto_intent: true; attachments: { artifact_id: string; revision_id: string }[] };
const emptyPrdCreationState = { prompt: '', candidateName: null, input: null, intent: null, busy: false, phase: null, uncertain: false, notFound: false, error: '', notice: '' } as const;
const emptyPrdSnapshot = () => emptyPrdCreationState;
const noopSubscribe = () => () => {};
function ContentPreview({ content }: { content: ManualContent }) {
  const { t: tr } = useI18n();
  if (content.kind === 'PRD') return <AgentMarkdown>{content.markdown_body}</AgentMarkdown>;
  return <dl>{Object.entries(content).filter(([k]) => !['kind', 'prd_revision_id', 'sources'].includes(k)).map(([k,v]) => <div key={k}><dt>{({name:tr("名称"),description:tr("描述"),main_flow:tr("主流程"),branches:tr("分支流程"),exceptions:tr("异常流程"),acceptance_criteria:tr("验收标准"),actors:tr("参与者"),preconditions:tr("前置条件"),postconditions:tr("后置条件"),extensions:tr("扩展"),hmi:tr("HMI逻辑"),regulations:tr("法规"),performance:tr("性能"),nonfunctional:tr("非功能要求")} as Record<string,string>)[k] ?? k}</dt><dd>{Array.isArray(v) ? v.join(String.fromCharCode(10)) : String(v ?? '')}</dd></div>)}</dl>;
}
export function LiveProjectConversation(props: ProjectConversationProps) {
  const { t: tr } = useI18n();
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
  const [turnMessages, setTurnMessages] = useState<Record<string, string>>({});
  const taskHistory = useTaskRecords(project, thread, visible);
  const timeline = conversationTimeline(turns, taskHistory.tasks);
  const [recoveryRequest,setRecoveryRequest]=useState('');
  const [changes,setChanges]=useState<Modification[]>([]),[retry,setRetry]=useState<ChatInput>();
  const controller=useRef<AbortController|null>(null), running=useRef(false), epoch=useRef(0), createId=useRef(createUuid()), output=useRef<HTMLDivElement>(null), stick=useRef(true);
  const drafts=useRef(new Map<string,{prompt:string;attachments:typeof c.attachments}>());
  const initialThread=useRef<Promise<ConversationHistory>|null>(null),initialized=useRef(false);
  useEffect(() => {
    onThreadChange?.(thread);
    if (thread) { try { sessionStorage.setItem('ee-last-thread:'+project, thread); } catch { /* Optional UI hint, never credentials or content. */ } }
  }, [thread, onThreadChange, project]);
  const [initializing,setInitializing]=useState(true);
  const listEpoch=useRef(0);
  const list=useCallback(async(offset=0)=>{const version=++listEpoch.current;const r=await request<{threads:Thread[];next_offset:number|null}>(path+'?offset='+offset);if(version!==listEpoch.current)return;setThreads(old=>offset?[...old,...r.threads.filter(t=>!old.some(o=>o.id===t.id))]:r.threads);setNext(r.next_offset);},[path]);
  useEffect(()=>{let alive=true;const version=++listEpoch.current;request<{threads:Thread[];next_offset:number|null}>(path).then(r=>{if(alive&&version===listEpoch.current){setThreads(old=>[...old.filter(t=>!r.threads.some(x=>x.id===t.id)),...r.threads]);setNext(r.next_offset);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;controller.current?.abort();};},[path]);
  useEffect(()=>{
    if(!visible||initialized.current)return;
    let alive=true;
    // Reuse the same promise and idempotency key across StrictMode effect replay.
    let preferred: string | undefined;
    try { preferred=sessionStorage.getItem('ee-last-thread:'+project)??undefined; } catch { /* Read from the server instead. */ }
    initialThread.current??=restoreConversation(path,createId.current,preferred);
    initialThread.current.then(history=>{
      const t=history.thread;
      if(!alive)return;
      initialized.current=true;createId.current=createUuid();setThread(t.id);setTurns(history.turns);
      setThreads(old=>[t,...old.filter(x=>x.id!==t.id)]);setInitializing(false);
    }).catch(e=>{
      if(alive){initialThread.current=null;setInitializing(false);setError(e instanceof Error?e.message:'自动建立会话失败，请重试新建会话');}
    });
    return()=>{alive=false;};
  },[path,project,visible]);
  useEffect(()=>{if(!visible)controller.current?.abort();},[visible]);
  useEffect(()=>{if(visible&&stick.current&&output.current)output.current.scrollTop=output.current.scrollHeight;},[turns,changes,taskHistory.tasks,prdState,visible]);
  useEffect(()=>{if(visible&&prdMode)output.current?.parentElement?.querySelector<HTMLTextAreaElement>('textarea[aria-label="项目对话输入"]')?.focus();},[visible,prdMode]);
  useEffect(()=>{if(!changes.length)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[changes]);
  async function select(id:string) {
    if(running.current||loading||initializing)return;
    if(changes.length&&!window.confirm(tr('切换会话将丢弃未应用的AI修改建议，原对象不变。继续？')))return;
    const version=++epoch.current;setLoading(true);setError('');
    try {
      const r=await request<{thread:Thread;turns:Turn[]}>(path+'/'+id);
      if(version!==epoch.current)return;
      drafts.current.set(thread,{prompt:c.prompt,attachments:c.attachments});
      const draft=drafts.current.get(id);
      c.attachments.forEach(a=>onAction({type:'remove-attachment',objectId:a.id}));
      if(draft?.attachments.length)onAction({type:'attach',objects:draft.attachments});
      onAction({type:'prompt',value:draft?.prompt??''});
      setRecoveryRequest('');onMode?.(null);onThreadChange?.(id);setThread(id);setTurns(r.turns);setChanges([]);setRetry(undefined);setNotice('');
    } catch(e){setError(e instanceof Error?e.message:'读取会话失败');}
    finally{if(version===epoch.current)setLoading(false);}
  }
  async function newThread(){
    if(running.current||loading||initializing)return;
    if(changes.length&&!window.confirm(tr('新建会话将丢弃未应用的AI修改建议。继续？')))return;
    running.current=true;setLoading(true);setError('');
    try {
      const t=await workflowPost<Thread>(path,{client_request_id:createId.current,title:'新会话'});
      initialized.current=true;createId.current=createUuid();drafts.current.set(thread,{prompt:c.prompt,attachments:c.attachments});
      setRecoveryRequest('');onMode?.(null);onThreadChange?.(t.id);setThread(t.id);setTurns([]);setChanges([]);setRetry(undefined);setNotice('新会话已建立，历史按用户与项目隔离。');
      // Preserve newly supplied workspace attachments for the first thread only.
      if(thread){c.attachments.forEach(a=>onAction({type:'remove-attachment',objectId:a.id}));onAction({type:'prompt',value:''});}
      await list();
    }catch(e){setError(e instanceof Error?e.message:'新建失败');}finally{running.current=false;setLoading(false);}
  }
  async function submitComposer() {
    if (running.current || !canSubmitComposer(c.prompt, contentLocked, undefined, sendDisabledReason)) return;
    if (prdMode) {
      if (c.featureId && featureDisabledReason(state, 'PRD', c.featureId)) { setError('该功能已有PRD，不能重复生成。'); return; }
      onPrdSubmit?.(c.prompt, c.featureId || undefined); return;
    }
    if (!c.attachments.length) {
      const command = parsePrdCommand(c.prompt, project, state);
      if (command?.kind === 'clarify') { setNotice(command.message); return; }
      if (command?.kind === 'generate') {
        if (prdState.input) {
          if (!canResetCreation(prdState)) { setNotice('原PRD任务尚未核实或结束，请先在顶部任务恢复中处理原任务。'); return; }
          prdCreation?.reset();
        }
        onPrdSubmit?.(c.prompt, command.targetFunctionId, command.newFunctionName); return;
      }
    }
    await send();
  }
  async function restorePrd() {
    if (!recoveryRequest || !prdCreation || contentLocked || !taskHistory.tasks.some(t => t.task_kind === 'PRD' && t.client_request_id === recoveryRequest)) return;
    await prdCreation.restore(recoveryRequest);
  }
  async function send(previous?:ChatInput){
    if(running.current||loading||initializing||!thread||c.operation||prdBusy)return;
    let input:ChatInput;
    try {
      input=previous??{client_request_id:createUuid(),message:c.prompt.trim(),auto_intent:true,attachments:c.attachments.map(a=>{
        const w=Object.values(state.works).find(w=>w.id===a.workId||w.database?.artifactId===a.id);
        if(!w?.database?.revisionId)throw new Error('附件没有可读取的已保存版本，请刷新并重新添加。');
        return {artifact_id:w.database.artifactId,revision_id:w.database.revisionId};
      })};
      if(!input.message)throw new Error('请输入问题');
      if(changes.length&&!window.confirm(tr('新请求将丢弃未应用修改建议。继续？')))return;
    }catch(e){setError(e instanceof Error?e.message:'附件无效');return;}
    const version=++epoch.current, ac=new AbortController();controller.current=ac;running.current=true;setBusy(true);setError('');setNotice('');setChanges([]);
    const attachments = previous ? turns.find(t => t.client_request_id === input.client_request_id)?.attachments ?? input.attachments
      : input.attachments.map((ref, i) => ({ ...ref, content: { kind: c.attachments[i].kind, name: c.attachments[i].name } }));
    const row:Turn={attachments,duration_ms:null,client_request_id:input.client_request_id,prompt:input.message,body:'',status:'running',created_at:turns.find(t=>t.client_request_id===input.client_request_id)?.created_at??new Date().toISOString()};
    setTurns(old=>old.some(t=>t.client_request_id===input.client_request_id)?old.map(t=>t.client_request_id===input.client_request_id?row:t):[...old,row]);
    if(!previous) {
      onAction({type:'prompt',value:''});
      c.attachments.forEach(a => onAction({type:'remove-attachment',objectId:a.id}));
    }
    const patch=(p:Partial<Turn>)=>setTurns(old=>old.map(t=>t.client_request_id===input.client_request_id?{...t,...p}:t));
    const setTurnMessage = (message: string) => setTurnMessages(old => ({ ...old, [input.client_request_id]: message }));
    setTurnMessage('');
    let text='';
    try {
      await readChatStream(path+'/'+thread+'/messages/stream',{...input,retry:Boolean(previous)},ac.signal,event=>{
        if(epoch.current!==version)return;
        if(event.type==='status')setTurnMessage(event.message??'正在处理…');
        if(event.type==='token'){setTurnMessage('');text+=event.content??'';patch({body:text});}
        if(event.type==='replace'){setTurnMessage('');text=event.content??'';patch({body:text});}
        if(event.type==='preview'){setTurnMessage('');if(!Array.isArray(event.changes))throw new Error('修改预览格式异常');setChanges(event.changes);text='AI修改建议已生成；后续应用状态以对象版本为准。';patch({body:text});}
        if(event.type==='done'){setTurnMessage('');patch({status:'completed',duration_ms:validDurationMs(event.duration_ms)});}
        if(event.type==='error')patch({duration_ms:validDurationMs(event.duration_ms)});
      });
      if(version===epoch.current){setRetry(undefined);await list().catch(() => { if(version===epoch.current)setNotice("回复已完成；会话列表暂时未刷新，可稍后重读。"); });}
    }catch(e){
      if(version===epoch.current){setNotice('');patch({status:ac.signal.aborted?'interrupted':'failed'});setChanges([]);setRetry(input);setTurnMessage(ac.signal.aborted?'已停止，当前回复未完成。':e instanceof Error?e.message:'对话失败');}
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
  const locked=busy||loading||initializing||Boolean(c.operation);
  const contentLocked=locked||prdBusy;
  const inlineMatchesThread = !prdState.input?.thread_id || prdState.input.thread_id === thread;
  const inlineTask = prdCreation && inlineMatchesThread ? <PrdCreationInline key={prdState.input?.client_request_id ?? "empty"} session={prdCreation} onExit={onPrdModeExit} onStart={()=>onMode?.("PRD")} /> : null;
  const recordedCreation = taskHistory.tasks.some(t => t.task_kind === "PRD" && t.client_request_id === prdState.input?.client_request_id);
  const sendDisabledReason = initializing ? '正在自动准备新会话' : !thread ? '会话尚未建立，请重试新建会话' : loading ? '正在读取会话' : prdMode && !onPrdSubmit ? '当前入口不能生成PRD' : prdMode && c.featureId && featureDisabledReason(state, 'PRD', c.featureId) ? '该功能已有PRD，不能重复生成。' : prdMode && prdSubmitted ? '本次PRD任务已提交；请在顶部任务恢复中核对原任务' : ucMode ? '请选择功能后点击下方生成UC；输入框中的聊天草稿不会被发送' : undefined;
  const composerBusy = busy ? 'generate' : prdBusy ? 'generate' : c.operation ? 'expand' : null;
  const needsPrdRecovery = Boolean(prdState.input && !['saved','blocked'].includes(prdState.intent?.status ?? ''));
  const recoverableTasks = taskHistory.tasks.filter(t=>t.task_kind==='PRD'&&t.request_message&&['running','waiting_choice','failed','needs_verification'].includes(t.status)&&!['function_name_conflict','prd_exists'].includes(t.request_error_code??''));
  return <section id={'panel-'+project+'-home'} hidden={!visible} role={docked?'complementary':'tabpanel'} aria-label={tr("项目私有AI对话")} className={'project-conversation live-project-conversation'+(docked?' docked':' centered')} data-testid='project-conversation'>
    <header className='conversation-thread-toolbar'>{visible && <ConversationHistoryMenu threads={threads} selectedId={thread} disabled={locked} initializing={initializing} hasMore={next !== null} onSelect={select} onCreate={newThread} onMore={() => next !== null ? list(next).catch(e => setError(e.message)) : Promise.resolve()}>
      {(needsPrdRecovery || recoverableTasks.length > 0 || taskHistory.error) && <details className='conversation-task-recovery'><summary>{tr("任务恢复")}</summary><div className='conversation-input-actions'>
        {prdCreation && needsPrdRecovery && <>
          <button disabled={contentLocked} onClick={()=>void prdCreation.refresh()}>{tr("读取原任务状态")}</button>
          <button disabled={contentLocked||!canRetryCreation(prdState)} onClick={()=>void prdCreation.retry()}>{tr("继续或重试原PRD任务")}</button>
          <button disabled={contentLocked||!canResetCreation(prdState)} onClick={()=>{prdCreation.reset();onMode?.('PRD');}}>{tr("开始新PRD需求")}</button>
        </>}
        {prdCreation && recoverableTasks.length > 0 && <>
          <label>{tr("恢复PRD任务")}<select aria-label={tr("恢复PRD任务")} value={recoveryRequest} disabled={contentLocked} onChange={e=>setRecoveryRequest(e.target.value)}>
            <option value=''>{tr("选择原任务")}</option>{recoverableTasks.map(t=><option key={t.id} value={t.client_request_id}>{t.request_message?.slice(0,40)}</option>)}
          </select></label><button disabled={contentLocked||!recoveryRequest} onClick={()=>void restorePrd()}>{tr("读取所选任务")}</button>
        </>}
        {taskHistory.error&&<button disabled={contentLocked} onClick={taskHistory.refresh}>{tr("重新读取任务记录")}</button>}
      </div></details>}</ConversationHistoryMenu>}</header>
    <div className='conversation-output' role='log' aria-label={tr("项目对话记录")} aria-live='polite' ref={output} onScroll={e=>{const el=e.currentTarget;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
      {!thread && (initializing ? <LoadingIllustration kind="orbit" label={tr("正在自动准备新会话…")} compact /> : <p>{tr("会话尚未建立，可点击新建会话重试。")}{tr("聊天历史按用户与项目隔离，刷新及重新登录后仍可读取。")}</p>)}
      {thread && !timeline.length && !prdState.input && <div className='conversation-welcome'><span className='conversation-eyebrow'>{tr("从一个问题开始")}</span><h1>{docked ? tr("对话始终在这里") : tr("今天，我们一起梳理什么？")}</h1><p>{tr("直接提问，或选择输入框下方的快捷任务。")}</p></div>}
      {taskHistory.error&&<p role='status'>{tr(taskHistory.error)}</p>}
      {timeline.map(entry=>{
        if(entry.task){const t=entry.task;return <ConversationTaskMessage key={entry.key} task={t} requestPrompt={taskRequestPrompt(t, state, tr)} failureMessage={taskFailureMessage(t, state)} current={t.task_kind==='PRD'&&inlineMatchesThread&&t.client_request_id===prdState.input?.client_request_id?prdState:undefined}/>;}
        const t=entry.turn;return <div key={entry.key} className='live-chat-turn'><ConversationAttachments items={chatAttachmentItems(t.attachments)} /><article className='conversation-message user'><p>{t.prompt}</p></article><article className='conversation-message assistant'><AgentTaskDuration durationMs={t.duration_ms} status={t.status}/><AgentMarkdown>{t.body}</AgentMarkdown><small><TaskProgress text={t.status === "running" ? turnMessages[t.client_request_id] || "生成中…" : ({completed:"已完成",interrupted:"已中断",failed:"未完成"} as Record<string,string>)[t.status] ?? t.status} pending={t.status === "running"} /></small>{t.status !== "running" && turnMessages[t.client_request_id] && <p role="alert" className="chat-turn-error">{tr(turnMessages[t.client_request_id])}</p>}</article></div>;
      })}
      {!recordedCreation && inlineTask}
      {changes.map(change=><article className='conversation-message assistant' key={change.candidate_id}><strong>{tr("修改建议 · ")}{change.content.kind}</strong><small>{tr("基于版本 ")}{change.base_revision_id}{tr("，尚未应用")}</small>{change.original_content&&<><p>{tr("原内容")}</p><ContentPreview content={change.original_content}/></>}<p>{tr("建议内容")}</p><ContentPreview content={change.content}/></article>)}
      {c.notice&&<p role='status'>{tr(c.notice)}</p>}{notice&&<p role='status'>{tr(notice)}</p>}{c.error&&<div role='alert'><p>{tr(c.error.message)}</p></div>}{error&&<div role='alert' className='conversation-error'><p>{tr(error)}</p></div>}
    </div>
    <div className='conversation-composer-area'><ChatComposer label={tr("项目对话输入")} disabledReason={loading ? tr("正在切换会话，请稍候…") : undefined} placeholder={prdMode ? tr("输入新功能名称与需求，例如：AEB自动紧急制动…") : tr("输入问题，或从工作空间添加对象…")} value={c.expansionPreview??c.prompt} onChange={value=>onAction({type:'prompt',value})} onSend={()=>void submitComposer()} onExpand={()=>props.onSend('expand')} onCancel={()=>prdCreation?.snapshot().busy ? prdCreation.stop() : controller.current?controller.current.abort():props.onStop()} busy={composerBusy} compact={docked} attachments={c.attachments} attachmentsLocked={contentLocked} onRemoveAttachment={objectId=>onAction({type:'remove-attachment',objectId})} onOpenAttachment={onOpenObject} sendDisabledReason={sendDisabledReason}/><div className='conversation-shortcuts' aria-label={tr("快捷生成")}>
        {(['PRD','UC'] as const).filter(mode=>!c.mode||c.mode===mode).map(mode=><button key={mode} type='button' aria-pressed={c.mode===mode} className={c.mode===mode?'selected':''} disabled={contentLocked} onClick={()=>onMode?.(c.mode===mode?null:mode)}><span aria-hidden='true'>{c.mode===mode?'✓':'+'}</span>{mode==='PRD'?tr("PRD生成"):tr("用例生成")}{c.mode===mode&&<span className='shortcut-cancel' aria-hidden='true'>×</span>}</button>)}
      {!c.mode && props.onCreateFunction && <><span className="conversation-shortcut-divider" role="separator" aria-orientation="vertical" /><button type="button" className="conversation-create-function" disabled={contentLocked || props.createFunctionDisabled} title={props.createFunctionDisabledReason ? tr(props.createFunctionDisabledReason) : undefined} onClick={props.onCreateFunction}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>{tr("新建功能")}</button></>}
      {prdMode && <div className='conversation-feature-inline'>
        <label htmlFor={'prd-function-'+project}>{tr("功能选择（可选）")}</label>
        <select id={'prd-function-'+project} aria-label={tr("PRD功能选择（可选）")} value={c.featureId??''} disabled={contentLocked||prdSubmitted} onChange={e=>onAction({type:'feature',featureId:e.target.value||null})}>
          <option value=''>{tr("不选择：创建新功能及PRD")}</option>
          {ucFeatures.map(f=>{const reason=featureDisabledReason(state,'PRD',f.id);return <option key={f.id} value={f.id} disabled={Boolean(reason)}>{f.name}{reason?' · '+reason:''}</option>;})}
        </select>
      </div>}
      {ucMode && <div className='conversation-feature-inline' aria-label={tr("用例生成来源")}>
        <label htmlFor={"uc-function-"+project}>{tr("业务功能")}</label><select id={"uc-function-"+project} aria-label={tr("业务功能")} value={c.featureId??''} disabled={contentLocked} onChange={e=>onAction({type:'feature',featureId:e.target.value||null})}><option value=''>{tr("请选择已确认PRD的功能")}</option>{ucFeatures.map(f=>{const reason=featureDisabledReason(state,'UC',f.id);return <option key={f.id} value={f.id} disabled={Boolean(reason)}>{f.name}{reason?' · '+reason:''}</option>;})}</select>
        <button className='button-primary' title={tr("仅使用所选功能的已确认PRD；输入框中的聊天草稿保留，不随本任务发送。")} disabled={contentLocked||!thread||!ucSource||!canGenerateUcBatch(ucSource)||!state.capabilities?.includes('UC.create')} onClick={()=>ucSource&&props.onGenerateUcs?.(ucSource.id)}>{tr("生成UC")}</button>
      </div>}
      </div>
      <div className='conversation-input-actions' aria-label={tr("输入区任务操作")}>
        {retry&&<button disabled={contentLocked} onClick={()=>void send(retry)}>{tr("重试原对话请求")}</button>}
        {c.error&&<button disabled={contentLocked} onClick={()=>props.onSend('expand',true)}>{tr("重试自动扩写")}</button>}
        {changes.map((change,index)=><div key={change.candidate_id}><span>{tr("修改建议 ")}{index+1} · {change.content.kind}</span><button disabled={contentLocked} onClick={()=>void apply(change)}>{tr("应用为待确认版本")}</button><button disabled={contentLocked} onClick={()=>setChanges(old=>old.filter(c=>c.candidate_id!==change.candidate_id))}>{tr("丢弃建议")}</button></div>)}
      </div>
    </div>
  </section>;
}
