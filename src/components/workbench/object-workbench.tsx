"use client";
import { PrdCreationSession, canNavigateCreationResult, type CreationAnchor } from "@/features/prd/creation";
import type { PrdCreationIntent } from "@/features/prd/creation-api";
import { WorkflowPanel } from './workflow-panel';
import { prdGenerationReason } from "@/features/prd/generation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../navigation/app-sidebar";
import { PrdWorkspace } from "../prd/prd-workspace";
import { UcWorkspace } from "../uc/uc-workspace";
import { FrOverviewWorkspace } from "../fr/fr-overview-workspace";
import { FrWorkspace } from "../fr/fr-workspace";
import { UcFrGeneration } from "../panorama/uc-fr-generation";
import { PanoramaWorkspace } from "../panorama/panorama-workspace";
import { ObjectTabs } from "./object-tabs";
import { WorkDialog } from "./work-dialog";
import { ProjectConversation } from "./project-conversation";
import { createNavigationState, transitionNavigation, type NavigationState, type NavigationAction } from "../../features/navigation/model";
import { collectObjects, filterWorkspaceTree, type WorkspaceObject, type WorkspaceFolder, type WorkspaceDeletion } from "../../features/workspace/tree";
import { canGenerateUcBatch, hasGeneratedUcBatch, EMPTY_PROJECT, featureUcs, featureFrs, workStage, workCategory, isPanorama, findObjectWork, isWorkRunning, isWorkDirty, workLabel, workObject, projectWorkspaceTree, type ObjectWork } from "../../features/workbench/model";
import { useWorkbenchStore } from "../../features/workbench/use-workbench-store";
import type { ConversationAction, GenerationMode } from "../../features/conversation/model";
import "./project-conversation.css";
import "./manual-work.css";
import { FeatureOverview } from "./feature-overview";
import { ManualCreateDialog, type CreateTarget } from "./manual-create-dialog";
import { acceptedPrd, acceptedUcs } from "@/features/workbench/manual-model";
import { projectFeatures } from "@/features/workbench/model";
import { panoramaId } from "../../features/panorama/model";
import { DeletionDialog, deletionTargetFromObject, type DeletionTarget } from "../workspace/deletion-dialog";

import { BulkDeletionDialog } from "../workspace/bulk-deletion-dialog";
import { collectDeletionTargets, deletionKey, MAX_DELETE_SELECTION, toggleDeletionSelection } from "@/features/workspace/deletion";

