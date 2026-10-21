"use client";
import { useWorkflowLoading } from "@/components/feedback/use-workflow-loading";
import { useI18n } from "@/features/i18n/provider";
import { PrdCreationSession, canNavigateCreationResult, type CreationAnchor } from "@/features/prd/creation";
import type { PrdCreationIntent } from "@/features/prd/creation-api";
import { WorkflowPanel } from './workflow-panel';
import { AppendFrPanel } from './append-fr-panel';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppSidebar } from "../navigation/app-sidebar";
import { PrdWorkspace } from "../prd/prd-workspace";
import { UcWorkspace } from "../uc/uc-workspace";
import { FrOverviewWorkspace } from "../fr/fr-overview-workspace";
import { FrWorkspace } from "../fr/fr-workspace";
import { UcFrGeneration } from "../panorama/uc-fr-generation";
import type { RequirementDiagramCache } from "@/features/panorama/requirement-cache";
import { PanoramaWorkspace } from "../panorama/panorama-workspace";
import { FrReviewTable } from "../panorama/fr-review-table";
import { UcReviewTable } from "../panorama/uc-review-table";
import { confirmedUcSignature } from "@/features/workbench/uc-review";
import { generatedOverviewAction, revealWorkspaceStep, revealFolderId, type RevealKind, type RevealStep } from "@/features/workbench/workspace-reveal";
import { ObjectTabs } from "./object-tabs";
import { WorkDialog } from "./work-dialog";
import { ProjectConversation } from "./project-conversation";
import { ObjectProposalWorkspace } from "./object-ai-preview";
import { useObjectProposals } from "@/features/workbench/use-object-proposals";
import { hasObjectProposalWrite, proposalScope, type ObjectProposal } from "@/features/workbench/object-proposals";
import { createNavigationState, transitionNavigation, type NavigationState, type NavigationAction } from "../../features/navigation/model";
import { collectObjects, filterWorkspaceTree, type WorkspaceObject, type WorkspaceFolder, type WorkspaceDeletion } from "../../features/workspace/tree";
import { canGenerateUcBatch, hasGeneratedUcBatch, EMPTY_PROJECT, featureUcs, featureFrs, workStage, workCategory, isPanorama, findObjectWork, isWorkRunning, isWorkDirty, workLabel, workObject, projectWorkspaceTree, type ObjectWork, type PanoramaWork, type ProjectWorks } from "../../features/workbench/model";
import { useWorkbenchStore } from "../../features/workbench/use-workbench-store";
import type { ConversationAction, GenerationMode } from "../../features/conversation/model";
import "./project-conversation.css";
import { useObjectAssociationAnimation } from "./use-object-association-animation";
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
  const { t: tr } = useI18n();
  const threads = useRef<Record<string, string>>({});
  const [activeThreads, setActiveThreads] = useState<Record<string, string>>({});
  const [selectedProposals, setSelectedProposals] = useState<Record<string, string | undefined>>({});
  const requirementCache = useRef<RequirementDiagramCache>(new Map());
  function taskThread(key: string) {
    const id = threads.current[key];
    if (!id) throw new Error('正在准备会话，请稍候再生成；不会丢失任务记录。');
    return id;
  }
  const bench = useWorkbenchStore(deletedProjectIds, taskThread), p = bench.store[project] ?? EMPTY_PROJECT;
  const animateAssociation = useObjectAssociationAnimation(project + "/" + (activeThreads[project] ?? "") + "/" + Boolean(p.activeId));
  const review = useObjectProposals({
    getState: key => bench.store[key],
    // AI saves are external to manual drafts: preserve reducer guards even if a
    // draft appears while this read is in flight. Never use the manual savedId bypass.
    refresh: key => bench.seedDatabase(key, key, { initial: false }),
  });
  const reviewSelectionKey = (key: string, artifactId: string) => JSON.stringify([key, activeThreads[key] ?? "", artifactId]);
  function openProposal(key: string, proposal: ObjectProposal) {
    if (proposal.status === "discarded") return;
    const work = Object.values(bench.store[key]?.works ?? {}).find(item => item.database?.artifactId === proposal.artifact_id);
    if (!work) { bench.act(key, { type: "notice", message: "该对象已不可访问，预览保留；请刷新工作空间核对。" }); return; }
    setSelectedProposals(old => ({ ...old, [reviewSelectionKey(key, proposal.artifact_id)]: proposal.candidate_id }));
    if (key === project) { bench.act(key, { type: "open", id: work.id }); }
  }

  const workflowLoading = useWorkflowLoading();
  function visualGenerating(projectKey: string, featureId: string, kind: "UC" | "FR" | "FR_ALLOCATION") {
    return workflowLoading(projectKey, featureId, kind) || Object.values(bench.store[projectKey]?.works ?? {}).some(w =>
      w.featureId === featureId && (kind === "UC" && w.kind === "PRD" && Boolean(w.ucTask)
        || kind === "FR" && w.kind === "UC_OVERVIEW" && Boolean(w.frBatch)));
  }
  const creationSessions = useRef(new Map<string, PrdCreationSession>());
  const [creationSessionMap, setCreationSessionMap] = useState<Record<string, PrdCreationSession | undefined>>({});
  const creationAnchors = useRef(new Map<string, CreationAnchor>());
  const contextEpoch = useRef(0);
  const currentProject = useRef(project);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]), revealToken = useRef(0), revealInProgress = useRef(false);
  const revealRef = useRef<(projectKey: string, featureId: string, kind: RevealKind, message?: string) => void>(() => {});
  function cancelReveal() {
    revealToken.current++; revealInProgress.current = false;
    revealTimers.current.forEach(clearTimeout); revealTimers.current = [];
  }
  useEffect(() => () => { revealTimers.current.forEach(clearTimeout); }, []);
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
      revealRef.current(key, feature.id, "PRD", intent.status === "saved" ? "PRD生成成功" : "已打开现有PRD");
      return intent.status === 'saved' ? 'PRD已保存并打开；确认状态以最新对象为准。' : '已打开现有PRD，未创建新对象。';
    };
  }, [bench]);
  function ensurePrdCreation(projectKey: string) {
    const thread = taskThread(projectKey);
    const sessionKey = projectKey + '/' + thread;
    let session = creationSessions.current.get(sessionKey);
    if (!session) {
      session = new PrdCreationSession(projectKey, (intent, automatic, signal) => onCreationResult.current(projectKey, intent, automatic, signal, sessionKey), undefined, () => thread, () => bench.seedDatabase(projectKey, projectKey, {}));
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
    const session = ensurePrdCreation(projectKey);
    if (["saved", "blocked"].includes(session.snapshot().intent?.status ?? "")) session.reset();
    bench.act(projectKey, { type: "conversation", action: { type: "mode", mode: "PRD" } });
  }
  function submitPrdCreation(projectKey: string, prompt: string, targetFunctionId?: string, newFunctionName?: string) {
    let session: PrdCreationSession;
    try {
      session = ensurePrdCreation(projectKey);
    } catch (error) {
      bench.act(projectKey, { type: "conversation", action: { type: "notice", message: error instanceof Error ? error.message : "正在准备会话，请稍候再试。" } });
      return;
    }
    if (session.snapshot().input || session.snapshot().busy) return;
    session.setTarget(targetFunctionId, newFunctionName);
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
  useLayoutEffect(() => {
    revealRef.current = (projectKey, featureId, kind, message) => {
      if (currentProject.current !== projectKey) return;
      cancelReveal(); revealInProgress.current = true;
      const token = revealToken.current, epoch = contextEpoch.current, thread = threads.current[projectKey];
      const valid = () => token === revealToken.current && currentProject.current === projectKey && contextEpoch.current === epoch && threads.current[projectKey] === thread;
      bench.act(projectKey, { type: "notice", message: message ?? kind + "生成成功" });
      const stages: RevealStep[] = ["module", "workspace", "feature", "category"];
      stages.forEach((step, index) => {
        revealTimers.current.push(setTimeout(() => {
          if (!valid()) return;
          setBrowsing(old => ({ ...old, [projectKey]: revealWorkspaceStep(old[projectKey] ?? EMPTY_BROWSE, featureId, kind, step, Object.keys(bench.store[projectKey]?.features ?? {})) }));
          const moduleName = kind === "PRD" ? "产品工程" : "需求工程";
          const progress = step === "module" ? "打开" + moduleName : step === "workspace" ? "打开工作空间" : step === "feature" ? "展开对应功能" : "已展开 " + kind + " 目录";
          bench.act(projectKey, { type: "notice", message: (message ?? kind + "生成成功") + " → " + progress });
          if (step === "category") {
            const state = bench.store[projectKey];
            const featureName = state?.features[featureId]?.name ?? Object.values(state?.works ?? {}).find(w => w.featureId === featureId)?.featureName ?? "";
            const action = generatedOverviewAction(kind, featureId, featureName);
            if (action) bench.act(projectKey, action);
            revealInProgress.current = false;
            revealTimers.current.push(setTimeout(() => {
              if (!valid()) return;
              const row = document.querySelector('[data-folder-id="' + CSS.escape(revealFolderId(featureId, kind)) + '"]');
              row?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            }, 50));
          }
        }, 220 * (index + 1)));
      });
    };
  }, [bench]);
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

  const context = active?.kind === "FEATURE_OVERVIEW" ? `${tr("功能全景视图")} / ${active.featureName}` : active ? `${active.kind === "PRD" ? `${tr("产品工程")} / ${tr("PRD生成")}` : `${tr("需求工程")} / ${tr(workStage(active))}`} / ${active.featureName}` : tr("工作台");
  useEffect(() => { onContextChange(context); }, [context, onContextChange]);
  const hasLocalData = Object.values(bench.store).some(value => Object.keys(value.works).length || value.conversation.prompt.trim() || value.conversation.messages.length || value.conversation.attachments.length || value.conversation.operation);
  useEffect(() => { onLocalDataChange(hasLocalData); }, [hasLocalData, onLocalDataChange]);
  function patchBrowse(patch: Partial<BrowseState>) { cancelReveal(); setBrowsing(old => ({ ...old, [project]: { ...(old[project] ?? EMPTY_BROWSE), ...patch } })); }
  function chat(action: ConversationAction, projectKey = project) { bench.act(projectKey, { type: "conversation", action }); }
  function sync(w: ObjectWork, locate = false) { setBrowsing(old => ({ ...old, [project]: locateWork(old[project] ?? EMPTY_BROWSE, w, locate) })); }
  function open(id: string, locate = true) {
    cancelReveal();
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
    // Database UC completion defers tab activation until the stepped folder reveal finishes.
    // Other navigation events retain the existing active-work synchronization.
    const target = revealBatch && reveal?.sidebarOnly ? p.works[reveal.workId] : active;
    if (!target || previous === p.activeId && !revealBatch && !revealFr) return;
    if (revealBatch || revealFr || generatedId === target.id) {
      revealRef.current(project, target.featureId, revealBatch ? "UC" : revealFr ? "FR" : workCategory(target));
    } else if (!revealInProgress.current) {
      setBrowsing(old => ({ ...old, [project]: locateWork(old[project] ?? EMPTY_BROWSE, target, false) }));
    }
  }, [project, p.activeId, p.ucBatchReveal, p.frBatchReveal, p.works, active, generatedId]);

  const primary = browse.navigation.primary;
  const files = useMemo(() => primary !== "workbench" ? projectWorkspaceTree(p, primary) : [], [p, primary]);
  const objects = useMemo(() => collectObjects(files), [files]);
  const filtered = useMemo(() => filterWorkspaceTree(files, browse.search), [files, browse.search]);
  const objectId = active && active.kind !== "FR_OVERVIEW" ? workObject(active)?.id : undefined;
  const activeFolderId = active?.kind === "FR_ALLOCATION_OVERVIEW" && active.selectedSubsystemId ? `${active.featureId}-allocation-${active.selectedSubsystemId}` : active?.kind === "FEATURE_OVERVIEW" ? `${active.featureId}-${primary}` : active && (isPanorama(active) || active.kind === "FR_OVERVIEW") ? `${active.featureId}-${workCategory(active)}-folder` : undefined;
  useEffect(() => {
    if (browse.navigation.view !== "workspace") return;
    const row = objectId ? [...document.querySelectorAll<HTMLElement>(".app-sidebar [data-object-id]")].find(el => el.dataset.objectId === objectId) : [...document.querySelectorAll<HTMLElement>(".app-sidebar [data-folder-id]")].find(el => el.dataset.folderId === activeFolderId)?.querySelector<HTMLElement>(".folder-open");
    row?.scrollIntoView({ block: "nearest" });
  }, [project, objectId, activeFolderId, browse.navigation.view, browse.search, browse.folders]);

  function handleThreadChange(key: string, id: string) {
    const previous = threads.current[key];
    if (previous === id) return;
    threads.current[key] = id;
    setActiveThreads(old => ({ ...old, [key]: id }));
    if (id) ensurePrdCreation(key);
    else setCreationSessionMap(old => ({ ...old, [key]: undefined }));
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
    cancelReveal();
    const navigation = transitionNavigation(browse.navigation, action);
    patchBrowse({ navigation, ...(navigation.primary !== primary ? { search: "", checked: [] } : {}) });
    if (action.type === "enter" && action.primary === "workbench") bench.act(project, { type: "home" });
    const secondary = action.type === "enter" || action.type === "select-secondary" ? action.secondary : null;
    if (!secondary) return;
    if (secondary === "PRD生成") { selectMode("PRD"); return; }
    if (secondary === "用例生成") {
      const features = projectFeatures(p);
      const feature = features.find(item => item.id === active?.featureId)
        ?? features.find(item => item.id === p.conversation.featureId) ?? features[0];
      selectMode("UC", feature?.id);
      if (!feature) {
        chat({ type: "notice", message: "尚未创建业务功能，请先从工作台生成 PRD。" });
        return;
      }
      bench.act(project, { type: "open-panorama", kind: "UC_OVERVIEW", featureId: feature.id, featureName: feature.name });
      if (databaseMode) void bench.generateUcDiagram(project, panoramaId(feature.id, "UC_OVERVIEW"));
      return;
    }
    if (secondary === "功能设计" || secondary === "功能分配") {
      const source = active ?? Object.values(p.works).find(w => w.kind === "PRD");
      if (!source) { bench.act(project, { type: "notice", message: "尚未创建业务功能，请先从工作台生成 PRD。" }); return; }
      if (secondary === "功能设计") bench.act(project, { type: "open-fr-overview", featureId: source.featureId });
      else bench.act(project, { type: "open-panorama", kind: "FR_ALLOCATION_OVERVIEW", featureId: source.featureId, featureName: source.featureName });
      return;
    }
    bench.act(project, { type: "notice", message: `${secondary}尚未接入；当前对象与项目对话保留。` });
  }
  function preview(object: WorkspaceObject) {
    if (object.allocation?.frId) {
      openObject(object.allocation.frId);
    } else if (object.allocation && object.featureId) {
      cancelReveal();
      bench.act(project, { type: "open-panorama", kind: "FR_ALLOCATION_OVERVIEW", featureId: object.featureId,
        featureName: object.functionName, subsystemId: object.allocation.subsystemId, allocationId: object.allocation.allocationId });
    } else openObject(object.id);
  }
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
    cancelReveal();
    const target = folder.panorama; if (!target) return;
    if (target.kind === "FEATURE_OVERVIEW") bench.act(project, { type: "open-feature", featureId: target.featureId });
    else if (target.kind === "FR_OVERVIEW") bench.act(project, { type: "open-fr-overview", featureId: target.featureId });
    else {
      bench.act(project, { type: "open-panorama", kind: target.kind, featureId: target.featureId, featureName: target.featureName, subsystemId: target.subsystemId });
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
    return <button className="button-primary manual-toolbar-action" disabled={!allowed || !source} title={!allowed ? tr("当前账号无创建权限或业务写入未启用") : !source ? tr("请先创建并确认该功能的 PRD") : ""} onClick={() => startCreate(projectKey, kind, featureId)}>{tr("手动新建 ")}{kind}</button>;
  }
  function persistence(projectKey: string, w: ObjectWork) {
    return w.database ? { ...w.database, saving: w.saving, onRefresh: () => { void bench.seedDatabase(projectKey, projectKey, {}).catch(error => bench.act(projectKey, { type: "notice", message: error instanceof Error ? error.message : "刷新失败" })); } } : undefined;
  }
  function renderPanorama(projectKey: string, state: ProjectWorks, work: PanoramaWork, allocationContent?: ReactNode) {
    const isUc = work.kind === "UC_OVERVIEW";
    const isActive = projectKey === project && p.activeId === work.id;
    const sources = isUc ? featureUcs(state, work.featureId) : featureFrs(state, work.featureId);
    const blockedReason = sources.some(source => isWorkDirty(source) || isWorkRunning(source) || ("editDraft" in source.session && source.session.editDraft !== null))
      ? tr("来源对象正在编辑或处理，请先保存、确认并结束操作。") : undefined;
    const workflowProps = {
      project: projectKey, featureId: work.featureId, featureName: work.featureName, active: isActive, blockedReason,
      getTaskThread: () => taskThread(projectKey),
      onSaved: () => bench.seedDatabase(projectKey, projectKey, {}),
      onGenerated: (originThread?: string) => {
        if (originThread && threads.current[projectKey] !== originThread) return;
        revealRef.current(projectKey, work.featureId, isUc ? "FR" : "FR分配", isUc ? "FR生成成功" : "FR分配建议已生成，尚未保存");
      },
    };
    // One generation component owns the request; only its controls move into the header.
    const render = (actions?: ReactNode, feedback?: ReactNode) => <PanoramaWorkspace
      projectId={databaseMode ? projectKey : undefined}
      requirementCache={requirementCache.current}
      headerActions={isUc ? <>{createButton(projectKey, work.featureId, "UC")}{actions}</> : undefined}
      workflowActions={isUc ? feedback : undefined}
      allocationReview={!isUc ? allocationContent : undefined}
      onRefreshDiagram={isUc && databaseMode ? (force = false) => void bench.generateUcDiagram(projectKey, work.id, force) : undefined}
      onStopDiagram={isUc && databaseMode ? () => bench.cancel(projectKey, work.id) : undefined}
      work={work} active={isActive}
      diagramSourceKey={isUc ? confirmedUcSignature(featureUcs(state, work.featureId)) : undefined}
      diagramBusy={Boolean(work.saving)}
      generating={isUc && visualGenerating(projectKey, work.featureId, "UC")}
      ucTotalCount={isUc ? featureUcs(state, work.featureId).length : undefined}
      reviewContent={isUc ? <UcReviewTable works={featureUcs(state, work.featureId)} busy={Boolean(work.saving) || work.ucDiagram.status === "loading"}
        onOpen={id => open(id)} onConfirm={items => bench.confirmUcs(projectKey, work.id, items)} /> : undefined}
      ucs={featureUcs(state, work.featureId).filter(uc => uc.session.document?.status === "accepted").map(uc => ({ id: uc.id, content: uc.session.document!.content }))}
      frs={featureFrs(state, work.featureId).map(fr => ({ workId: fr.id, content: fr.session.document!.content }))}
      onAssign={(frId, subsystemIds) => bench.act(projectKey, { type: "assign-fr", id: work.id, frId, subsystemIds })}
    />;
    if (!isUc && databaseMode) return render();
    if (isUc && databaseMode) return <AppendFrPanel key={projectKey + work.featureId + work.kind} {...workflowProps} render={render} />;
    if (isUc && !work.readOnly) return <UcFrGeneration work={work} projectState={state}
      onGenerate={() => bench.generateFrs(projectKey, work.id)} onStop={() => bench.cancel(projectKey, work.id)}
      onOpenUc={id => open(id)} onOpenFr={() => bench.act(projectKey, { type: "open-fr-overview", featureId: work.featureId })}
      render={render} />;
    return render();
  }
  function closeWork(id: string) {
    const work = p.works[id];
    if (!work) return;
    const isAllocationView = work.kind === "FR_OVERVIEW" || work.kind === "FR_ALLOCATION_OVERVIEW";
    const keepsAllocationOwner = isAllocationView && Object.values(p.works).some(other => other.id !== id && other.featureId === work.featureId
      && (other.kind === "FR_OVERVIEW" || other.kind === "FR_ALLOCATION_OVERVIEW"));
    if ((work.kind === "UC_OVERVIEW" || (isAllocationView && !keepsAllocationOwner)) && !window.dispatchEvent(new CustomEvent("workflow-before-close", {
      cancelable: true, detail: { project, featureId: work.featureId, mode: work.kind === "UC_OVERVIEW" ? "fr" : "allocation" },
    }))) return;
    bench.act(project, { type: "close", id });
  }
  function renderFrOverview(projectKey: string, ps: ProjectWorks, w: Extract<ObjectWork, { kind: "FR_OVERVIEW" }>, actions?: ReactNode, feedback?: ReactNode) {
    return <FrOverviewWorkspace generating={visualGenerating(projectKey, w.featureId, "FR")} reviewContent={<FrReviewTable works={featureFrs(ps, w.featureId)} sourceLabels={Object.fromEntries(Object.values(ps.works).filter(item => item.kind === "UC").map(item => [item.database?.artifactId ?? item.objectId, `${item.number} · ${item.session.document?.content.name ?? ""}`]))} busy={Boolean(w.saving)} onOpen={id => open(id)} onOpenSource={openObject} onConfirm={items => bench.confirmFrs(projectKey, w.id, items)} />} headerActions={<>{createButton(projectKey, w.featureId, "FR")}{actions}</>} workflowFeedback={feedback} readOnly={Boolean(w.readOnly)} featureName={w.featureName} rows={featureFrs(ps, w.featureId).map(fr => ({ ...fr.session.document!.content, sourceWorkId: fr.sourceUcWorkId }))} onOpenSource={id => open(id)} onOpenFr={id => { const target = Object.values(ps.works).find(item => item.kind === "FR" && item.featureId === w.featureId && (item.objectId === id || item.number === id)); if (target) open(target.id); }} />;
  }
  function renderAllocationWorkspaces(projectKey: string, ps: ProjectWorks, featureId: string) {
    const works = Object.values(ps.works).filter(w => w.featureId === featureId && (w.kind === "FR_OVERVIEW" || w.kind === "FR_ALLOCATION_OVERVIEW"));
    const sources = featureFrs(ps, featureId);
    const blockedReason = sources.some(source => isWorkDirty(source) || isWorkRunning(source) || ("editDraft" in source.session && source.session.editDraft !== null))
      ? tr("来源对象正在编辑或处理，请先保存、确认并结束操作。") : undefined;
    // One owner per project/function keeps candidates alive across FR and allocation tabs.
    return <WorkflowPanel key={`${projectKey}/${featureId}/allocation`} project={projectKey} featureId={featureId} mode="allocation"
      active={projectKey === project && works.some(w => w.id === p.activeId)} blockedReason={blockedReason} onOpenObject={openObject}
      onPreviewsChange={(previews, subsystems) => bench.act(projectKey, { type: "allocation-previews", featureId, previews, subsystems })}
      getTaskThread={() => taskThread(projectKey)} onSaved={() => bench.seedDatabase(projectKey, projectKey, {})}
      onGenerated={originThread => {
        if (originThread && threads.current[projectKey] !== originThread) return;
        revealRef.current(projectKey, featureId, "FR分配", "FR分配建议已生成，尚未保存");
      }} render={(actions, content, feedback) => <>{works.map(w => <section key={`${projectKey}/${w.id}`}
        id={`panel-${projectKey}-${w.id}`} aria-labelledby={`tab-${projectKey}-${w.id}`} role="tabpanel" tabIndex={0}
        hidden={projectKey !== project || p.activeId !== w.id} className="object-panel">
        {w.kind === "FR_OVERVIEW" ? renderFrOverview(projectKey, ps, w, actions, feedback)
          : w.kind === "FR_ALLOCATION_OVERVIEW" ? renderPanorama(projectKey, ps, w, content(projectKey === project && p.activeId === w.id, w.selectedSubsystemId && w.selectedSubsystemId !== "__empty__" ? w.selectedSubsystemId : undefined)) : null}
      </section>)}</>} />;
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
      attachmentTarget={tr("项目{0}对话", { "0": project })} attachmentBusy={Boolean(p.conversation.operation || p.conversation.contextLocked)}
      onNewPrd={() => selectMode("PRD")} readOnly={databaseMode}
      onAddObjects={source => {
        if (p.conversation.operation || p.conversation.contextLocked) return;
        const selected = objects.filter(o => browse.checked.includes(o.id));
        if (new Set([...p.conversation.attachments, ...selected].map(o => o.id)).size > 20) {
          chat({ type: "notice", message: "当前关联对象最多支持20个，请先移除部分对象。" }); return;
        }
        const addedCount = selected.filter(object => !p.conversation.attachments.some(existing => existing.id === object.id)).length;
        chat({ type: "attach", objects: selected }); patchBrowse({ checked: [] });
        animateAssociation(source, addedCount);
      }} />
    <div className="object-stage">
      <ObjectTabs loadingIds={p.tabs.filter(id => {
          const w = p.works[id];
          return (w.kind === "UC_OVERVIEW" && (visualGenerating(project, w.featureId, "UC") || visualGenerating(project, w.featureId, "FR")))
            || (w.kind === "FR_OVERVIEW" && (visualGenerating(project, w.featureId, "FR") || visualGenerating(project, w.featureId, "FR_ALLOCATION")))
            || (w.kind === "FR_ALLOCATION_OVERVIEW" && visualGenerating(project, w.featureId, "FR_ALLOCATION"));
        })} project={project} state={p} onOpen={id => open(id)} onClose={closeWork} onHome={() => bench.act(project, { type: "home" })} onNew={() => selectMode("PRD")} onReorder={(id, beforeId) => bench.act(project, { type: "reorder", id, beforeId })} />
      {databaseLoading && <div className="workbench-notice" role="status">{tr("正在读取项目数据库数据…")}</div>}{databaseError && <div className="workbench-notice" role="alert">{tr("项目数据库读取失败：")}{tr(databaseError)}<button className="button-secondary" onClick={() => { delete loadedDatabaseProjects.current[project]; setDatabaseReads(old => { const next = { ...old }; delete next[project]; return next; }); setDatabaseRetry(value => value + 1); }}>{tr("重新加载工作空间")}</button></div>}{p.notice && <div className="workbench-notice" role="status"><span>{tr(p.notice)}</span><button aria-label={tr("关闭提示")} onClick={() => bench.act(project, { type: "notice", message: "" })}>×</button></div>}
      <div className={`project-workspace-layout${active ? " has-object" : " is-home"}`}>
        <div className="project-document-deck" hidden={!active}>
          {Object.entries(bench.store).flatMap(([projectKey, ps]) => Object.values(ps.works).filter(w => !databaseMode || (w.kind !== "FR_OVERVIEW" && w.kind !== "FR_ALLOCATION_OVERVIEW")).map(w => <section key={`${projectKey}/${w.id}`} id={`panel-${projectKey}-${w.id}`} aria-labelledby={`tab-${projectKey}-${w.id}`} role="tabpanel" tabIndex={0} hidden={projectKey !== project || p.activeId !== w.id} className="object-panel">
            <ObjectProposalWorkspace work={w} state={ps} proposals={(review.collection[proposalScope(projectKey, activeThreads[projectKey] ?? "")] ?? []).filter(item => item.artifact_id === w.database?.artifactId)} selectedId={selectedProposals[JSON.stringify([projectKey, activeThreads[projectKey] ?? "", w.database?.artifactId])]} onSelect={id => setSelectedProposals(old => ({ ...old, [JSON.stringify([projectKey, activeThreads[projectKey] ?? "", w.database?.artifactId])]: id }))} locked={hasObjectProposalWrite(review.collection, projectKey, w.database?.artifactId)} onConfirm={item => void review.confirm(projectKey, item)} onRecover={item => void review.recover(projectKey, item)} onRefresh={item => void review.refresh(projectKey, item)} onDiscard={item => review.discard(projectKey, item)}>{w.kind === "FEATURE_OVERVIEW" ? <FeatureOverview work={w} databaseMode={databaseMode} canEdit={!databaseMode || Boolean(ps.features[w.featureId]?.canUpdate)} onEdit={() => bench.act(projectKey, { type: "feature-edit", id: w.id })} onField={(field, value) => bench.act(projectKey, { type: "feature-field", id: w.id, field, value })} onCancel={() => bench.act(projectKey, { type: "feature-cancel", id: w.id })} onSave={() => void bench.saveFeature(projectKey, w.id)} onReload={() => void bench.reloadFeature(projectKey, w.id)} feature={projectFeatures(ps).find(f => f.id === w.featureId) ?? { id: w.featureId, name: w.featureName, description: "" }} hasPrd={Object.values(ps.works).some(v => v.featureId === w.featureId && v.kind === "PRD")} canCreate={!databaseMode || Boolean(ps.capabilities?.includes("PRD.create"))} onCreatePrd={() => startCreate(projectKey, "PRD", w.featureId)} />
            : w.kind === "PRD" ? <PrdWorkspace generation={databaseMode ? { state: w.prdGeneration, onStop: () => bench.cancel(projectKey, w.id) } : undefined} persistence={persistence(projectKey, w)} readOnly={Boolean(w.readOnly)} featureName={w.featureName} session={w.session} onAction={action => bench.objectAction(projectKey, w.id, action)} onGenerateUcs={() => bench.generateUcs(projectKey, w.id)} ucGenerating={Boolean(w.ucTask)} ucGenerated={hasGeneratedUcBatch(w)} canGenerateUcs={canGenerateUcBatch(w)} onStopUcs={() => bench.cancel(projectKey, w.id)} generatedUcs={w.database ? [] : featureUcs(ps, w.featureId).map(uc => ({ id: uc.id, label: workLabel(uc) }))} onOpenUc={id => open(id)} generatedCandidates={[]} />
            : w.kind === "UC" ? <UcWorkspace persistence={persistence(projectKey, w)} acceptedPrdRevisionId={acceptedPrd(ps, w.featureId)} readOnly={Boolean(w.readOnly)} referenceTargets={Object.fromEntries(featureUcs(ps, w.featureId).map(c => [c.number, c.id]))} onOpenReference={id => open(id)} featureName={w.featureName} number={w.number} sourceName={w.featureName} onSource={() => open(w.sourcePrdWorkId)} session={w.session} onAction={action => bench.objectAction(projectKey, w.id, action)} />
            : isPanorama(w) ? renderPanorama(projectKey, ps, w)
            : w.kind === "FR_OVERVIEW" ? renderFrOverview(projectKey, ps, w)
            : <FrWorkspace persistence={persistence(projectKey, w)} candidates={acceptedUcs(ps, w.featureId)} readOnly={Boolean(w.readOnly)} featureName={w.featureName} number={w.number} session={w.session} onAction={action => bench.objectAction(projectKey, w.id, action)} onBack={() => open(w.sourceOverviewId)} />}</ObjectProposalWorkspace>
          </section>))}
          {databaseMode && Object.entries(bench.store).flatMap(([projectKey, ps]) => [...new Set(Object.values(ps.works)
            .filter(w => w.kind === "FR_OVERVIEW" || w.kind === "FR_ALLOCATION_OVERVIEW").map(w => w.featureId))]
            .map(featureId => renderAllocationWorkspaces(projectKey, ps, featureId)))}
        </div>
        <div className="project-conversation-host">{Object.entries(projectStates).map(([key, ps]) => <ProjectConversation proposals={review.collection[proposalScope(key, activeThreads[key] ?? "")] ?? []} onProposals={(threadId, requestId, changes) => review.receive(key, threadId, requestId, changes)} onOpenProposal={item => { cancelReveal(); openProposal(key, item); }} onCreateFunction={() => startCreate(key, "function")} createFunctionDisabled={key !== project || databaseLoading || Boolean(databaseError) || databaseMode && !ps.capabilities?.includes("function.create")} createFunctionDisabledReason={databaseMode && !ps.capabilities?.includes("function.create") ? "当前账号无功能创建权限或业务写入未启用" : undefined} onThreadChange={id => handleThreadChange(key, id)} onSaved={() => bench.seedDatabase(key, key, {})} key={key} project={key} state={ps} readOnly={databaseMode} visible={key === project} docked={Boolean(ps.activeId)} onAction={action => bench.act(key, { type: "conversation", action })} onMode={mode => selectMode(mode, undefined, key)} onPrdSubmit={(prompt, target, name) => submitPrdCreation(key, prompt, target, name)} onGenerateUcs={id => { void bench.generateUcs(key, id); bench.act(key, { type: "conversation", action: { type: "mode", mode: null } }); }} prdCreation={databaseMode ? creationSessionMap[key] : undefined} onPrdModeExit={() => exitPrdCreation(key)} onSend={(kind, retry, fail) => {
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
    {close && closing && <WorkDialog title={close.reason === "dirty" ? tr("关闭前保存修改？") : tr("当前对象仍有任务运行")} onClose={() => bench.resolveClose(project, close.id, "cancel")}><p><strong>{workLabel(closing)}</strong></p><p>{close.reason === "dirty" ? (closing.kind === "FEATURE_OVERVIEW" ? tr("功能资料只更新名称和描述，不修改PRD正文；项目对话与附件保留。") : tr("关闭只影响对象视图，项目对话与附件保留。保存草稿不会自动确认。")) : tr("请停止对象任务再关闭；项目对话独立保留。")}</p>{closing.session.notice && <p role="status">{tr(closing.session.notice)}</p>}{p.notice.includes("校验") && <p role="alert">{tr(p.notice)}</p>}<div className="dialog-actions" aria-busy={closing.saving}><button className="button-secondary" disabled={closing.saving} onClick={() => bench.resolveClose(project, close.id, "cancel")}>{tr("取消")}</button>{close.reason === "dirty" ? <><button className="button-secondary" disabled={closing.saving || (closing.kind === "FEATURE_OVERVIEW" && Boolean(closing.metadataAttempt))} onClick={() => bench.resolveClose(project, close.id, "discard")}>{tr("不保存并关闭")}</button><button className="button-primary" disabled={closing.saving} onClick={() => bench.resolveClose(project, close.id, "save")}>{tr("保存并关闭")}</button></> : <button className="button-danger" onClick={() => bench.resolveClose(project, close.id, "stop")}>{isWorkRunning(closing) ? tr("停止并关闭") : tr("关闭标签")}</button>}</div></WorkDialog>}
  </div>;
}





