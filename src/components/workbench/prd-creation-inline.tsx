"use client";

import { useSyncExternalStore } from "react";
import {
  PrdCreationSession,
  canChooseCreation,
  canResetCreation,
  canRetryCreation,
  creationInFlight,
} from "@/features/prd/creation";

function statusText(state: ReturnType<PrdCreationSession["snapshot"]>) {
  const intent = state.intent;
  return state.busy
    ? state.phase === "plan"
      ? "正在识别功能…"
      : state.phase === "generate"
        ? "正在创建或复用功能并生成PRD…"
        : "正在读取回执与工作空间…"
    : state.uncertain
      ? "状态待核实"
      : intent?.status === "saved"
        ? "PRD已保存（本次保存为待确认）"
        : intent?.status === "blocked"
          ? "该功能已有PRD，未新建"
          : intent?.status === "failed"
            ? "本次生成未完成"
            : intent?.status === "interrupted"
              ? "前次执行中断，需核实后继续"
              : creationInFlight(intent)
                ? "后端仍在处理，请稍后读取回执"
                : intent?.review
                  ? "请核对功能并选择"
                  : "";
}

export function PrdCreationInline({
  session,
  onExit,
  onStart,
}: {
  session: PrdCreationSession;
  onExit?: () => void;
  onStart?: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const name = state.candidateName;

  if (!state.input && !state.intent && !state.error && !state.notice) return null;

  const intent = state.intent;
  const review = intent?.review;
  const choosing = canChooseCreation(state);
  const status = statusText(state);

  return <section className="prd-creation-inline" aria-label="PRD生成任务" aria-busy={state.busy}>
    <header className="prd-creation-inline-header">
      <div>
        <strong>PRD生成任务</strong>
        <small>当前会话 · 功能创建与PRD生成</small>
      </div>
      {status && <span role="status" aria-live="polite">{status}</span>}
    </header>
    {state.input && <details className="prd-creation-request" open>
      <summary>本次需求</summary>
      <p>{state.input.message}</p>
    </details>}
    {state.error && <p className="manual-error" role="alert">{state.error}</p>}
    {state.notice && <p role="status">{state.notice}</p>}
    {intent?.error_code && <p className="manual-hint">错误标识：{intent.error_code}。{intent.function_id ? "已绑定功能保留，重试不再新建功能。" : "尚未创建功能。"}</p>}
    {review && intent?.status !== "saved" && intent?.status !== "blocked" && <div className="prd-creation-review">
      <h3>Agent识别的功能：{review.definition.name}</h3>
      <p className="prd-creation-text">{review.definition.description}</p>
      {Boolean(review.candidate_count) && <p>当前项目发现 {review.candidate_count} 个候选。不会自动合并或复用。{review.has_more && "仅展示前20条，请核对后选择。"}</p>}
      <ul className="prd-creation-candidates">{review.candidates.map(candidate => <li key={candidate.function_id}>
        <strong>{candidate.name}</strong><small>{{ exact_name: "名称相同", similar_name: "名称相似", similar_description: "描述相似" }[candidate.match]}</small>
        <p className="prd-creation-text">{candidate.description || "暂无描述"}</p>
        {candidate.prd_artifact_id
          ? <><p>已有PRD，不能重复创建。</p><button className="button-secondary" disabled={state.busy} onClick={() => void session.open(candidate.prd_artifact_id!)}>打开已有PRD：{candidate.name}</button></>
          : <button className="button-secondary" disabled={!choosing || !candidate.can_reuse_for_prd} onClick={() => void session.choose({ action: "reuse", function_id: candidate.function_id })}>{candidate.can_reuse_for_prd ? `复用并生成：${candidate.name}` : "无该功能的PRD创建权限"}</button>}
      </li>)}</ul>
      {choosing && <div>
        {review.exact_name_conflict && <p>存在同名功能，仍新建时必须修改名称；后端会再次查重。</p>}
        <label className="manual-field"><span>新功能名称</span><input maxLength={100} value={name ?? review.definition.name} disabled={!review.can_create_new_function} onChange={event => session.setCandidateName(event.target.value)} /></label>
        <button className="button-primary" disabled={!review.can_create_new_function || !(name ?? review.definition.name).trim()} onClick={() => void session.choose({ action: "create", name: (name ?? review.definition.name).trim() })}>仍新建并生成PRD</button>
        {!review.can_create_new_function && <p>当前权限不能新建功能，仍可选择有权限的候选复用。</p>}
      </div>}
    </div>}
    <div className="prd-creation-inline-actions">
      {state.busy && <button className="button-secondary" onClick={() => session.stop()}>停止等待</button>}
      {!state.busy && state.input && <button className="button-secondary" onClick={() => void session.refresh()}>读取回执</button>}
      {state.notFound && <button className="button-secondary" onClick={() => void session.resend()}>原请求重发</button>}
      {canRetryCreation(state) && <button className="button-primary" onClick={() => void session.retry()}>{intent?.function_id ? "继续原功能生成PRD" : "重试功能识别"}</button>}
      {intent?.artifact_id && <button className="button-primary" disabled={state.busy} onClick={() => void session.open()}>{intent.status === "saved" ? "打开已保存PRD" : "打开已有PRD"}</button>}
      {canResetCreation(state) && <button className="button-secondary" onClick={() => { session.reset(); onStart?.(); }}>开始另一项需求</button>}
      {onExit && !state.busy && <button className="button-secondary" onClick={onExit}>退出PRD生成</button>}
    </div>
    <p className="manual-hint">本任务通过当前会话发起；任务记录会进入本会话历史。不会自动确认PRD，生成结果保存为待确认版本。</p>
  </section>;
}