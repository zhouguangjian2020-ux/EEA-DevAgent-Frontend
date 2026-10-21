"use client";

import { useI18n } from "@/features/i18n/provider";
import { contextKiB, type ConversationContextUsage } from "@/features/conversation/context-usage";
import type { TaskRecord } from "@/features/workbench/task-records";
import { ConversationDisclosureChevron } from "./conversation-disclosure";
import "./conversation-context-usage.css";

/** A per-request receipt, not an estimate for a changed selection or restored history. */
export function ConversationContextUsageDetails({ usage }: { usage: ConversationContextUsage }) {
  const { t: tr } = useI18n();
  const rows = [
    [tr("当前对象（{0}）", { "0": usage.current_object_count }), usage.current_object_bytes],
    [tr("历史对象版本（{0}）", { "0": usage.historical_object_count }), usage.historical_object_bytes],
    [tr("对话文字及引用"), usage.dialogue_bytes],
    [tr("任务回执"), usage.task_receipt_bytes],
    [tr("结构与说明"), usage.framing_bytes],
  ] as const;
  return <details className="conversation-context-usage" data-near-limit={usage.near_limit || undefined}>
    <summary>
      <ConversationDisclosureChevron />
      <strong className="conversation-activity-heading">{tr("本轮上下文")}</strong>
      <span>{contextKiB(usage.reference_bytes)} / {contextKiB(usage.limit_bytes)} KiB</span>
      {usage.near_limit && <small>{tr("接近上限")}</small>}
    </summary>
    <div className="conversation-context-usage-body">
      <dl>{rows.map(([label, bytes]) => <div key={label}><dt>{label}</dt><dd>{contextKiB(bytes)} KiB</dd></div>)}</dl>
      <p>{tr("已去除 {0} 份重复对象正文，精简 {1} 条较早无效输出。", {
        "0": usage.deduplicated_snapshot_count, "1": usage.compacted_response_count,
      })}</p>
    </div>
  </details>;
}


const taskContextLabels: Record<TaskRecord["task_kind"], string> = {
  PRD: "PRD生成", UC: "UC生成", FR: "FR生成", FR_ALLOCATION: "FR分配", UC_DIAGRAM: "UC图生成",
};

/** Task receipts do not carry measured context usage or historical input snapshots. */
export function ConversationTaskContextDetails({ taskKind, functionName }: {
  taskKind: TaskRecord["task_kind"]; functionName?: string | null;
}) {
  const { t: tr } = useI18n();
  return <details className="conversation-context-usage" data-context-kind="task">
    <summary>
      <ConversationDisclosureChevron />
      <strong className="conversation-activity-heading">{tr("本轮上下文")}</strong>
      <span>{tr("用量未提供")}</span>
    </summary>
    <div className="conversation-context-usage-body">
      <dl>
        <div><dt>{tr("任务类型")}</dt><dd>{tr(taskContextLabels[taskKind])}</dd></div>
        {functionName && <div><dt>{tr("所属功能")}</dt><dd>{functionName}</dd></div>}
      </dl>
      <p>{tr("本任务未返回上下文用量，无法显示准确大小与明细。")}</p>
    </div>
  </details>;
}
