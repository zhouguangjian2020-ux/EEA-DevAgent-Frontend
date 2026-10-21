"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { appendObjectProposals, hasObjectProposalWrite, proposalBlockedReason, proposalNeedsReview, proposalScope, type ObjectProposal, type ProposalCollection } from "./object-proposals";
import { confirmObjectProposal, readObjectProposalReceipt } from "./object-proposal-api";
import type { Modification } from "./workflow-api";
import type { ProjectWorks } from "./model";

type Options = { getState: (project: string) => ProjectWorks | undefined; refresh: (project: string, artifactId: string) => Promise<unknown> };
export function useObjectProposals(options: Options) {
  const [collection, setCollection] = useState<ProposalCollection>({});
  const store = useRef<ProposalCollection>({});
  const currentOptions = useRef(options);
  const running = useRef(new Set<string>());
  useEffect(() => { currentOptions.current = options; }, [options]);
  const update = useCallback((scope: string, transform: (previous: ObjectProposal[]) => ObjectProposal[]) => {
    const next = { ...store.current, [scope]: transform(store.current[scope] ?? []) };
    store.current = next; setCollection(next);
  }, []);
  const receive = useCallback((project: string, thread: string, request: string, changes: Modification[]) => {
    update(proposalScope(project, thread), old => appendObjectProposals(old, thread, request, changes));
  }, [update]);
  const patch = useCallback((project: string, proposal: ObjectProposal, value: Partial<ObjectProposal>) => {
    update(proposalScope(project, proposal.threadId), old => old.map(item => item.candidate_id === proposal.candidate_id ? { ...item, ...value } : item));
  }, [update]);
  const refresh = useCallback(async (project: string, proposal: ObjectProposal) => {
    patch(project, proposal, { refreshing: true });
    try {
      await currentOptions.current.refresh(project, proposal.artifact_id);
      patch(project, proposal, { refreshFailed: false, refreshing: false, message: "已新增修订并确认，历史版本保留。" });
    } catch {
      patch(project, proposal, { refreshFailed: true, refreshing: false, message: "保存并确认已成功，但工作空间刷新失败。请仅重新读取，不要重复保存。" });
    }
  }, [patch]);
  const confirm = useCallback(async (project: string, proposal: ObjectProposal) => {
    const scope = proposalScope(project, proposal.threadId), key = scope + proposal.candidate_id;
    const latest = store.current[scope]?.find(item => item.candidate_id === proposal.candidate_id);
    if (!latest || latest.status !== "pending" || running.current.has(key)) return;
    if (hasObjectProposalWrite(store.current, project, latest.artifact_id, latest.candidate_id)) {
      patch(project, latest, { message: "同一对象已有正在保存或结果待核实的操作，请先在原会话核验结果。" });
      return;
    }
    const state = currentOptions.current.getState(project);
    const work = Object.values(state?.works ?? {}).find(item => item.database?.artifactId === latest.artifact_id);
    const blocked = state && work ? proposalBlockedReason(latest, work, state) : "对象不可访问，请重新读取工作空间。";
    if (blocked) { patch(project, latest, { message: blocked }); return; }
    running.current.add(key); patch(project, latest, { status: "saving", message: undefined });
    try {
      const result = await confirmObjectProposal(project, latest.artifact_id, { mutation_id: latest.candidate_id, base_revision_id: latest.base_revision_id, content: latest.content });
      if (result.artifact_id !== latest.artifact_id || result.revision_id !== latest.candidate_id) throw new Error("保存回执归属不一致");
      patch(project, latest, { status: "saved", savedRevisionId: result.revision_id, refreshing: true });
      await refresh(project, latest);
    } catch (error) {
      const rejected = error instanceof ApiError && [400, 401, 403, 404, 409, 422, 429].includes(error.status);
      patch(project, latest, { status: rejected ? "pending" : "uncertain", message: rejected ? error.message : "未收到可靠的保存结果，请先核验原操作回执。" });
    } finally { running.current.delete(key); }
  }, [patch, refresh]);
  const recover = useCallback(async (project: string, proposal: ObjectProposal) => {
    const key = proposalScope(project, proposal.threadId) + proposal.candidate_id;
    if (running.current.has(key)) return;
    running.current.add(key); patch(project, proposal, { message: "正在核验原操作回执…" });
    try {
      const receipt = await readObjectProposalReceipt(project, proposal.artifact_id, proposal.candidate_id);
      if (receipt.artifact_id !== proposal.artifact_id) throw new Error("回执归属不一致");
      if (receipt.status === "confirmed" && receipt.revision_id === proposal.candidate_id) {
        patch(project, proposal, { status: "saved", savedRevisionId: receipt.revision_id, refreshing: true });
        await refresh(project, proposal);
      } else {
        patch(project, proposal, { status: "uncertain", message: "尚未查到确认回执，原请求可能仍在处理；请稍后再次核验，当前不允许重复提交。" });
      }
    } catch { patch(project, proposal, { status: "uncertain", message: "保存回执暂时无法核验。请保留当前页面，稍后重试核验。" }); }
    finally { running.current.delete(key); }
  }, [patch, refresh]);
  const discard = useCallback((project: string, proposal: ObjectProposal) => {
    update(proposalScope(project, proposal.threadId), old => old.map(item => item.candidate_id === proposal.candidate_id && item.status === "pending" ? { ...item, status: "discarded" } : item));
  }, [update]);
  const hasUnreviewed = Object.values(collection).some(items => items.some(proposalNeedsReview));
  useEffect(() => {
    if (!hasUnreviewed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnreviewed]);
  return { collection, receive, confirm, recover, refresh, discard };
}
