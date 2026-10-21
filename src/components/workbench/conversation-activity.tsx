"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { LoadingDots } from "@/components/feedback/loading";
import { useI18n } from "@/features/i18n/provider";
import type { ConversationActivityRun } from "@/features/conversation/activity";
import { ConversationDisclosureChevron } from "./conversation-disclosure";
import "./conversation-activity.css";

function WaitingTime({ startedAt }: { startedAt: number }) {
  const { t: tr } = useI18n();
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span className="conversation-activity-wait" title={tr("本次页面等待时间；完成用时以后端记录为准")}>
    {seconds < 60 ? tr("已等待{seconds}秒", { seconds }) : tr("已等待{minutes}分{seconds}秒", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })}
  </span>;
}

/** Execution milestones, not raw reasoning. Final measured duration lives outside this panel. */
export function ConversationActivity({ run, status, hasAnswer, summary, showWaitingTime = true, children }: {
  run: ConversationActivityRun; status: string; hasAnswer: boolean; summary?: string; showWaitingTime?: boolean; children?: ReactNode;
}) {
  const { t: tr } = useI18n();
  const contentId = useId();
  const running = status === "running";
  const phase = running ? (hasAnswer ? "answering" : "working") : "finished";
  const [choice, setChoice] = useState<{ phase: string; open: boolean } | null>(null);
  const open = choice?.phase === phase ? choice.open : phase === "working";
  const last = run.items.at(-1);
  const outcome = status === "completed" ? tr("已完成") : status === "interrupted" ? tr("已中断") : tr("未完成");
  return <section className="conversation-activity" data-testid="conversation-activity">
    <button className="conversation-activity-toggle" type="button" aria-expanded={open} aria-controls={contentId}
      onClick={() => setChoice({ phase, open: !open })}>
      <ConversationDisclosureChevron open={open} />
      <span className="conversation-activity-heading">{tr("执行过程")}</span>
      <span className="conversation-activity-current">{running && <LoadingDots />}<span className="conversation-activity-current-text" aria-live="polite">{summary ?? (running ? last?.title || tr("等待执行进度…") : outcome)}</span></span>
      {running && showWaitingTime && <WaitingTime key={run.startedAt} startedAt={run.startedAt} />}
    </button>
    <div id={contentId} hidden={!open} className="conversation-activity-content">
      <div className="conversation-activity-stages">
        {run.truncated && <p className="conversation-activity-note">{tr("较早的过程已折叠省略，仅保留最近的步骤。")}</p>}
        {run.items.length > 0 ? <ol className="conversation-activity-list">{run.items.map(item => <li key={item.sequence}>
          <span className="conversation-activity-marker" aria-hidden="true">{item.kind === "stage" ? "✓" : "·"}</span>
          <div><p className="conversation-activity-title">{item.title}</p>{item.body && <p className="conversation-activity-body">{item.body}</p>}</div>
        </li>)}</ol> : <p className="conversation-activity-note">{running ? tr("等待Agent返回执行步骤，未收到的过程不会推测补充。") : tr("本轮没有返回详细执行步骤。")}</p>}
      </div>
      {children}
    </div>
  </section>;
}
