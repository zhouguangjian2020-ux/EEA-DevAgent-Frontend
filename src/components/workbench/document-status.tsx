type Props = { status?: "pending" | "accepted"; editing: boolean };

export function DocumentStatus({ status, editing }: Props) {
  const state = editing ? "editing" : status ?? "discarded";
  return <span className={"object-status document-toolbar-status " + state} role="status" aria-label="文档状态">{editing ? "编辑中" : status === "accepted" ? "已确认" : status === "pending" ? "待确认" : "已放弃"}</span>;
}
