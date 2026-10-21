"use client";
import { useI18n } from "@/features/i18n/provider";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login, USE_MOCKS } from "@/lib/api/client";

type Props = { active: boolean };

export default function DrivingLoginPanel({ active }: Props) {
  const { t: tr } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("engineer01");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active || panel.current?.contains(document.activeElement)) return;
    // Focus once when the settled panel opens, never after the user starts typing.
    input.current?.focus({ preventScroll: true });
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
    <section ref={panel} className={"login-panel" + (active ? " is-active" : "")} aria-label={tr("工作区登录")} aria-hidden={!active} inert={!active}>
      <div className="panel-eyebrow"><span /> YOUR NEXT CHAPTER</div>
      <h1>{tr("欢迎，")}<br /><span>{tr("进入你的工作区。")}</span></h1>
      <p className="panel-description">{tr("让想法与工程，在这里相遇。")}</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="driving-login-username">{tr("用户名")}</label>
        <div className="input-wrap">
          <span className="input-icon" aria-hidden="true">◎</span>
          <input id="driving-login-username" ref={input} name="username" value={username} onChange={(event) => { setUsername(event.target.value); setError(null); }} autoComplete="username" spellCheck={false} aria-invalid={Boolean(error)} />
        </div>
        <label htmlFor="driving-login-password">{tr("密码")}</label>
        <div className="input-wrap">
          <span className="input-icon lock-icon" aria-hidden="true">▣</span>
          <input id="driving-login-password" name="password" placeholder="" type={visible ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} autoComplete="current-password" aria-invalid={Boolean(error)} />
          <button type="button" className="password-toggle" aria-label={visible ? tr("隐藏密码") : tr("显示密码")} onClick={() => setVisible((current) => !current)}>{visible ? tr("隐藏") : tr("显示")}</button>
        </div>
        {submitted && <div className="saved-message login-saved-message">{tr("演示登录成功，正在进入工作空间。")}</div>}
        {error && <div className="error-space" role="alert">{tr(error)}</div>}
        <button type="submit" className="primary-button login-submit" disabled={loading}>{loading ? tr("登录中…") : tr("登录工作区")}<span aria-hidden="true">→</span></button>
      </form>
    </section>
  );
}
