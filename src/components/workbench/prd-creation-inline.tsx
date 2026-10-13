"use client";
import { TaskProgress } from "@/components/feedback/task-progress";
import { useI18n } from "@/features/i18n/provider";
import { useSyncExternalStore } from "react";
import { PrdCreationSession, creationInFlight } from "@/features/prd/creation";

export function creationStatus(state: ReturnType<PrdCreationSession["snapshot"]>) {
  const intent = state.intent;
  if (state.uncertain) return "执行状态待核实；停止等待不代表后台已取消，请先读取原任务状态。";
  if (state.busy) return state.phase === "read" ? "正在读取原任务状态…" : state.phase === "plan" ? "正在分析功能定义…" : "正在生成PRD…";
  if (intent?.status === "saved") return "PRD已保存为待确认版本，请在文档工作区审核。";
  if (intent?.status === "blocked") return intent.error_code === "function_name_conflict" ? "该功能已存在，本次生成已终止，未复用或改名。" : "该功能已有PRD，本次未生成或覆盖。";
  if (intent?.status === "failed" || intent?.status === "interrupted") return intent.function_id ? "目标功能已保留，PRD生成未完成；明确重试将继续原任务。" : "本次生成未完成，请核对原任务后明确重试。";
  if (creationInFlight(intent)) return "后台仍在处理，请读取原任务状态，不要重复生成。";
  if (intent?.status === "planned") return "功能计划已就绪，尚未生成PRD；可在顶部任务恢复中继续原任务。";
  return state.error || state.notice;
}
export function PrdCreationInline({ session }: { session: PrdCreationSession; onExit?: () => void; onStart?: () => void }) {
  const { t: tr } = useI18n();
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  if (!state.input && !state.error && !state.notice) return null;
  return <div className="live-chat-turn">
    {state.input && <article className="conversation-message user"><p>{state.input.message}</p></article>}
    <article className="conversation-message assistant"><p role="status"><TaskProgress text={creationStatus(state)} pending={state.busy && !state.uncertain && !state.error} /></p>
      {state.error && <p role="alert">{tr(state.error)}</p>}{state.notice && <p>{tr(state.notice)}</p>}
    </article>
  </div>;
}
