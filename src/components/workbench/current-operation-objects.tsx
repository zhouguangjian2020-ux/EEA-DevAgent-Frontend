"use client";

import { useId, useState } from "react";
import { useI18n } from "@/features/i18n/provider";
import { MAX_OPERATION_OBJECTS, operationObjectItems } from "@/features/conversation/operation-objects";
import type { ProjectWorks } from "@/features/workbench/model";
import "./current-operation-objects.css";

export function CurrentOperationObjects({ state, databaseMode = false, compact = false, disabled, suspended, onOpen, onRemove, onClear }: {
  state: ProjectWorks; databaseMode?: boolean; compact?: boolean; disabled?: boolean; suspended?: boolean;
  onOpen: (id: string) => void; onRemove: (id: string) => void; onClear: () => void;
}) {
  const { t: tr } = useI18n();
  const regionId = useId();
  // Keep the two layouts' disclosure choices independent; incoming turns never reset them.
  const [expandedByLayout, setExpandedByLayout] = useState<{ compact?: boolean; full?: boolean }>({});
  const layout = compact ? "compact" : "full";
  const expanded = expandedByLayout[layout] ?? !compact;
  const items = operationObjectItems(state, state.conversation.attachments, databaseMode);
  const unavailableCount = items.filter(item => item.unavailable).length;
  const draftCount = items.filter(item => !item.unavailable && item.hasDraft).length;
  const readOnlyCount = items.filter(item => !item.unavailable && item.readOnly).length;
  const summaries = [
    unavailableCount ? tr("{0} 个不可用对象，请展开处理", { "0": unavailableCount }) : "",
    draftCount ? tr("{0} 个对象有草稿；仅发送已保存版本", { "0": draftCount }) : "",
    readOnlyCount ? tr("{0} 个只读对象", { "0": readOnlyCount }) : "",
    suspended && items.length ? tr("快捷生成暂不使用这些对象") : "",
  ].filter(Boolean);
  const showSummary = !expanded && summaries.length > 0;

  return <section className="current-operation-objects" aria-label={tr("当前关联对象")} data-testid="current-operation-objects">
    <header>
      <button className="operation-objects-toggle" type="button" aria-expanded={expanded} aria-controls={regionId}
        aria-describedby={showSummary ? regionId + "-summary" : undefined}
        onClick={() => setExpandedByLayout(previous => ({ ...previous, [layout]: !expanded }))}>
        <svg className="operation-objects-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <strong>{tr("当前关联对象")}</strong>
        <span className="operation-object-count" data-association-target>{items.length}/{MAX_OPERATION_OBJECTS}</span>
        <span className="operation-objects-toggle-label">{tr(expanded ? "收起" : "展开")}</span>
      </button>
      {expanded && items.length > 0 && <button className="operation-objects-clear" type="button" disabled={disabled} onClick={onClear}>{tr("清空")}</button>}
    </header>
    {showSummary && <p id={regionId + "-summary"} className="operation-objects-summary" data-warning={unavailableCount > 0 || draftCount > 0 || undefined} role="status">{summaries.join(" · ")}</p>}
    <div id={regionId} className="operation-objects-body" hidden={!expanded}>
      {items.length ? <>
        <ul>{items.map(({ object, hasDraft, unavailable, readOnly }) => <li key={object.id} data-unavailable={unavailable || undefined}>
          <span className="operation-object-kind">{object.kind}</span>
          <button className="operation-object-open" type="button" disabled={unavailable} title={[object.functionName, object.name].filter(Boolean).join(" / ")} onClick={() => onOpen(object.id)}>
            <span>{unavailable ? tr("不可用对象") : object.name}</span><small>{object.functionName || object.id.slice(0, 8)}</small>
          </button>
          {unavailable ? <span className="operation-object-warning">{tr("需移除或刷新")}</span> : hasDraft ? <span className="operation-object-warning" title={tr("未保存草稿不会发送给Agent")}>{tr("有未保存草稿")}</span> : readOnly ? <span className="operation-object-state">{tr("只读")}</span> : null}
          <button className="operation-object-remove" type="button" disabled={disabled} aria-label={tr("移除当前关联对象 {0}", { "0": object.name })} onClick={() => onRemove(object.id)}>×</button>
        </li>)}</ul>
        <p>{suspended ? tr("快捷生成暂不使用这些对象；返回普通对话后继续保留。") : tr("持续用于本会话，每轮使用已保存版本；修改须预览并确认。")}</p>
      </> : null}
    </div>
  </section>;
}
