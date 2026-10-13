"use client";
import { BackIcon } from "@/components/icons/action-icons";
import { useI18n } from "@/features/i18n/provider";
import { ModuleIcon } from "@/components/icons/module-icon";
import { FolderChevron } from "@/components/icons/folder-chevron";
import { primaryItems, secondaryItems, type NavigationAction, type NavigationState } from "@/features/navigation/model";
import { WorkspaceTree, type WorkspaceTreeProps } from "@/components/workspace/workspace-tree";

type AppSidebarProps = WorkspaceTreeProps & {
  canDeleteObjects?: boolean; deletionCount?: number; onDeletionMode?: () => void; onDeleteSelected?: () => void;
  navigation: NavigationState;
  search: string;
  totalObjects: number;
  onNavigate: (action: NavigationAction) => void;
  onSearch: (query: string) => void;
  onAddObjects: () => void;
  attachmentTarget?: string; attachmentBusy?: boolean; onNewPrd?: () => void; readOnly?: boolean;
};

export function AppSidebar(props: AppSidebarProps) {
  const { t: tr } = useI18n();
  const { navigation, onNavigate } = props;
  const activeModule = primaryItems.find((item) => item.key === navigation.primary)!;

  return (
    <aside className="app-sidebar" aria-label={tr("侧边栏")} data-view={navigation.view}>
      <div key={navigation.view} className="sidebar-view">
      {navigation.view === "navigation" ? (
        <>
          <div className="nav-label">{tr("研发工作空间")}</div>
          <nav className="global-navigation" aria-label={tr("全部功能导航")}>
            {primaryItems.map((item) => {
              const expanded = item.key !== "workbench" && Boolean(navigation.expanded[item.key]);
              const active = navigation.primary === item.key;
              return (
                <div className="navigation-group" key={item.key}>
                  <div className={`navigation-row${active ? " active" : ""}`}>
                    <button type="button" className="primary-item" aria-current={active ? "page" : undefined} onClick={() => onNavigate({ type: "enter", primary: item.key })}>
                      <span className="nav-icon" aria-hidden="true"><ModuleIcon name={item.key} /></span><span>{tr(item.label)}</span>
                    </button>
                    {item.key !== "workbench" && (
                      <button type="button" className="nav-expand" aria-label={tr("{0}{1}", { "0": tr(expanded ? "收起" : "展开"), "1": tr(item.label) })} aria-expanded={expanded} aria-controls={`navigation-${item.key}`} onClick={() => { if (item.key !== "workbench") onNavigate({ type: "toggle-expanded", primary: item.key }); }}>
                        <FolderChevron expanded={expanded} />
                      </button>
                    )}
                  </div>
                  {item.key !== "workbench" && (
                    <div className="navigation-children" id={`navigation-${item.key}`} hidden={!expanded}>
                      {secondaryItems[item.key].map((label) => (
                        <button type="button" key={label} className={`global-secondary${active && navigation.secondary === label ? " selected" : ""}`} onClick={() => onNavigate({ type: "enter", primary: item.key, secondary: label })}>{tr(label)}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="nav-footer"><span className="status-dot" />{tr("演示环境")}</div>
        </>
      ) : (
        <>
          <div className="module-sidebar-header">
            <button type="button" className="back-to-navigation" onClick={() => onNavigate({ type: "back" })}><BackIcon /><span>{tr("返回全部功能")}</span></button>
            <h2><span className="nav-icon" aria-hidden="true"><ModuleIcon name={activeModule.key} /></span>{tr(activeModule.label)}</h2>
          </div>
          <div className="sidebar-tabs" data-active-tab={navigation.view} role="tablist" aria-label={tr("模块视图")} onKeyDown={(event) => {
            const tab = event.key === "ArrowLeft" || event.key === "Home" ? "functions" : event.key === "ArrowRight" || event.key === "End" ? "workspace" : null;
            if (tab) {
              event.preventDefault();
              onNavigate({ type: "set-tab", tab });
              document.getElementById(`sidebar-tab-${tab}`)?.focus();
            }
          }}>
            {(["functions", "workspace"] as const).map((tab) => (
              <button key={tab} id={`sidebar-tab-${tab}`} type="button" role="tab" aria-selected={navigation.view === tab} aria-controls="sidebar-panel" tabIndex={navigation.view === tab ? 0 : -1} className={navigation.view === tab ? "tab active" : "tab"} onClick={() => onNavigate({ type: "set-tab", tab })}>{tab === "functions" ? tr("功能") : tr("工作空间")}</button>
            ))}
          </div>
          <div id="sidebar-panel" className="sidebar-panel" role="tabpanel" aria-labelledby={`sidebar-tab-${navigation.view}`}>
            {navigation.view === "functions" ? (
              <div className="function-panel">
                <p className="sidebar-hint">{tr("选择功能，开始你的任务")}</p>
                {secondaryItems[navigation.primary].map((label) => (
                  <button type="button" key={label} className={navigation.secondary === label ? "secondary-item selected" : "secondary-item"} aria-pressed={navigation.secondary === label} onClick={() => onNavigate({ type: "select-secondary", secondary: label })}>{tr(label)}</button>
                ))}
              </div>
            ) : (
              <div className="workspace-panel">
                <div className="workspace-search-area">
                  <div className="workspace-title"><span>{tr("功能对象")}</span><span className="count">{props.totalObjects}</span></div>
                  <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label={tr("搜索对象")} value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder={tr("搜素对象文件···")} /></label>
                  {props.canDeleteObjects && <div className="tree-delete-toolbar">{props.deletionMode ? <><strong role="status">{tr("已选 ")}{props.deletionCount ?? 0}{tr(" 项")}</strong><button className="button-secondary" onClick={props.onDeletionMode}>{tr("取消")}</button><button className="button-danger" disabled={!props.deletionCount} onClick={props.onDeleteSelected}>{tr("删除所选")}</button></> : <button className="button-secondary" onClick={props.onDeletionMode}>{tr("多选删除")}</button>}</div>}{navigation.primary === "product" && props.onNewPrd && <button className="sidebar-new-prd" onClick={props.onNewPrd}>{tr("＋ PRD生成")}</button>}
                </div>
                <div className="workspace-tree-scroll">
                  {props.nodes.length ? <WorkspaceTree deletionMode={props.deletionMode} deletionSelectedIds={props.deletionSelectedIds} onToggleDeletion={props.onToggleDeletion} nodes={props.nodes} openFolders={props.openFolders} searching={props.searching} selectedIds={props.selectedIds} previewId={props.previewId} onToggleFolder={props.onToggleFolder} onToggleObject={props.onToggleObject} onPreview={props.onPreview} onOpenFolder={props.onOpenFolder} onFolderMenu={props.onFolderMenu} onObjectMenu={props.onObjectMenu} activeFolderId={props.activeFolderId} /> : <div className="empty-sidebar" role="status">{props.searching ? tr("没有找到匹配对象") : tr("还没有产物，先描述你想创建的功能。")}</div>}
                </div>
                <div className="workspace-actions" hidden={props.deletionMode}>
                  <button type="button" className="add-agent" disabled={!props.selectedIds.length || !props.attachmentTarget || props.attachmentBusy} onClick={props.onAddObjects}>{tr("＋ 添加到 AI 对话 ")}{props.selectedIds.length > 0 && <span>{props.selectedIds.length}</span>}</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      </div>
    </aside>
  );
}
