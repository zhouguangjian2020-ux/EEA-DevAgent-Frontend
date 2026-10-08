"use client";
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { readTaskRecords, type TaskRecord } from './task-records';

export function useTaskRecords(project: string, thread: string, visible: boolean) {
  const [snapshot, setSnapshot] = useState<{ key: string; rows: TaskRecord[]; error: string }>({ key: '', rows: [], error: '' });
  const [refresh, setRefresh] = useState(0), key = project + '/' + thread;
  useEffect(() => {
    if (!thread || !visible) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, failures = 0;
    async function poll() {
      if (!alive) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const rows = await readTaskRecords(project, thread, controller.signal);
        if (!alive) return;
        failures = 0;
        setSnapshot(old => old.key === key && !old.error && JSON.stringify(old.rows) === JSON.stringify(rows) ? old : { key, rows, error: '' });
      } catch (e) {
        if (!alive) return;
        failures++;
        // Clear obsolete result links when reads fail; never render another thread's rows.
        setSnapshot({ key, rows: [], error: '任务记录暂不可读；不代表后台生成已取消。可重新读取。' });
        if (e instanceof ApiError && [401, 403, 404, 503].includes(e.status)) failures = 5;
      } finally {
        clearTimeout(timeout);
        if (alive && failures < 5) timer = setTimeout(() => void poll(), failures ? 5000 : 2000);
      }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); controller?.abort(); };
  }, [project, thread, visible, key, refresh]);
  return { tasks: snapshot.key === key ? snapshot.rows : [], error: snapshot.key === key ? snapshot.error : '', refresh: () => setRefresh(n => n + 1) };
}
