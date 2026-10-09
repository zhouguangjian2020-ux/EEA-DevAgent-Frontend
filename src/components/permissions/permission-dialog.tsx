"use client";
import { useI18n } from "@/features/i18n/provider";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getPermissionCandidates,
  getPermissionSettings,
  removeFunctionPermission,
  removeProjectMember,
  upsertFunctionPermission,
  upsertProjectMember,
  type Account,
  type FunctionPermission,
  type PermissionSettings,
  type ProjectMemberPermission,
} from "@/lib/api/client";
import "./permission-dialog.css";

type Props = {
  open: boolean;
  projectId: string;
  projectName: string;
  databaseMode: boolean;
  mockAccounts: Account[];
  onClose: () => void;
};

const mockSettings = (projectId: string, projectName: string): PermissionSettings => ({
  project_id: projectId,
  project_name: projectName,
  can_manage: true,
  project_roles: [
    { code: "project_api_author", name: "项目管理员", description: "管理项目成员、项目权限和业务内容" },
    { code: "project_api_reader", name: "项目查看者", description: "查看当前项目内容" },
  ],
  function_roles: [
    { code: "function_viewer", name: "功能查看者", description: "查看指定功能" },
    { code: "function_editor", name: "功能编辑者", description: "编辑、工程审查和确认指定功能" },
  ],
  members: [{
    user_id: "demo-engineer-01",
    login_name: "engineer01",
    display_name: "工程师01",
    department: "电子电气架构部",
    state: "active",
    project_state: "active",
    role_code: "project_api_author",
    role_name: "项目管理员",
  }],
  functions: [{
    id: "mock-function",
    code: "FN-DEMO",
    name: "示例功能",
    permissions: [{
      user_id: "demo-engineer-01",
      login_name: "engineer01",
      display_name: "工程师01",
      department: "电子电气架构部",
      role_code: "function_editor",
      role_name: "功能编辑者",
    }],
  }],
});

