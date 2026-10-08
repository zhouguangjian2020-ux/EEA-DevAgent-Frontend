"use client";

import { useEffect, useState } from "react";
import { ApiError, createAccount, getAccounts, updateAccount, type Account } from "@/lib/api/client";

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

type Props = {
  open: boolean;
  databaseMode: boolean;
  mockAccounts: Account[];
  onMockAccountsChange: (accounts: Account[]) => void;
  onClose: () => void;
};

export function AccountDialog({ open, databaseMode, mockAccounts, onMockAccountsChange, onClose }: Props) {
  const [databaseAccounts, setDatabaseAccounts] = useState<Account[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ login_name: "", display_name: "", department: "", password: "" });
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const accounts = databaseMode ? databaseAccounts : mockAccounts;

  useEffect(() => {
    if (!open) return;
    // This effect synchronizes the modal with the account store when it opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError("");
    setNotice("");
    if (!databaseMode) return;
    void getAccounts()
      .then(value => setDatabaseAccounts(value.items))
      .catch(cause => setError(errorText(cause)));
  }, [open, databaseMode]);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (form.password.length < 8) {
      setError("初始密码至少需要8位。");
      return;
    }
    setCreating(true);
    try {
      if (databaseMode) {
        const created = await createAccount(form);
        setDatabaseAccounts(current => [...current, created].sort((a, b) => a.display_name.localeCompare(b.display_name)));
      } else {
        const created: Account = {
          id: `mock-${Date.now()}`,
          login_name: form.login_name,
          display_name: form.display_name,
          department: form.department,
          state: "active",
        };
        onMockAccountsChange([...mockAccounts, created].sort((a, b) => a.display_name.localeCompare(b.display_name)));
      }
      setForm({ login_name: "", display_name: "", department: "", password: "" });
      setNotice("账号已创建。密码只在提交时使用，不会在列表中显示。");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setCreating(false);
    }
  }

  async function toggle(account: Account) {
    const state = account.state === "active" ? "disabled" : "active";
    setBusyId(account.id);
    setError("");
    setNotice("");
    try {
      if (databaseMode) {
        const updated = await updateAccount(account.id, { state });
        setDatabaseAccounts(current => current.map(item => item.id === account.id ? updated : item));
      } else {
        onMockAccountsChange(mockAccounts.map(item => item.id === account.id ? { ...item, state } : item));
      }
      setNotice(state === "active" ? "账号已启用。" : "账号已停用。");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId("");
    }
  }

  return <div className="modal-backdrop">
    <section className="account-dialog permission-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
      <div className="dialog-heading">
        <div><span className="eyebrow">全局账号</span><h2 id="account-dialog-title">账号管理</h2><p className="permission-project-name">账号创建后默认没有任何项目权限。</p></div>
        <button className="close-button" type="button" aria-label="关闭账号管理" onClick={onClose}>×</button>
      </div>
      {error && <div className="permission-feedback error" role="alert">{error}</div>}
      {notice && <div className="permission-feedback" role="status">{notice}</div>}
      <form className="account-create-form" onSubmit={submit}>
        <label className="field-label">登录名<input required value={form.login_name} onChange={event => setForm({ ...form, login_name: event.target.value })} /></label>
        <label className="field-label">显示名称<input required value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} /></label>
        <label className="field-label">部门<input required value={form.department} onChange={event => setForm({ ...form, department: event.target.value })} /></label>
        <label className="field-label">初始密码<input required type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
        <button className="button-primary" disabled={creating}>{creating ? "创建中…" : "创建账号"}</button>
      </form>
      <div className="permission-table-wrap">
        <table className="permission-table">
          <thead><tr><th>账号</th><th>部门</th><th>状态</th><th aria-label="操作" /></tr></thead>
          <tbody>{accounts.map(account => <tr key={account.id}><td><strong>{account.display_name}</strong><small>{account.login_name}</small></td><td>{account.department || "—"}</td><td>{account.state === "active" ? "已启用" : "已停用"}</td><td><button type="button" className="permission-remove" disabled={busyId === account.id} onClick={() => void toggle(account)}>{account.state === "active" ? "停用" : "启用"}</button></td></tr>)}</tbody>
        </table>
      </div>
      <p className="permission-note">密码不会显示或导出；账号停用后不能登录。加入项目和功能授权在“项目权限”中完成。</p>
      <div className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>关闭</button></div>
    </section>
  </div>;
}