type BrowseState = { deletionMode?: boolean; deletionSelection?: WorkspaceDeletion[]; navigation: NavigationState; search: string; folders: Record<string, boolean>; checked: string[] };
const EMPTY_BROWSE: BrowseState = { navigation: createNavigationState(), search: "", folders: {}, checked: [] };
const NO_DELETED_PROJECTS: string[] = [];
type Props = { deletedProjectIds?: string[]; project: string; projectLabel?: string; databaseMode?: boolean; onContextChange: (value: string) => void; onLocalDataChange: (value: boolean) => void };
function locateWork(b: BrowseState, w: ObjectWork, locate: boolean): BrowseState {
  if (w.kind === "FEATURE_OVERVIEW") return { ...b, search: locate ? "" : b.search, navigation: { ...b.navigation, view: locate ? "workspace" : b.navigation.view } };
  const primary = w.kind === "PRD" ? "product" : "requirements";
  return {
    ...b, search: locate ? "" : b.search, checked: b.navigation.primary === primary ? b.checked : [],
    folders: { ...b.folders, [`${w.featureId}-${primary}`]: true, [`${w.featureId}-${workCategory(w)}-folder`]: true },
    navigation: { ...b.navigation, primary, secondary: workStage(w), view: locate ? "workspace" : b.navigation.view, expanded: { ...b.navigation.expanded, [primary]: true } },
  };
}
export function ObjectWorkbench({ project, projectLabel, deletedProjectIds = NO_DELETED_PROJECTS, databaseMode = false, onContextChange, onLocalDataChange }: Props) {
  const threads = useRef<Record<string, string>>({});
  function taskThread(key: string) {
    const id = threads.current[key];
    if (!id) throw new Error('正在准备会话，请稍候再生成；不会丢失任务记录。');
    return id;
  }
  const bench = useWorkbenchStore(deletedProjectIds, taskThread), p = bench.store[project] ?? EMPTY_PROJECT;
  const creationSessions = useRef(new Map<string, PrdCreationSession>());
  const [creationSessionMap, setCreationSessionMap] = useState<Record<string, PrdCreationSession | undefined>>({});
  const creationAnchors = useRef(new Map<string, CreationAnchor>());
  const contextEpoch = useRef(0);
  const currentProject = useRef(project);
  useLayoutEffect(() => {
    if (currentProject.current !== project) {
      currentProject.current = project;
      contextEpoch.current++;
    }
  }, [project]);
  const onCreationResult = useRef<(key: string, intent: PrdCreationIntent, automatic: boolean, signal: AbortSignal, sessionKey: string) => Promise<string>>(async () => '');
  useLayoutEffect(() => {
    onCreationResult.current = async (key, intent, automatic, signal, sessionKey) => {
      const workspace = await bench.seedDatabase(key, key, {});
      const feature = workspace.functions.find(f => f.prd?.id === intent.artifact_id);
      if (!feature) return intent.status === 'saved' ? 'PRD已保存，但当前工作空间找不到该结果，可能已删除或权限发生变化。' : '当前无法读取该PRD，可能已删除或权限发生变化。';
      const anchor = creationAnchors.current.get(sessionKey) ?? null;
      const canNavigate = threads.current[key] === anchor?.thread && canNavigateCreationResult(key, { project: currentProject.current, thread: threads.current[key] ?? '', epoch: contextEpoch.current }, key, anchor, automatic, signal.aborted);
      if (!canNavigate) return '结果已在原项目保存；未切换当前项目或会话。请主动打开结果。';
      bench.act(key, { type: 'open', id: 'db-prd-' + feature.id });
      bench.act(key, { type: "conversation", action: { type: "mode", mode: null } });
      setBrowsing(old => { const b = old[key] ?? EMPTY_BROWSE; return { ...old, [key]: { ...b, search: '', checked: [], folders: { ...b.folders, [feature.id + '-product']: true, [feature.id + '-PRD-folder']: true }, navigation: { ...b.navigation, primary: 'product', secondary: 'PRD生成', view: 'workspace', expanded: { ...b.navigation.expanded, product: true } } } }; });
      return intent.status === 'saved' ? 'PRD已保存并打开；确认状态以最新对象为准。' : '已打开现有PRD，未创建新对象。';
    };
  }, [bench]);
  function ensurePrdCreation(projectKey: string) {
    const thread = taskThread(projectKey);
    const sessionKey = projectKey + '/' + thread;
    let session = creationSessions.current.get(sessionKey);
    if (!session) {
      session = new PrdCreationSession(projectKey, (intent, automatic, signal) => onCreationResult.current(projectKey, intent, automatic, signal, sessionKey), undefined, () => thread);
      creationSessions.current.set(sessionKey, session);
    }
    creationAnchors.current.set(sessionKey, { project: projectKey, thread, epoch: contextEpoch.current });
    setCreationSessionMap(old => ({ ...old, [projectKey]: session }));
    return session;
  }
  function startPrdCreation(projectKey = project) {
    if (!projectKey || databaseLoading || databaseError) return;
    if (!threads.current[projectKey]) {
      bench.act(projectKey, { type: "conversation", action: { type: "notice", message: "正在准备会话，请稍候再选择PRD生成。" } });
      return;
    }
    ensurePrdCreation(projectKey);
    bench.act(projectKey, { type: "conversation", action: { type: "mode", mode: "PRD" } });
  }
  function submitPrdCreation(projectKey: string, prompt: string) {
    let session: PrdCreationSession;
    try {
      session = ensurePrdCreation(projectKey);
    } catch (error) {
      bench.act(projectKey, { type: "conversation", action: { type: "notice", message: error instanceof Error ? error.message : "正在准备会话，请稍候再试。" } });
      return;
    }
    if (session.snapshot().input || session.snapshot().busy) return;
    session.setPrompt(prompt);
    void session.submit();
    if (session.snapshot().input) bench.act(projectKey, { type: "conversation", action: { type: "prompt", value: "" } });
  }
  function exitPrdCreation(projectKey: string) {
    contextEpoch.current++;
    bench.act(projectKey, { type: "conversation", action: { type: "mode", mode: null } });
  }
  useEffect(() => { const sessions = creationSessions.current; return () => { sessions.forEach(session => session.stop()); }; }, []);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [bulkDeletion, setBulkDeletion] = useState<{ project: string; targets: WorkspaceDeletion[] } | null>(null);
  const [deletionTarget, setDeletionTarget] = useState<DeletionTarget | null>(null);
  const [browsing, setBrowsing] = useState<Record<string, BrowseState>>({});
  const browse = browsing[project] ?? EMPTY_BROWSE;
  const lastActive = useRef<Record<string, string | null>>({});
  const lastBatchReveal = useRef<Record<string, string>>({});
  const lastFrReveal = useRef<Record<string, string>>({});
  const loadedDatabaseProjects = useRef<Record<string, boolean>>({});
  const [databaseReads, setDatabaseReads] = useState<Record<string, { status: "ready" | "error"; message?: string }>>({});
  const [databaseRetry, setDatabaseRetry] = useState(0);
  const databaseLoading = databaseMode && Boolean(project) && !databaseReads[project];
  const databaseError = databaseReads[project]?.message ?? "";
  const active = p.activeId ? p.works[p.activeId] : undefined;
  const seedDatabaseRef = useRef(bench.seedDatabase);
  useLayoutEffect(() => { seedDatabaseRef.current = bench.seedDatabase; }, [bench.seedDatabase]);
  useEffect(() => {
    if (!databaseMode || !project || loadedDatabaseProjects.current[project]) return;
    let activeRequest = true;
    void seedDatabaseRef.current(project, project)
      .then(() => {
        if (!activeRequest) return;
        loadedDatabaseProjects.current[project] = true;
        setDatabaseReads(old => ({ ...old, [project]: { status: "ready" } }));
      })
      .catch(error => {
        if (!activeRequest) return;
        setDatabaseReads(old => ({ ...old, [project]: { status: "error", message: error instanceof Error ? error.message : "项目数据读取失败" } }));
      });
    return () => { activeRequest = false; };
  }, [databaseMode, project, databaseRetry]);

  const context = active?.kind === "FEATURE_OVERVIEW" ? `功能全景视图 / ${active.featureName}` : active ? `${active.kind === "PRD" ? "产品工程 / PRD生成" : `需求工程 / ${workStage(active)}`} / ${active.featureName}` : "工作台";
  useEffect(() => { onContextChange(context); }, [context, onContextChange]);
  const hasLocalData = Object.values(bench.store).some(value => Object.keys(value.works).length || value.conversation.prompt.trim() || value.conversation.messages.length || value.conversation.attachments.length || value.conversation.operation);
  useEffect(() => { onLocalDataChange(hasLocalData); }, [hasLocalData, onLocalDataChange]);
  function patchBrowse(patch: Partial<BrowseState>) { setBrowsing(old => ({ ...old, [project]: { ...(old[project] ?? EMPTY_BROWSE), ...patch } })); }
  function chat(action: ConversationAction, projectKey = project) { bench.act(projectKey, { type: "conversation", action }); }
  function sync(w: ObjectWork, locate = false) { setBrowsing(old => ({ ...old, [project]: locateWork(old[project] ?? EMPTY_BROWSE, w, locate) })); }
  function open(id: string, locate = true) {
    const w = p.works[id]; if (!w) return;
    bench.act(project, { type: "open", id }); sync(w, locate);
  }
  // Track each project separately: background results never switch the current project.
  // A generated object is located when its originating project is next displayed.
  const generatedId = p.conversation.messages.at(-1)?.result?.workId;
  useEffect(() => {
    const previous = lastActive.current[project]; lastActive.current[project] = p.activeId;
    const reveal = p.ucBatchReveal;
    const revealBatch = Boolean(reveal && (reveal.sidebarOnly || reveal.workId === p.activeId) && lastBatchReveal.current[project] !== reveal.requestId);
    if (revealBatch) lastBatchReveal.current[project] = reveal!.requestId;
    const frReveal = p.frBatchReveal;
    const revealFr = Boolean(frReveal && frReveal.workId === p.activeId && lastFrReveal.current[project] !== frReveal.requestId);
    if (revealFr) lastFrReveal.current[project] = frReveal!.requestId;
    // Database UC completion locates its folder without activating a central tab.
    // Other navigation events retain the existing active-work synchronization.
    const target = revealBatch && reveal?.sidebarOnly ? p.works[reveal.workId] : active;
    if (!target || previous === p.activeId && !revealBatch && !revealFr) return;
    setBrowsing(old => ({ ...old, [project]: locateWork(old[project] ?? EMPTY_BROWSE, target, revealBatch || revealFr || generatedId === target.id) }));
  }, [project, p.activeId, p.ucBatchReveal, p.frBatchReveal, p.works, active, generatedId]);

  const primary = browse.navigation.primary;
  const files = useMemo(() => primary !== "workbench" ? projectWorkspaceTree(p, primary) : [], [p, primary]);
  const objects = useMemo(() => collectObjects(files), [files]);
  const filtered = useMemo(() => filterWorkspaceTree(files, browse.search), [files, browse.search]);
  const objectId = active && active.kind !== "FR_OVERVIEW" ? workObject(active)?.id : undefined;
  const activeFolderId = active?.kind === "FEATURE_OVERVIEW" ? `${active.featureId}-${primary}` : active && (isPanorama(active) || active.kind === "FR_OVERVIEW") ? `${active.featureId}-${workCategory(active)}-folder` : undefined;
  useEffect(() => {
    if (browse.navigation.view !== "workspace") return;
    const row = objectId ? [...document.querySelectorAll<HTMLElement>(".app-sidebar [data-object-id]")].find(el => el.dataset.objectId === objectId) : [...document.querySelectorAll<HTMLElement>(".app-sidebar [data-folder-id]")].find(el => el.dataset.folderId === activeFolderId)?.querySelector<HTMLElement>(".folder-open");
    row?.scrollIntoView({ block: "nearest" });
  }, [project, objectId, activeFolderId, browse.navigation.view, browse.search, browse.folders]);

  function handleThreadChange(key: string, id: string) {
    const previous = threads.current[key];
    if (previous === id) return;
    threads.current[key] = id;
    setCreationSessionMap(old => ({ ...old, [key]: creationSessions.current.get(key + '/' + id) }));
    if (currentProject.current === key && previous) contextEpoch.current++;
  }
  async function openTaskResult(key: string, artifactId: string) {
    const originalThread = threads.current[key], originalEpoch = contextEpoch.current;
    const workspace = await bench.seedDatabase(key, key, {});
    if (currentProject.current !== key || threads.current[key] !== originalThread || contextEpoch.current !== originalEpoch) return;
    for (const feature of workspace.functions) {
      const kind = feature.prd?.id === artifactId ? 'PRD' : feature.use_cases.some(uc => uc.id === artifactId) ? 'UC' : feature.functional_requirements.some(fr => fr.id === artifactId) ? 'FR' : null;
      if (!kind) continue;
      const id = kind === 'PRD' ? 'db-prd-' + feature.id : 'db-' + kind.toLowerCase() + '-' + artifactId;
      bench.act(key, { type: 'open', id });
      return;
    }
    throw new Error('当前工作空间中无法读取任务结果，可能已删除或权限变化。');
  }
  function selectMode(mode: GenerationMode | null, featureId?: string, projectKey = project) {
    if (databaseMode && mode === "PRD") { startPrdCreation(projectKey); return; }
    if (databaseMode && mode === null) { exitPrdCreation(projectKey); return; }
    // Choosing a mode changes only the local draft, not database objects.
    const targetState = bench.store[projectKey] ?? EMPTY_PROJECT;
    if (targetState.conversation.operation) { chat({ type: "notice", message: "请等待当前请求完成，或先点击停止。" }, projectKey); return; }
    chat({ type: "mode", mode, featureId }, projectKey);
    if (mode && !databaseMode) { bench.act(projectKey, { type: "home" }); patchBrowse({ checked: [] }); }
  }
  function navigate(action: NavigationAction) {
    const navigation = transitionNavigation(browse.navigation, action);
    patchBrowse({ navigation, ...(navigation.primary !== primary ? { search: "", checked: [] } : {}) });
    if (action.type === "enter" && action.primary === "workbench") bench.act(project, { type: "home" });
    const secondary = action.type === "enter" || action.type === "select-secondary" ? action.secondary : null;
    if (!secondary) return;
    if (secondary === "PRD生成" || secondary === "用例生成") { selectMode(secondary === "PRD生成" ? "PRD" : "UC"); return; }
    if (secondary === "功能设计" || secondary === "功能分配") {
      const source = active ?? Object.values(p.works).find(w => w.kind === "PRD");
      if (!source) { bench.act(project, { type: "notice", message: "尚未创建业务功能，请先从工作台生成 PRD。" }); return; }
      if (secondary === "功能设计") bench.act(project, { type: "open-fr-overview", featureId: source.featureId });
      else bench.act(project, { type: "open-panorama", kind: "FR_ALLOCATION_OVERVIEW", featureId: source.featureId, featureName: source.featureName });
      return;
    }
    bench.act(project, { type: "notice", message: `${secondary}尚未接入；当前对象与项目对话保留。` });
  }
  function preview(object: WorkspaceObject) { openObject(object.id); }
  function selectedWithWarnings(target: WorkspaceDeletion): WorkspaceDeletion {
    const works = Object.values(p.works).filter(w => target.kind === "function" ? w.featureId === target.id : w.database?.artifactId === target.id);
    return { ...target, hasUnsavedChanges: works.some(isWorkDirty) };
  }
  function startBulkDeletion() {
    const current = collectDeletionTargets([...projectWorkspaceTree(p, "product"), ...projectWorkspaceTree(p, "requirements")]);
    const byKey = new Map(current.map(t => [deletionKey(t), t]));
    // Missing selections are not silently dropped: the server must reject stale objects.
    const targets = (browse.deletionSelection ?? []).map(t => selectedWithWarnings(byKey.get(deletionKey(t)) ?? t));
    if (targets.length) setBulkDeletion({ project, targets });
  }
  function deleted(results: { id: string; kind: string }[], projectKey = project) {
    const removed = new Set(results.map(item => item.id));
    const features = new Set(results.filter(item => item.kind === "function").map(item => item.id));
    const removedObjects = new Set(Object.values(bench.store[projectKey]?.works ?? {}).filter(w => features.has(w.featureId)).flatMap(w => w.database ? [w.database.artifactId] : []));
    setBrowsing(old => {
      const previous = old[projectKey] ?? EMPTY_BROWSE;
      return { ...old, [projectKey]: { ...previous, deletionMode: false, deletionSelection: [], checked: previous.checked.filter(id => !removed.has(id) && !removedObjects.has(id)) } };
    });
    void bench.refreshAfterDeletion(projectKey, results).then(() => {
      setDatabaseReads(old => ({ ...old, [projectKey]: { status: "ready" } }));
    }).catch(() => {
      setDatabaseReads(old => ({ ...old, [projectKey]: { status: "error", message: "删除已成功，但重新读取工作空间失败。点击重新加载重试。" } }));
    });
  }
  function openDeletion(object: WorkspaceObject) {
    const target = deletionTargetFromObject(object);
    if (!target || !databaseMode || !target.canDelete) return;
    const work = target.workId ? p.works[target.workId] : undefined;
    setDeletionTarget({ ...target, hasUnsavedChanges: Boolean(work && isWorkDirty(work)) });
  }
  function openFolderDeletion(folder: WorkspaceFolder) {
    if (!folder.deletion || !databaseMode || !folder.deletion.canDelete) return;
    setDeletionTarget({ ...folder.deletion, featureName: folder.name, hasUnsavedChanges: Object.values(p.works).some(w => w.featureId === folder.deletion?.id && isWorkDirty(w)) });
  }
  function openObject(id: string) {
    const w = findObjectWork(p, id);
    if (w) open(w.id); else chat({ type: "notice", message: "引用的对象已放弃或不在当前项目，历史对话仍保留。" });
  }
  function openFolder(folder: WorkspaceFolder) {
    const target = folder.panorama; if (!target) return;
    if (target.kind === "FEATURE_OVERVIEW") bench.act(project, { type: "open-feature", featureId: target.featureId });
    else if (target.kind === "FR_OVERVIEW") bench.act(project, { type: "open-fr-overview", featureId: target.featureId });
    else {
      bench.act(project, { type: "open-panorama", kind: target.kind, featureId: target.featureId, featureName: target.featureName });
      // Database UC folders are the explicit entry point for the Agent diagram request.
      // The model-side loading guard makes repeated folder clicks idempotent.
      if (databaseMode && target.kind === "UC_OVERVIEW") void bench.generateUcDiagram(project, panoramaId(target.featureId, "UC_OVERVIEW"));
    }
  }
  function startCreate(projectKey: string, kind: CreateTarget["kind"], featureId?: string) {
    if (!projectKey || projectKey !== project) return;
    const state = bench.store[projectKey] ?? EMPTY_PROJECT;
    setCreateTarget({ project: projectKey, projectLabel: projectLabel || projectKey, kind, feature: projectFeatures(state).find(f => f.id === featureId), prdRevision: featureId ? acceptedPrd(state, featureId) : undefined, candidates: featureId ? acceptedUcs(state, featureId) : [] });
  }
  function createButton(projectKey: string, featureId: string, kind: "UC" | "FR") {
    const state = bench.store[projectKey] ?? EMPTY_PROJECT;
    const allowed = !databaseMode || state.capabilities?.includes(kind + ".create");
    const source = kind === "FR" || acceptedPrd(state, featureId);
    return <button className="button-primary manual-toolbar-action" disabled={!allowed || !source} title={!allowed ? "当前账号无创建权限或业务写入未启用" : !source ? "请先创建并确认该功能的 PRD" : ""} onClick={() => startCreate(projectKey, kind, featureId)}>手动新建 {kind}</button>;
  }
  function persistence(projectKey: string, w: ObjectWork) {
    return w.database ? { ...w.database, saving: w.saving, onRefresh: () => { void bench.seedDatabase(projectKey, projectKey, {}).catch(error => bench.act(projectKey, { type: "notice", message: error instanceof Error ? error.message : "刷新失败" })); } } : undefined;
  }
  const close = p.closeRequest, closing = close ? p.works[close.id] : null;
  const projectStates = { ...bench.store, [project]: p };
  return <div className="app-body object-layout">
    <AppSidebar canDeleteObjects={databaseMode && Boolean(p.capabilities?.some(c => c.endsWith(".archive")))}
      deletionMode={browse.deletionMode} deletionCount={browse.deletionSelection?.length ?? 0} deletionSelectedIds={browse.deletionSelection?.map(deletionKey)}
      onDeletionMode={() => patchBrowse({ deletionMode: !browse.deletionMode, deletionSelection: [] })}
      onDeleteSelected={startBulkDeletion} onToggleDeletion={target => {
        if ((browse.deletionSelection?.length ?? 0) >= MAX_DELETE_SELECTION && !browse.deletionSelection?.some(t => deletionKey(t) === deletionKey(target))) bench.act(project, { type: "notice", message: "单批最多200项，请先处理当前选择。" });
        patchBrowse({ deletionSelection: toggleDeletionSelection(browse.deletionSelection ?? [], target) });
      }} navigation={browse.navigation} onNavigate={navigate} nodes={filtered} totalObjects={objects.length} search={browse.search} onSearch={search => patchBrowse({ search })} searching={Boolean(browse.search.trim())} openFolders={browse.folders}
      onToggleFolder={id => patchBrowse({ folders: { ...browse.folders, [id]: !(browse.folders[id] ?? files.some(f => f.id === id)) } })}
      selectedIds={browse.checked} onToggleObject={id => patchBrowse({ checked: browse.checked.includes(id) ? browse.checked.filter(x => x !== id) : [...browse.checked, id] })}
      previewId={objectId} activeFolderId={activeFolderId} onOpenFolder={openFolder} onFolderMenu={openFolderDeletion} onPreview={preview} onObjectMenu={openDeletion}
      attachmentTarget={`项目${project}对话`} attachmentBusy={Boolean(p.conversation.operation)}
      onNewPrd={() => selectMode("PRD")} readOnly={databaseMode}
      onAddObjects={() => { if (p.conversation.operation) return; chat({ type: "attach", objects: objects.filter(o => browse.checked.includes(o.id)) }); patchBrowse({ checked: [] }); }} />
    <div className="object-stage">
      <ObjectTabs project={project} state={p} onOpen={id => open(id)} onClose={id => {const w=p.works[id];if(w&&isPanorama(w)&&!window.dispatchEvent(new CustomEvent('workflow-before-close',{cancelable:true,detail:{project,featureId:w.featureId,mode:w.kind==='UC_OVERVIEW'?'fr':'allocation'}})))return;bench.act(project,{type:'close',id});}} onHome={() => bench.act(project, { type: "home" })} onNew={() => selectMode("PRD")} onReorder={(id, beforeId) => bench.act(project, { type: "reorder", id, beforeId })} />
      {databaseLoading && <div className="workbench-notice" role="status">正在读取项目数据库数据…</div>}{databaseError && <div className="workbench-notice" role="alert">项目数据库读取失败：{databaseError}<button className="button-secondary" onClick={() => { delete loadedDatabaseProjects.current[project]; setDatabaseReads(old => { const next = { ...old }; delete next[project]; return next; }); setDatabaseRetry(value => value + 1); }}>重新加载工作空间</button></div>}{databaseMode && databaseReads[project]?.status === "ready" && Object.keys(p.works).length === 0 && <div className="workbench-notice" role="status">当前项目暂无功能与需求数据；可在工作台点击“手动新建功能”。若按钮置灰，请先核对业务写入配置与项目角色。</div>}{p.notice && <div className="workbench-notice" role="status"><span>{p.notice}</span><button aria-label="关闭提示" onClick={() => bench.act(project, { type: "notice", message: "" })}>×</button></div>}
      {!active && <div className="manual-workbench-actions">{databaseMode && <button className="button-primary" disabled={!project || databaseLoading || Boolean(databaseError)} onClick={() => startPrdCreation(project)}>生成PRD</button>}<button className="button-primary" disabled={!project || databaseLoading || Boolean(databaseError) || databaseMode && !p.capabilities?.includes("function.create")} title={databaseMode && !p.capabilities?.includes("function.create") ? "当前账号无功能创建权限或业务写入未启用" : ""} onClick={() => startCreate(project, "function")}>手动新建功能</button></div>}
      <div className={`project-workspace-layout${active ? " has-object" : " is-home"}`}>
        <div className="project-document-deck" hidden={!active}>
          {Object.entries(bench.store).flatMap(([projectKey, ps]) => Object.values(ps.works).map(w => <section key={`${projectKey}/${w.id}`} id={`panel-${projectKey}-${w.id}`} aria-labelledby={`tab-${projectKey}-${w.id}`} role="tabpanel" tabIndex={0} hidden={projectKey !== project || p.activeId !== w.id} className="object-panel">
            {w.kind === "FEATURE_OVERVIEW" ? <FeatureOverview work={w} databaseMode={databaseMode} canEdit={!databaseMode || Boolean(ps.features[w.featureId]?.canUpdate)} onEdit={() => bench.act(projectKey, { type: "feature-edit", id: w.id })} onField={(field, value) => bench.act(projectKey, { type: "feature-field", id: w.id, field, value })} onCancel={() => bench.act(projectKey, { type: "feature-cancel", id: w.id })} onSave={() => void bench.saveFeature(projectKey, w.id)} onReload={() => void bench.reloadFeature(projectKey, w.id)} feature={projectFeatures(ps).find(f => f.id === w.featureId) ?? { id: w.featureId, name: w.featureName, description: "" }} hasPrd={Object.values(ps.works).some(v => v.featureId === w.featureId && v.kind === "PRD")} canCreate={!databaseMode || Boolean(ps.capabilities?.includes("PRD.create"))} onCreatePrd={() => startCreate(projectKey, "PRD", w.featureId)} />
            : w.kind === "PRD" ? <PrdWorkspace generation={databaseMode ? { state: w.prdGeneration, reason: prdGenerationReason(w, ps.features[w.featureId]?.description), onGenerate: () => void bench.generatePrd(projectKey, w.id), onStop: () => bench.cancel(projectKey, w.id) } : undefined} persistence={persistence(projectKey, w)} readOnly={Boolean(w.readOnly)} featureName={w.featureName} session={w.session} onAction={action => bench.objectAction(projectKey, w.id, action)} onGenerateUcs={() => bench.generateUcs(projectKey, w.id)} ucGenerating={Boolean(w.ucTask)} ucGenerated={hasGeneratedUcBatch(w)} canGenerateUcs={canGenerateUcBatch(w)} onStopUcs={() => bench.cancel(projectKey, w.id)} generatedUcs={w.database ? [] : featureUcs(ps, w.featureId).map(uc => ({ id: uc.id, label: workLabel(uc) }))} onOpenUc={id => open(id)} generatedCandidates={[]} />
            : w.kind === "UC" ? <UcWorkspace persistence={persistence(projectKey, w)} acceptedPrdRevisionId={acceptedPrd(ps, w.featureId)} readOnly={Boolean(w.readOnly)} referenceTargets={Object.fromEntries(featureUcs(ps, w.featureId).map(c => [c.number, c.id]))} onOpenReference={id => open(id)} featureName={w.featureName} number={w.number} sourceName={w.featureName} onSource={() => open(w.sourcePrdWorkId)} session={w.session} onAction={action => bench.objectAction(projectKey, w.id, action)} />
            : isPanorama(w) ? <PanoramaWorkspace workflowActions={databaseMode ? <WorkflowPanel getTaskThread={() => taskThread(projectKey)} blockedReason={(w.kind==='UC_OVERVIEW'?featureUcs(ps,w.featureId):featureFrs(ps,w.featureId)).some(source=>isWorkDirty(source)||isWorkRunning(source)||('editDraft' in source.session&&source.session.editDraft!==null))?'来源对象正在编辑或处理，请先保存、确认并结束操作。':undefined} key={projectKey + w.featureId + w.kind} project={projectKey} featureId={w.featureId} mode={w.kind === 'UC_OVERVIEW' ? 'fr' : 'allocation'} active={projectKey === project && p.activeId === w.id} onSaved={() => bench.seedDatabase(projectKey, projectKey, {})} /> : undefined} headerActions={w.kind === "UC_OVERVIEW" ? createButton(projectKey, w.featureId, "UC") : undefined} ucActions={w.kind === "UC_OVERVIEW" && !databaseMode && !w.readOnly ? <UcFrGeneration work={w} projectState={ps} onGenerate={() => bench.generateFrs(projectKey, w.id)} onStop={() => bench.cancel(projectKey, w.id)} onOpenUc={id => open(id)} onOpenFr={() => bench.act(projectKey, { type: "open-fr-overview", featureId: w.featureId })} /> : undefined} onRefreshDiagram={w.kind === "UC_OVERVIEW" && databaseMode ? (force = false) => void bench.generateUcDiagram(projectKey, w.id, force) : undefined} onStopDiagram={w.kind === "UC_OVERVIEW" && databaseMode ? () => bench.cancel(projectKey, w.id) : undefined} work={w} active={projectKey === project && p.activeId === w.id} ucs={featureUcs(ps, w.featureId).filter(uc => !databaseMode || uc.session.document?.status === "accepted").map(uc => ({ id: uc.id, content: uc.session.document!.content }))} frs={featureFrs(ps, w.featureId).map(fr => ({ workId: fr.id, content: fr.session.document!.content }))} onAssign={(frId, subsystemIds) => bench.act(projectKey, { type: "assign-fr", id: w.id, frId, subsystemIds })} />
            : w.kind === "FR_OVERVIEW" ? <FrOverviewWorkspace headerActions={createButton(projectKey, w.featureId, "FR")} readOnly={Boolean(w.readOnly)} featureName={w.featureName} rows={featureFrs(ps, w.featureId).map(fr => ({ ...fr.session.document!.content, sourceWorkId: fr.sourceUcWorkId }))} onOpenSource={id => open(id)} onOpenFr={id => { const target = Object.values(ps.works).find(item => item.kind === "FR" && item.featureId === w.featureId && (item.objectId === id || item.number === id)); if (target) open(target.id); }} />
            : <FrWorkspace persistence={persistence(projectKey, w)} candidates={acceptedUcs(ps, w.featureId)} readOnly={Boolean(w.readOnly)} featureName={w.featureName} number={w.number} session={w.session} onAction={action => bench.objectAction(projectKey, w.id, action)} onBack={() => open(w.sourceOverviewId)} />}
          </section>))}
        </div>
        <div className="project-conversation-host">{Object.entries(projectStates).map(([key, ps]) => <ProjectConversation onThreadChange={id => handleThreadChange(key, id)} onSaved={() => bench.seedDatabase(key, key, {})} key={key} project={key} state={ps} readOnly={databaseMode} visible={key === project} docked={Boolean(ps.activeId)} onAction={action => bench.act(key, { type: "conversation", action })} onMode={mode => selectMode(mode, undefined, key)} onPrdSubmit={prompt => submitPrdCreation(key, prompt)} onGenerateUcs={id => { void bench.generateUcs(key, id); bench.act(key, { type: "conversation", action: { type: "mode", mode: null } }); }} prdCreation={databaseMode ? creationSessionMap[key] : undefined} onPrdModeExit={() => exitPrdCreation(key)} onSend={(kind, retry, fail) => {
          const request = retry ? ps.conversation.error?.request : { kind, mode: ps.conversation.mode };
          // Retrying must be checked against the failed request, not a new mode.
          if (databaseMode && request?.kind !== "expand") {
            bench.act(key, { type: "conversation", action: { type: "notice", message: "请通过对话快捷入口或对应对象的生成按钮发起任务。" } });
            return;
          }
          void bench.runConversation(key, kind, retry, fail);
        }} onStop={() => bench.cancelConversation(key)} onOpenWork={id => open(id)} onOpenTaskResult={artifactId => openTaskResult(key, artifactId)} onOpenObject={openObject} />)}</div>
      </div>
    </div>
    {createTarget && <ManualCreateDialog key={createTarget.project + "/" + createTarget.kind + "/" + (createTarget.feature?.id ?? "")} target={createTarget} contextValid={createTarget.project === project} onClose={() => setCreateTarget(null)} onCreate={input => bench.createManual(createTarget.project, databaseMode, createTarget.feature?.id, input)} />}
    {bulkDeletion && <BulkDeletionDialog projectId={bulkDeletion.project} targets={bulkDeletion.targets} onClose={() => setBulkDeletion(null)} onDeleted={result => { setBulkDeletion(null); deleted(result.items, bulkDeletion.project); }} />}
    {deletionTarget && <DeletionDialog key={`${deletionTarget.kind}-${deletionTarget.id}`} projectId={project} target={deletionTarget} databaseMode={databaseMode} onClose={() => setDeletionTarget(null)} onDeleted={result => { setDeletionTarget(null); deleted([result]); }} />}
    {close && closing && <WorkDialog title={close.reason === "dirty" ? "关闭前保存修改？" : "当前对象仍有任务运行"} onClose={() => bench.resolveClose(project, close.id, "cancel")}><p><strong>{workLabel(closing)}</strong></p><p>{close.reason === "dirty" ? (closing.kind === "FEATURE_OVERVIEW" ? "功能资料只更新名称和描述，不修改PRD正文；项目对话与附件保留。" : "关闭只影响对象视图，项目对话与附件保留。保存草稿不会自动确认。") : "请停止对象任务再关闭；项目对话独立保留。"}</p>{closing.session.notice && <p role="status">{closing.session.notice}</p>}{p.notice.includes("校验") && <p role="alert">{p.notice}</p>}<div className="dialog-actions" aria-busy={closing.saving}><button className="button-secondary" disabled={closing.saving} onClick={() => bench.resolveClose(project, close.id, "cancel")}>取消</button>{close.reason === "dirty" ? <><button className="button-secondary" disabled={closing.saving || (closing.kind === "FEATURE_OVERVIEW" && Boolean(closing.metadataAttempt))} onClick={() => bench.resolveClose(project, close.id, "discard")}>不保存并关闭</button><button className="button-primary" disabled={closing.saving} onClick={() => bench.resolveClose(project, close.id, "save")}>保存并关闭</button></> : <button className="button-danger" onClick={() => bench.resolveClose(project, close.id, "stop")}>{isWorkRunning(closing) ? "停止并关闭" : "关闭标签"}</button>}</div></WorkDialog>}
  </div>;
}





