"use client";
import { useI18n } from "@/features/i18n/provider";
import { FolderChevron } from "@/components/icons/folder-chevron";
import type { CSSProperties } from "react";
import type { WorkspaceNode, WorkspaceObject, WorkspaceFolder, WorkspaceDeletion } from "@/features/workspace/tree";

export type WorkspaceTreeProps = {
  deletionMode?: boolean;
  deletionSelectedIds?: string[];
  onToggleDeletion?: (target: WorkspaceDeletion) => void;
  nodes: WorkspaceNode[];
  openFolders: Record<string, boolean>;
  searching: boolean;
  selectedIds: string[];
  previewId?: string;
  onToggleFolder: (id: string) => void;
  onOpenFolder?: (folder: WorkspaceFolder) => void;
  onFolderMenu?: (folder: WorkspaceFolder) => void;
  activeFolderId?: string;
  onToggleObject: (id: string) => void;
  onPreview: (object: WorkspaceObject) => void;
  onObjectMenu?: (object: WorkspaceObject) => void;
};

export function WorkspaceTree(props: WorkspaceTreeProps) {
  const { t: tr } = useI18n();
  function deleteCheck(node: WorkspaceNode) {
    const target = node.deletion;
    if (!props.deletionMode || !target) return null;
    const key = `${target.kind}:${target.id}`;
    return <input className="tree-delete-check" type="checkbox" checked={props.deletionSelectedIds?.includes(key) ?? false} disabled={!target.canDelete}
      aria-label={tr("删除选择 {0}", { "0": node.name })} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onChange={() => props.onToggleDeletion?.(target)} />;
  }
  function renderNodes(nodes: WorkspaceNode[], depth: number, path = "root") {
    return nodes.map((node) => {
      const occurrence = `${path}/${node.id}`;
      const style = { "--tree-depth": depth } as CSSProperties;
      if (node.type === "folder") {
        const open = props.searching || (props.openFolders[node.id] ?? node.level === "function");
        const childId = `children-${node.id}`;
        return (
          <li key={node.id} data-folder-level={node.level} data-folder-id={node.id}>
            {node.panorama ? <div className={`tree-folder tree-folder-split${props.activeFolderId === node.id ? " current-panorama" : ""}`} style={style}>
              {deleteCheck(node)}<button type="button" className="folder-open" aria-label={node.level === "function" ? tr("打开 {0} 功能全景视图", { "0": node.name }) : tr("打开 {0} {1}全景视图", { "0": node.panorama.featureName, "1": node.name })} aria-current={props.activeFolderId === node.id ? "page" : undefined} onClick={() => props.onOpenFolder?.(node)}><span className="tree-label">{node.level === "function" ? node.name : tr(node.name)}</span><span className="tree-count" aria-hidden="true">{node.children.length || ""}</span></button>
              <button type="button" className="folder-drop" aria-label={tr("{0} {1} {2} 文件夹", { "0": tr(open ? "收起" : "展开"), "1": node.panorama.featureName, "2": node.name })} aria-expanded={open} aria-controls={childId} disabled={props.searching} onClick={() => props.onToggleFolder(node.id)}><FolderChevron expanded={open} /></button>
            </div> : (<div className="tree-folder" style={style} role="button" tabIndex={0} aria-expanded={open} aria-controls={childId} onClick={() => { if (!props.searching) props.onToggleFolder(node.id); }} onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !props.searching) { event.preventDefault(); props.onToggleFolder(node.id); } }}>
              {deleteCheck(node)}<FolderChevron expanded={open} />
              <svg className="tree-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2.5 5.5h6l1.5 2h7.5v9h-15z" /><path d="M2.5 7.5h15" /></svg>
              <span className="tree-label" title={node.name}>{node.level === "function" ? node.name : tr(node.name)}</span>
              <span className="tree-count" aria-hidden="true">{node.children.length}</span>
            </div>)}
            <ul id={childId} className="tree-children" hidden={!open}>
              {open && renderNodes(node.children, depth + 1, occurrence)}
            </ul>
          </li>
        );
      }
      if (node.interactive === false) {
        return <li key={node.id} data-object-id={node.id} className="tree-object-row tree-object-readonly" style={style}>
          {deleteCheck(node)}
          <svg className="tree-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 2 6.5 3.75v7.5L10 17l-6.5-3.75v-7.5zM3.5 5.75 10 9.5l6.5-3.75M10 9.5V17" /></svg>
          <span className="tree-label" title={`${node.functionName} / ${node.name}`}>{node.name}</span>
          <small className="tree-subsystem-used">{node.summary}</small>
        </li>;
      }
      const selected = props.selectedIds.includes(node.id);
      return (
        <li key={node.id} data-object-id={node.id} className={`tree-object-row${selected ? " selected" : ""}${props.previewId === node.id ? " previewing" : ""}`} style={style}>
          {deleteCheck(node)}
          {!props.deletionMode && node.selectable !== false && <input type="checkbox" checked={selected} onChange={() => props.onToggleObject(node.id)} aria-label={tr("选择 {0} {1}", { "0": node.functionName, "1": node.name })} />}
          <button type="button" className="object-preview" onClick={() => props.onPreview(node)} aria-label={tr("打开 {0} {1}", { "0": node.functionName, "1": node.name })}>
            <svg className="tree-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 2 6.5 3.75v7.5L10 17l-6.5-3.75v-7.5zM3.5 5.75 10 9.5l6.5-3.75M10 9.5V17" /></svg>
            <span className="tree-label" title={`${node.functionName} / ${node.kind} / ${node.name}`}>{node.status && <span className={`tree-object-status ${node.status}`}>{node.status === "accepted" ? tr("已确认") : node.status === "unsaved" ? tr("未保存") : tr("待确认")}</span>}{node.kind === "UC" && node.name.includes(" · ") ? <><small className="tree-uc-number">{node.name.split(" · ")[0]}</small><span>{node.name.split(" · ").slice(1).join(" · ")}</span></> : node.name}</span>

          </button>
        </li>
      );
    });
  }

  return <ul className="workspace-tree" aria-label={tr("工作空间对象树")}>{renderNodes(props.nodes, 0)}</ul>;
}


