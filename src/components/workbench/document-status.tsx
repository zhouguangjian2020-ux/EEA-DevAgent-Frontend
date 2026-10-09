"use client";
import { useI18n } from "@/features/i18n/provider";
type Props = { status?: "pending" | "accepted"; editing: boolean };

export function DocumentStatus({ status, editing }: Props) {
  const { t: tr } = useI18n();
  const state = editing ? "editing" : status ?? "discarded";
  return <span className={"object-status document-toolbar-status " + state} role="status" aria-label={tr("文档状态")}>{editing ? tr("编辑中") : status === "accepted" ? tr("已确认") : status === "pending" ? tr("待确认") : tr("已放弃")}</span>;
}