function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function PermissionDialog({ open, projectId, projectName, databaseMode, mockAccounts, onClose }: Props) {
  const { t: tr } = useI18n();
  const [tab, setTab] = useState<"members" | "functions">("members");
  const [settings, setSettings] = useState<PermissionSettings | null>(null);
  const [candidates, setCandidates] = useState<Account[]>([]);
  const [selectedFunctionId, setSelectedFunctionId] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [candidateRole, setCandidateRole] = useState("project_api_reader");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    setError("");
    if (!databaseMode) {
      const value = mockSettings(projectId, projectName);
      setSettings(value);
      setSelectedFunctionId(value.functions[0]?.id ?? "");
      const memberIds = new Set(value.members.map(member => member.user_id));
      setCandidates(mockAccounts.filter(account => account.state === "active" && !memberIds.has(account.id)));
      return;
    }
    try {
      const [value, available] = await Promise.all([getPermissionSettings(projectId), getPermissionCandidates(projectId)]);
      setSettings(value);
      setCandidates(available.items);
      setSelectedFunctionId(current => current && value.functions.some(item => item.id === current) ? current : value.functions[0]?.id ?? "");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  useEffect(() => {
    if (!open) return;
    // This effect synchronizes the modal with the selected project's remote permission state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, databaseMode, mockAccounts]);

  const selectedFunction = settings?.functions.find(item => item.id === selectedFunctionId);
  const activeMembers = useMemo(() => settings?.members.filter(member => member.project_state === "active" && member.state === "active") ?? [], [settings]);
  const functionPermissionByUser = useMemo(() => new Map((selectedFunction?.permissions ?? []).map(permission => [permission.user_id, permission])), [selectedFunction]);

  async function saveMemberRole(member: ProjectMemberPermission, roleCode: string) {
    if (!settings || roleCode === member.role_code || !roleCode) return;
    const role = settings.project_roles.find(item => item.code === roleCode);
    if (!role) return;
    setBusyKey(`member-${member.user_id}`); setError(""); setNotice("");
    try {
      if (!databaseMode) {
        setSettings(current => current ? {
          ...current,
          members: current.members.map(item => item.user_id === member.user_id ? { ...item, role_code: role.code, role_name: role.name } : item),
        } : current);
        setNotice("项目成员权限已保存。");
        return;
      }
      await upsertProjectMember(projectId, { user_id: member.user_id, role_code: roleCode });
      setNotice("项目成员权限已保存。"); await reload();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusyKey(""); }
  }

  async function addMember() {
    if (!settings || !selectedCandidateId) return;
    const candidate = candidates.find(item => item.id === selectedCandidateId);
    const role = settings.project_roles.find(item => item.code === candidateRole);
    if (!candidate || !role) return;
    setBusyKey("add-member"); setError(""); setNotice("");
    try {
      if (!databaseMode) {
        const member: ProjectMemberPermission = {
          user_id: candidate.id,
          login_name: candidate.login_name,
          display_name: candidate.display_name,
          department: candidate.department,
          state: "active",
          project_state: "active",
          role_code: role.code,
          role_name: role.name,
        };
        setSettings(current => current ? { ...current, members: [...current.members, member] } : current);
        setCandidates(current => current.filter(item => item.id !== candidate.id));
      } else {
        await upsertProjectMember(projectId, { user_id: selectedCandidateId, role_code: candidateRole });
        await reload();
      }
      setSelectedCandidateId(""); setNotice("成员已加入当前项目。");
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusyKey(""); }
  }

  async function removeMember(member: ProjectMemberPermission) {
    if (!window.confirm(tr(`确定将“${member.display_name}”移出当前项目吗？`))) return;
    setBusyKey(`remove-${member.user_id}`); setError(""); setNotice("");
    try {
      if (!databaseMode) {
        const candidate: Account = { id: member.user_id, login_name: member.login_name, display_name: member.display_name, department: member.department, state: "active" };
        setSettings(current => current ? { ...current, members: current.members.map(item => item.user_id === member.user_id ? { ...item, project_state: "disabled" } : item) } : current);
        setCandidates(current => current.some(item => item.id === candidate.id) ? current : [...current, candidate]);
      } else {
        await removeProjectMember(projectId, member.user_id);
        await reload();
      }
      setNotice("成员已移出当前项目。");
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusyKey(""); }
  }

  async function saveFunctionRole(userId: string, roleCode: string) {
    if (!settings || !selectedFunction) return;
    const member = activeMembers.find(item => item.user_id === userId);
    const role = roleCode ? settings.function_roles.find(item => item.code === roleCode) : undefined;
    if (!member || (roleCode && !role)) return;
    setBusyKey(`function-${userId}`); setError(""); setNotice("");
    try {
      if (!databaseMode) {
        setSettings(current => {
          if (!current) return current;
          return {
            ...current,
            functions: current.functions.map(item => {
              if (item.id !== selectedFunction.id) return item;
              const remaining = item.permissions.filter(permission => permission.user_id !== userId);
              if (!role) return { ...item, permissions: remaining };
              const permission: FunctionPermission = {
                user_id: member.user_id,
                login_name: member.login_name,
                display_name: member.display_name,
                department: member.department,
                role_code: role.code,
                role_name: role.name,
              };
              return { ...item, permissions: [...remaining, permission] };
            }),
          };
        });
        setNotice("功能权限已保存。");
        return;
      }
      if (roleCode === "") {
        if (functionPermissionByUser.has(userId)) await removeFunctionPermission(projectId, selectedFunction.id, userId);
      } else {
        await upsertFunctionPermission(projectId, selectedFunction.id, { user_id: userId, role_code: roleCode });
      }
      setNotice("功能权限已保存。"); await reload();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusyKey(""); }
  }

  if (!open) return null;
  return <div className="modal-backdrop" role="presentation">
    <section className="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-dialog-title">
      <div className="dialog-heading">
        <div><span className="eyebrow">{tr("当前项目")}</span><h2 id="permission-dialog-title">{tr("项目权限")}</h2><p className="permission-project-name">{settings?.project_name ?? projectName}</p></div>
        <button className="close-button" type="button" aria-label={tr("关闭项目权限")} onClick={onClose}>×</button>
      </div>
      <div className="permission-tabs" role="tablist" aria-label={tr("权限设置分类")}>
        <button type="button" role="tab" aria-selected={tab === "members"} className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>{tr("项目成员")}</button>
        <button type="button" role="tab" aria-selected={tab === "functions"} className={tab === "functions" ? "active" : ""} onClick={() => setTab("functions")}>{tr("功能权限")}</button>
      </div>
      {error && <div className="permission-feedback error" role="alert">{tr(error)}</div>}
      {notice && <div className="permission-feedback" role="status">{tr(notice)}</div>}
      {!settings ? <p className="permission-empty" role="status">{tr("正在读取权限设置…")}</p> : tab === "members" ? <div className="permission-body">
        <div className="permission-section-heading"><div><strong>{tr("项目成员")}</strong><span>{tr("先加入项目，再为成员分配功能权限。")}</span></div></div>
        <div className="permission-add-row">
          <select aria-label={tr("选择账号")} value={selectedCandidateId} onChange={event => setSelectedCandidateId(event.target.value)}><option value="">{tr("选择已有账号")}</option>{candidates.map(account => <option key={account.id} value={account.id}>{account.display_name} · {account.department || tr("未填写部门")}</option>)}</select>
          <select aria-label={tr("项目角色")} value={candidateRole} onChange={event => setCandidateRole(event.target.value)}>{settings.project_roles.map(role => <option key={role.code} value={role.code}>{tr(role.name)}</option>)}</select>
          <button type="button" className="button-primary" disabled={!selectedCandidateId || busyKey === "add-member"} onClick={() => void addMember()}>{busyKey === "add-member" ? tr("添加中…") : tr("添加成员")}</button>
        </div>
        <div className="permission-table-wrap"><table className="permission-table"><thead><tr><th>{tr("成员")}</th><th>{tr("部门")}</th><th>{tr("项目角色")}</th><th>{tr("状态")}</th><th aria-label={tr("操作")} /></tr></thead><tbody>{settings.members.map(member => <tr key={member.user_id}><td><strong>{member.display_name}</strong><small>{member.login_name}</small></td><td>{member.department || "—"}</td><td><select aria-label={tr("{0}项目角色", { "0": member.display_name })} disabled={busyKey === `member-${member.user_id}` || member.project_state !== "active"} value={member.role_code} onChange={event => void saveMemberRole(member, event.target.value)}>{settings.project_roles.map(role => <option key={role.code} value={role.code}>{tr(role.name)}</option>)}</select></td><td><span className={member.project_state === "active" ? "permission-state active" : "permission-state"}>{member.project_state === "active" ? tr("已加入") : tr("已停用")}</span></td><td><button type="button" className="permission-remove" disabled={busyKey === `remove-${member.user_id}` || member.project_state !== "active"} onClick={() => void removeMember(member)}>{tr("移出")}</button></td></tr>)}</tbody></table></div>
        <p className="permission-note">{tr("项目管理员拥有当前项目的管理权限；项目查看者只能查看。账号创建后默认不属于任何项目。")}</p>
      </div> : <div className="permission-body">
        <div className="permission-section-heading"><div><strong>{tr("功能权限")}</strong><span>{tr("权限只作用于当前项目内选中的功能，不产生全局授权。")}</span></div><select aria-label={tr("选择功能")} value={selectedFunctionId} onChange={event => setSelectedFunctionId(event.target.value)}><option value="">{tr("选择功能")}</option>{settings.functions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
        {!selectedFunction ? <p className="permission-empty">{tr("当前项目还没有可分配权限的功能。")}</p> : <><div className="permission-function-summary"><strong>{selectedFunction.name}</strong><span>{selectedFunction.code}</span></div><div className="permission-table-wrap"><table className="permission-table"><thead><tr><th>{tr("成员")}</th><th>{tr("项目角色")}</th><th>{tr("功能权限")}</th></tr></thead><tbody>{activeMembers.map(member => { const assigned = functionPermissionByUser.get(member.user_id); return <tr key={member.user_id}><td><strong>{member.display_name}</strong><small>{member.department || member.login_name}</small></td><td>{tr(member.role_name)}</td><td><select aria-label={tr("{0}功能权限", { "0": member.display_name })} disabled={busyKey === `function-${member.user_id}`} value={assigned?.role_code ?? ""} onChange={event => void saveFunctionRole(member.user_id, event.target.value)}><option value="">{tr("无单独功能权限")}</option>{settings.function_roles.map(role => <option key={role.code} value={role.code}>{tr(role.name)}</option>)}</select></td></tr>; })}</tbody></table></div><p className="permission-note">{tr("功能编辑者包含工程审查和确认；没有单独功能权限时，成员仍按项目角色生效。删除权限不绕过业务对象的依赖保护。")}</p></>}
      </div>}
      <div className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>{tr("关闭")}</button></div>
    </section>
  </div>;
}
