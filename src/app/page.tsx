"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getCurrentUser, getProject, getProjects, logout as logoutRequest, USE_MOCKS, type Account, type ProjectSummary, type User } from "@/lib/api/client";

import { ProjectDialog } from "@/components/projects/project-dialog";
import { PermissionDialog } from "@/components/permissions/permission-dialog";
import { AccountDialog } from "@/components/permissions/account-dialog";
import { mergeProjects } from "@/features/projects/model";
import { projectIdFromUrl, projectSelectionUrl, resolveProjectSelection } from "@/features/projects/selection";
import { initialMockAccounts } from "@/mocks/permissions";

import { ObjectWorkbench } from "@/components/workbench/object-workbench";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { useTheme } from "@/features/theme/use-theme";
import { LoadingIllustration } from "@/components/feedback/loading";
import { useI18n } from "@/features/i18n/provider";

const demoUser: User = {
  id: "demo-engineer-01",
  username: "工程师01",
  department: "电子电器架构部",
  avatarUrl: null,
  canManageAccounts: true,
};

export default function Home() {
  const { t: tr } = useI18n();
  const router = useRouter();
  const [authReady, setAuthReady] = useState(USE_MOCKS);
  const [authUser, setAuthUser] = useState<User | null>(USE_MOCKS ? demoUser : null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [deletedProjectIds, setDeletedProjectIds] = useState<string[]>([]);
  const [project, setProject] = useState(USE_MOCKS ? "A" : "");
  const [workspaceContext, setWorkspaceContext] = useState("工作台");
  const [hasLocalData, setHasLocalData] = useState(false);
  const [canCreateProject, setCanCreateProject] = useState(false);
  const [hasMoreProjects, setHasMoreProjects] = useState(false);
  const [nextProjectOffset, setNextProjectOffset] = useState(0);
  const [bootstrapError, setBootstrapError] = useState("");
  const [projectSelectionWarning, setProjectSelectionWarning] = useState("");
  const [bootstrapRetry, setBootstrapRetry] = useState(0);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [accountAdminOpen, setAccountAdminOpen] = useState(false);
  const [mockAccounts, setMockAccounts] = useState<Account[]>(() => initialMockAccounts.map(account => ({ ...account })));
  const [theme, setTheme] = useTheme();
  const { locale: language, setLocale: setLanguage } = useI18n();
  const [accountOpen, setAccountOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const accountAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.add("theme-transition");
    const timer = window.setTimeout(() => root.classList.remove("theme-transition"), 360);

    return () => window.clearTimeout(timer);
  }, [theme]);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      if (accountAnchorRef.current && !accountAnchorRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
        setLanguageOpen(false);
      }
    }

    function closeAccountMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountOpen(false);
        setLanguageOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenuOnEscape);
    };
  }, []);

  useEffect(() => {
    if (USE_MOCKS) return;

    let active = true;
    async function bootstrap() {
      try {
        const [user, projectResponse] = await Promise.all([getCurrentUser(), getProjects()]);
        if (!active) return;
        const selection = await resolveProjectSelection(projectIdFromUrl(window.location.href), projectResponse.items, getProject);
        if (!active) return;
        setAuthUser(user);
        setProjects(mergeProjects(projectResponse.items, selection.project ? [selection.project] : []));
        setCanCreateProject(projectResponse.capabilities?.can_create === true);
        setHasMoreProjects(projectResponse.has_more);
        setNextProjectOffset(projectResponse.offset + projectResponse.items.length);
        setBootstrapError("");
        setProject(selection.project?.id ?? "");
        setProjectSelectionWarning(selection.unavailable ? "原先选择的项目不存在、已删除或无权访问，请明确选择项目后再创建功能或 PRD。" : "");
        if (selection.unavailable) setProjectDialogOpen(true);
        if (selection.project) window.history.replaceState(window.history.state, "", projectSelectionUrl(window.location.href, selection.project.id));
        setAuthReady(true);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
        else setBootstrapError(error instanceof Error ? error.message : "无法读取项目列表，请重试。");
      }
    }
    void bootstrap();

    return () => {
      active = false;
    };
  }, [router, bootstrapRetry]);

  function commitProject(id: string) {
    if (!USE_MOCKS) window.history.replaceState(window.history.state, "", projectSelectionUrl(window.location.href, id));
    setProjectSelectionWarning("");
    setProject(id);
    setProjectDialogOpen(false);
  }

  function onProjectCreated(created: ProjectSummary) {
    setProjects(current => mergeProjects(current, [created]));
    commitProject(created.id);
  }


  function onProjectDeleted(projectId: string) {
    setDeletedProjectIds(ids => [...new Set([...ids, projectId])]);
    const remaining = projects.filter(item => item.id !== projectId);
    setProjects(remaining);
    if (project === projectId) {
      window.history.replaceState(window.history.state, "", projectSelectionUrl(window.location.href, ""));
      setProject(""); setProjectDialogOpen(true);
    }
    // Offset pagination shifts when an item is removed; rebase it from page 1.
    void getProjects().then(response => {
      setProjects(response.items); setHasMoreProjects(response.has_more);
      setNextProjectOffset(response.offset + response.items.length);
      setProject(current => current === projectId ? "" : current);
    }).catch(() => { setHasMoreProjects(true); setNextProjectOffset(0); });
  }

  async function loadMoreProjects() {
    const response = await getProjects(nextProjectOffset);
    setProjects(current => mergeProjects(current, response.items));
    setHasMoreProjects(response.has_more);
    setNextProjectOffset(response.offset + response.items.length);
    setCanCreateProject(response.capabilities?.can_create === true);
  }

  function onAvatarUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setAvatarPreview(URL.createObjectURL(file));
  }

  async function logout() {
    if (logoutLoading) return;
    if (hasLocalData && !window.confirm(tr("退出后将清空本页内的模拟业务对象、会话和草稿，确定退出？"))) return;
    setLogoutLoading(true);
    try {
      if (!USE_MOCKS) await logoutRequest();
      router.replace("/login");
    } catch {
      router.replace("/login");
    } finally {
      setLogoutLoading(false);
    }
  }

  if (!authReady) {
    return <main className="login-page"><section className="login-card"><div className="eyebrow">{tr("研发工作空间")}</div><h1>{bootstrapError ? tr("项目列表加载失败") : tr("正在验证登录状态…")}</h1>{bootstrapError ? <p className="login-description" role="alert">{bootstrapError}</p> : <LoadingIllustration kind="workspace" />}{bootstrapError && <button className="button-primary" onClick={() => { setBootstrapError(""); setBootstrapRetry(value => value + 1); }}>{tr("重新加载")}</button>}</section></main>;
  }

  const user = authUser ?? demoUser;
  const avatarSource = avatarPreview ?? user.avatarUrl;
  const currentProject = projects.find(item => item.id === project);
  const canManagePermissions = USE_MOCKS || currentProject?.can_manage_access === true;
  const projectOptions = USE_MOCKS
    ? [{ id: "A", name: "项目A", code: "原型项目A" }, { id: "B", name: "项目B", code: "原型项目B" }]
    : projects;

  return (
    <main className="app-shell">
      <header className="topbar">
        <BrandLockup />
        <button className="project-picker" onClick={() => { setProjectDialogOpen(true); }}>
          <span className="project-mark">{USE_MOCKS ? project : currentProject?.code?.slice(0, 1) ?? "…"}</span><span>{USE_MOCKS ? tr("项目") + project : currentProject?.name ?? tr("选择或新建项目")}</span>
        </button>
         {canManagePermissions && <button type="button" className="permission-topbar-button" onClick={() => setPermissionOpen(true)}>{tr("项目权限")}</button>}
        <div className="breadcrumb">{tr("研发工作空间 ")}<span>/</span> <strong>{workspaceContext}</strong></div>
        <div className="account-anchor" ref={accountAnchorRef}>
          <button className="account-trigger" onClick={() => setAccountOpen((open) => !open)} aria-label={tr("打开账户菜单")}>
            <span className="avatar">{avatarSource ? <img src={avatarSource} alt={tr("头像")} /> : "◉"}</span>
            <span className="account-copy"><strong>{user.username}</strong><small>{user.department} {tr(" · 已登录")}</small></span>
          </button>
          {accountOpen && (
            <div className="account-menu">
              <div className="menu-theme"><span>{tr("外观")}</span><button className="switch" role="switch" aria-checked={theme === "dark"} aria-label={tr("深色模式")} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><span className={theme === "dark" ? "switch-knob on" : "switch-knob"} /></button><small>{theme === "light" ? tr("明亮模式") : tr("深色模式")}</small></div>
              <div className="language-picker">
                <button type="button" className="menu-row" aria-expanded={languageOpen} aria-controls="account-language-options" onClick={() => setLanguageOpen(open => !open)}><span>{tr("语言")}</span><span>{language === "zh-CN" ? tr("简体中文") : "English"} <span aria-hidden="true">›</span></span></button>
                {languageOpen && <div id="account-language-options" className="language-options" role="group" aria-label={tr("界面语言")}><button type="button" aria-pressed={language === "zh-CN"} onClick={() => { setLanguage("zh-CN"); setLanguageOpen(false); }}>{tr("简体中文")}</button><button type="button" aria-pressed={language === "en"} onClick={() => { setLanguage("en"); setLanguageOpen(false); }}>English</button></div>}
              </div>
              <button className="menu-row" onClick={() => { setProfileSaved(false); setProfileOpen(true); setAccountOpen(false); }}><span>{tr("自定义个人资料")}</span><span>›</span></button>
               {user.canManageAccounts && <button className="menu-row" onClick={() => { setAccountAdminOpen(true); setAccountOpen(false); }}><span>{tr("账号管理")}</span><span>›</span></button>}
              <div className="menu-divider" />
              <button className="menu-row danger" onClick={logout} disabled={logoutLoading}><span>{logoutLoading ? tr("退出中…") : tr("退出登录")}</span><span>↗</span></button>
            </div>
          )}
        </div>
      </header>

      {projectSelectionWarning && <p className="workbench-notice" role="alert">{projectSelectionWarning}</p>}
      <ObjectWorkbench project={project} projectLabel={USE_MOCKS ? tr("项目") + project : currentProject ? `${currentProject.name} · ${currentProject.code}` : ""} deletedProjectIds={deletedProjectIds} databaseMode={!USE_MOCKS} onContextChange={setWorkspaceContext} onLocalDataChange={setHasLocalData} />

      <ProjectDialog databaseMode={!USE_MOCKS} onUpdated={updated => setProjects(current => mergeProjects(current, [updated]))} open={projectDialogOpen} currentProject={project} items={projectOptions} canCreate={!USE_MOCKS && canCreateProject} hasMore={!USE_MOCKS && hasMoreProjects} onLoadMore={loadMoreProjects} onClose={() => setProjectDialogOpen(false)} onSwitch={commitProject} onCreated={onProjectCreated} onDeletedProject={onProjectDeleted} />
      {permissionOpen && <PermissionDialog open={permissionOpen} projectId={project} projectName={USE_MOCKS ? tr("项目{0}", { "0": project }) : currentProject?.name ?? tr("当前项目")} databaseMode={!USE_MOCKS} mockAccounts={mockAccounts} onClose={() => setPermissionOpen(false)} />}
      {accountAdminOpen && <AccountDialog open={accountAdminOpen} databaseMode={!USE_MOCKS} mockAccounts={mockAccounts} onMockAccountsChange={setMockAccounts} onClose={() => setAccountAdminOpen(false)} />}

      {profileOpen && <div className="modal-backdrop"><div className="profile-dialog"><div className="dialog-heading"><div><span className="eyebrow">{tr("账户设置")}</span><h2>{tr("自定义个人资料")}</h2></div><button className="close-button" onClick={() => setProfileOpen(false)}>×</button></div><label className="upload-avatar"><span className="large-avatar">{avatarSource ? <img src={avatarSource} alt={tr("头像预览")} /> : "◉"}</span><span><strong>{tr("上传头像")}</strong><small>{tr("支持 JPG、PNG，建议 200×200")}</small><input type="file" accept="image/png,image/jpeg" onChange={onAvatarUpload} /></span></label><label className="field-label">{tr("个人简介")}<textarea placeholder={tr("介绍一下自己…")} defaultValue="负责电子电器架构相关工作" /></label><label className="field-label">{tr("修改密码")}<input type="password" placeholder={tr("输入新密码")} /></label>{profileSaved && <div className="saved-message">{tr("资料已保存（演示状态）")}</div>}<div className="dialog-actions"><button className="button-secondary" onClick={() => setProfileOpen(false)}>{tr("取消")}</button><button className="button-primary" onClick={() => setProfileSaved(true)}>{tr("保存")}</button></div></div></div>}
    </main>
  );
}


