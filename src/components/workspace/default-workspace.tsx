"use client";
import { useI18n } from "@/features/i18n/provider";
import type { ReactNode } from "react";
import { SparklesIcon } from "./chat-composer";

type DefaultWorkspaceProps = {
  context: string; headline: string; description: string; children: ReactNode;
  history?: ReactNode; hasHistory?: boolean; example?: string; onExample?: () => void; footer?: string;
};
export function DefaultWorkspace({ context, headline, description, children, history, hasHistory, example, onExample, footer }: DefaultWorkspaceProps) {
  const { t: tr } = useI18n();
  return <section className={`default-workspace${hasHistory ? " has-history" : ""}`} aria-label={tr("{0} 默认工作区", { "0": context })}>
    <div className="workspace-context">{tr(context)}</div>
    <div className="default-conversation">
      {!hasHistory ? <div className="default-intro"><div className="default-badge"><SparklesIcon /></div><h1>{tr(headline)}</h1><p>{tr(description)}</p></div> : history}
      {children}
      {!hasHistory && example && <button type="button" className="prompt-example" onClick={onExample}>{example} ↗</button>}
    </div>
    <p className="default-footer">{tr(footer ?? "描述当前功能的任务，生成服务将在后续接入。")}</p>
  </section>;
}
