"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { readTaskRecords, type TaskRecord } from './task-records';
import { TASK_FEEDBACK_EVENT, mergeTaskFeedback, type LocalTaskFeedback, type TaskFeedbackEvent } from './task-feedback';

export function useTaskRecords(project: string, thread: string, visible: boolean) {
  const [snapshot, setSnapshot] = useState<{ key: string; rows: TaskRecord[]; error: string }>({ key: '', rows: [], error: '' });
  const [refresh, setRefresh] = useState(0), key = project + '/' + thread;
  const [local, setLocal] = useState<Record<string, LocalTaskFeedback[]>>({});
  const deniedScopes = useRef(new Set<string>());
  const serverRows = useRef<{ key: string; rows: TaskRecord[] }>({ key: "", rows: [] });
  useEffect(() => {
    const receive = (event: Event) => {
      const { project: origin, thread: originThread, phase, task } = (event as CustomEvent<TaskFeedbackEvent>).detail;
      if (origin !== project) return;
      const scope = origin + "/" + originThread;
      if (deniedScopes.current.has(scope)) return;
      setLocal(previous => {
        const entries = previous[scope] ?? [];
        const existing = entries.find(item => item.task.client_request_id === task.client_request_id);
        const baseline = serverRows.current.key === scope
          ? serverRows.current.rows.find(item => item.client_request_id === task.client_request_id)?.updated_at : undefined;
        return { ...previous, [scope]: [...entries.filter(item => item.task.client_request_id !== task.client_request_id),
          { task, baselineUpdatedAt: phase === "start" ? baseline : existing?.baselineUpdatedAt }] };
      });
    };
    window.addEventListener(TASK_FEEDBACK_EVENT, receive);
    return () => window.removeEventListener(TASK_FEEDBACK_EVENT, receive);
  }, [project]);
  useEffect(() => {
    if (!thread || !visible) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, failures = 0, denied = false;
    async function poll() {
      if (!alive) return;
      controller = new AbortController();
      const currentController = controller;
      const timeout = setTimeout(() => currentController.abort(), 15000);
      try {
        const rows = await readTaskRecords(project, thread, controller.signal);
        if (!alive) return;
        failures = 0;
        deniedScopes.current.delete(key);
        serverRows.current = { key, rows };
        setLocal(previous => {
          const entries = previous[key];
          if (!entries) return previous;
          const retained = entries.filter(entry => !rows.some(row => row.client_request_id === entry.task.client_request_id
            && row.updated_at !== entry.baselineUpdatedAt && !["running", "needs_verification"].includes(row.status)
            && Date.now() >= (entry.task.assistant_visible_at ?? 0)));
          return retained.length === entries.length ? previous : { ...previous, [key]: retained };
        });
        setSnapshot(old => old.key === key && !old.error && JSON.stringify(old.rows) === JSON.stringify(rows) ? old : { key, rows, error: '' });
      } catch (e) {
        if (!alive) return;
        failures++;
        // Temporary transport/503 failures do not delete already displayed history.
        // Access loss still clears protected rows and never falls back to another thread.
        denied = e instanceof ApiError && [401, 403, 404].includes(e.status);
        if (denied) {
          deniedScopes.current.add(key);
          serverRows.current = { key, rows: [] };
          setLocal(previous => ({ ...previous, [key]: [] }));
        }
        setSnapshot(old => ({ key, rows: !denied && old.key === key ? old.rows : [],
          error: denied ? '当前会话不可访问，请重新登录或核对权限。'
            : '任务状态暂未更新，已保留上次记录，正在重试；不代表后台生成已取消。' }));
      } finally {
        clearTimeout(timeout);
        if (alive && !denied) timer = setTimeout(() => void poll(), failures ? Math.min(30000, 5000 * failures) : 2000);
      }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); controller?.abort(); };
  }, [project, thread, visible, key, refresh]);
  const tasks = useMemo(() => mergeTaskFeedback(snapshot.key === key ? snapshot.rows : [], local[key] ?? []), [snapshot, key, local]);
  return { tasks, error: snapshot.key === key ? snapshot.error : '', refresh: () => setRefresh(n => n + 1) };
}
