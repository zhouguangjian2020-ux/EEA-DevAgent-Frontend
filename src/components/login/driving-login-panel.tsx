"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login, USE_MOCKS } from "@/lib/api/client";

type Props = { active: boolean; onBack: () => void };

export default function DrivingLoginPanel({ active, onBack }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("engineer01");
  const [password, setPassword] = useState("change-me-before-demo");
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    const focusTimer = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 1450);
    return () => window.clearTimeout(focusTimer);
  }, [active]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(false);
    setError(null);
    if (!username.trim() || !password) {
      setError("请输入用户名和密码。");
      return;
    }
    setLoading(true);
    try {
      if (USE_MOCKS) {
        setSubmitted(true);
        router.replace("/");
        return;
      }
      await login(username.trim(), password);
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={"login-panel" + (active ? " is-active" : "")} aria-label="工作区登录" aria-hidden={!active} inert={!active}>
      <div className="panel-eyebrow"><span /> YOUR NEXT CHAPTER</div>
      <h1>欢迎，<br /><span>进入你的工作区。</span></h1>
      <p className="panel-description">让想法与工程，在这里相遇。</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="driving-login-username">用户名</label>
        <div className="input-wrap">
          <span className="input-icon" aria-hidden="true">◎</span>
          <input id="driving-login-username" ref={input} name="username" value={username} onChange={(event) => { setUsername(event.target.value); setError(null); }} autoComplete="username" spellCheck={false} aria-invalid={Boolean(error)} />
        </div>
        <label htmlFor="driving-login-password">密码</label>
        <div className="input-wrap">
          <span className="input-icon lock-icon" aria-hidden="true">▣</span>
          <input id="driving-login-password" name="password" type={visible ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} autoComplete="current-password" aria-invalid={Boolean(error)} />
          <button type="button" className="password-toggle" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible((current) => !current)}>{visible ? "隐藏" : "显示"}</button>
        </div>
        {submitted && <div className="saved-message login-saved-message">演示登录成功，正在进入工作空间。</div>}
        {error && <div className="error-space" role="alert">{error}</div>}
        <button type="submit" className="primary-button login-submit" disabled={loading}>{loading ? "登录中…" : "登录工作区"}<span aria-hidden="true">→</span></button>
      </form>
      <p className="demo-note">◈ {USE_MOCKS ? "演示模式 · 登录状态仅用于本地体验" : "使用既有账号认证 · 凭据通过原登录接口提交"}</p>
      <button type="button" className="back-button" onClick={onBack}>← 返回首页</button>
    </section>
  );
}
