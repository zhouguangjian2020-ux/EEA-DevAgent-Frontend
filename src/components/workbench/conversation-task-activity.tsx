"use client";
import type { ReactNode } from "react";
import { useI18n } from "@/features/i18n/provider";
import type { ConversationActivityRun } from "@/features/conversation/activity";
import { ConversationActivity } from "./conversation-activity";

export type TaskActivityOutcome = "completed" | "preview" | "empty" | "choice" | "uncertain" | "failed";
const outcomeLabels: Record<TaskActivityOutcome, string> = {
  completed: "已完成", preview: "预览已生成", empty: "没有可用结果",
  choice: "等待选择", uncertain: "执行状态待核实", failed: "未完成",
};

/** Task receipts expose the latest stage, not the Agent's streamed step history. */
export function ConversationTaskActivity({ message, running, outcome, children }: {
  message: string; running: boolean; outcome: TaskActivityOutcome; children?: ReactNode;
}) {
  const { t: tr } = useI18n();
  const run: ConversationActivityRun = {
    // Task creation time can predate retries. Never turn it into a live stopwatch.
    startedAt: 0, truncated: false, sequence: 1,
    items: [{ kind: "status", title: tr(message), sequence: 1 }],
  };
  return <ConversationActivity run={run} status={running ? "running" : outcome === "failed" ? "failed" : "completed"}
    hasAnswer={!running} summary={running ? undefined : tr(outcomeLabels[outcome])} showWaitingTime={false}>{children}</ConversationActivity>;
}
