import { ApiError } from '@/lib/api/client';
import { createUuid } from '@/lib/uuid';
import { prdCreationApi, type CreationChoice, type CreationInput, type PrdCreationIntent } from './creation-api';

export const CREATION_WAIT_MS = 315_000;
export type CreationState = { prompt: string; candidateName: string | null; input: CreationInput | null; intent: PrdCreationIntent | null; busy: boolean; phase: 'plan' | 'generate' | 'read' | null; uncertain: boolean; notFound: boolean; error: string; notice: string };
export type CreationAnchor = { project: string; thread: string; epoch: number };
export function canNavigateCreationResult(project: string, current: CreationAnchor, dialogProject: string | null, origin: CreationAnchor | null, automatic: boolean, aborted: boolean) {
  return !aborted && current.project === project && dialogProject === project && (!automatic || origin?.project === project && origin.thread === current.thread && origin.epoch === current.epoch);
}
const empty = (): CreationState => ({ prompt: '', candidateName: null, input: null, intent: null, busy: false, phase: null, uncertain: false, notFound: false, error: '', notice: '' });
export const creationInFlight = (intent: PrdCreationIntent | null) => intent?.status === 'planning' || intent?.status === 'generating';
export function canResetCreation(s: CreationState) { return !s.busy && !s.uncertain && !creationInFlight(s.intent) && !(s.intent?.function_id && ['failed', 'interrupted'].includes(s.intent.status)); }
export function canChooseCreation(s: CreationState) { return !s.busy && !s.uncertain && !s.intent?.function_id && Boolean(s.intent?.review) && ['planned', 'failed', 'interrupted'].includes(s.intent!.status); }
export function canRetryCreation(s: CreationState) { return !s.busy && !s.uncertain && Boolean(s.intent) && ['planned', 'failed', 'interrupted'].includes(s.intent!.status); }
const message = (e: unknown) => e instanceof Error ? e.message : '请求未完成';

// One project/thread-local creation intent. No chat messages, auth storage or general task engine.
export class PrdCreationSession {
  private value = empty();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private abort: AbortController | null = null;
  private target: { target_function_id?: string; new_function_name?: string } = {};
  constructor(private project: string, private onResult: (intent: PrdCreationIntent, automatic: boolean, signal: AbortSignal) => Promise<string>, private api = prdCreationApi, private getThread?: () => string, private refreshDirectory?: () => Promise<unknown>) {}
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(change: Partial<CreationState>) { this.value = { ...this.value, ...change }; this.listeners.forEach(fn => fn()); }
  setTarget(target_function_id?: string, new_function_name?: string) {
    if (!this.value.input && !this.value.busy) this.target = { ...(target_function_id ? { target_function_id } : {}), ...(new_function_name ? { new_function_name } : {}) };
  }
  async restore(client_request_id: string) {
    if (this.value.busy) return;
    const thread_id = this.getThread?.();
    const input: CreationInput = { client_request_id, message: '', ...(thread_id ? { thread_id } : {}) };
    await this.run('read', async signal => {
      const intent = await this.api.read(this.project, input, null, signal);
      if (signal.aborted) return;
      if (intent.project_id !== this.project || intent.client_request_id !== client_request_id) throw new Error('创建回执身份不匹配');
      if (!intent.original_message) throw new Error('原始需求暂不可恢复，请勿创建替代任务。');
      this.patch({ input: { ...input, message: intent.original_message,
        ...(intent.target_function_id ? { target_function_id: intent.target_function_id } : {}),
        ...(intent.new_function_name ? { new_function_name: intent.new_function_name } : {}) } });
      await this.accept(intent, signal, false, false);
    }, false);
  }
  setPrompt(prompt: string) { if (!this.value.input && !this.value.busy) this.patch({ prompt }); }
  setCandidateName(candidateName: string) { if (canChooseCreation(this.value)) this.patch({ candidateName }); }
  reset() { if (canResetCreation(this.value)) { this.value = empty(); this.listeners.forEach(fn => fn()); } }
  stop() {
    if (!this.value.busy) return;
    this.epoch++; this.abort?.abort(); this.abort = null;
    this.patch({ busy: false, phase: null, uncertain: true, notice: '已停止等待，后端可能仍在执行或已经保存。请读取回执，不要重新生成。' });
  }
  async submit() {
    if (this.value.busy || this.value.input) return;
    const prompt = this.value.prompt.trim();
    if (!prompt || [...prompt].length > 4000 || prompt.includes('\0')) { this.patch({ error: '请输入1至4000字的需求，不能包含空字符。' }); return; }
    let thread_id: string | undefined;
    try { thread_id = this.getThread?.(); } catch (e) { this.patch({ error: message(e) }); return; }
    this.patch({ input: { client_request_id: createUuid(), message: prompt, ...this.target, ...(thread_id ? { thread_id } : {}) } });
    await this.run('plan', async signal => this.accept(await this.api.create(this.project, this.value.input!, signal), signal, true));
  }
  async resend() {
    if (this.value.busy || !this.value.notFound || !this.value.input) return;
    await this.run('plan', async signal => this.accept(await this.api.create(this.project, this.value.input!, signal), signal, true));
  }
  async choose(choice: CreationChoice) {
    if (!canChooseCreation(this.value) || !this.value.intent) return;
    await this.run('generate', async signal => this.accept(await this.api.execute(this.project, this.value.intent!, choice, signal), signal, false));
  }
  async retry() {
    if (!canRetryCreation(this.value)) return;
    await this.run(this.value.intent!.function_id ? 'generate' : 'plan', async signal => this.accept(await this.api.execute(this.project, this.value.intent!, { action: this.value.intent!.status === 'planned' ? 'auto' : 'continue' }, signal), signal, true));
  }
  async refresh() {
    if (this.value.busy || !this.value.input) return;
    await this.run('read', async signal => this.accept(await this.api.read(this.project, this.value.input!, this.value.intent, signal), signal, false, false), false);
  }
  async open(artifactId?: string) {
    if (this.value.busy || !this.value.intent) return;
    const intent = artifactId ? { ...this.value.intent, artifact_id: artifactId } : this.value.intent;
    await this.run('read', async signal => { const notice = await this.onResult(intent, false, signal); if (!signal.aborted) this.patch({ notice }); }, false);
  }
  private async accept(intent: PrdCreationIntent, signal: AbortSignal, auto: boolean, notify = true): Promise<void> {
    if (signal.aborted) return;
    if (intent.project_id !== this.project || intent.client_request_id !== this.value.input?.client_request_id) throw new Error('创建回执身份不匹配，已停止处理。');
    this.patch({ intent, uncertain: false, notFound: false, error: '', notice: '' });
    if (notify && intent.function_id && ['failed', 'interrupted'].includes(intent.status)) {
      try { await this.refreshDirectory?.(); } catch { this.patch({ notice: '目标功能已保留，但目录刷新失败；请读取目录，不要重复新建。' }); }
    }
    if (intent.status === 'saved' && notify) {
      // Saving has already committed. A directory/navigation failure must never become a generation failure.
      this.patch({ notice: 'PRD已保存为待确认版本；正在读取最新工作空间。' });
      try { const notice = await this.onResult(intent, true, signal); if (!signal.aborted) this.patch({ notice }); }
      catch { if (!signal.aborted) this.patch({ notice: 'PRD已保存，但目录刷新失败。请在文档目录中查看；不要重新生成。' }); }
    } else if (auto && intent.status === 'planned') {
      this.patch({ phase: 'generate' });
      await this.accept(await this.api.execute(this.project, intent, this.value.input?.target_function_id ? { action: 'reuse', function_id: this.value.input.target_function_id } : { action: 'auto' }, signal), signal, false);
    }
  }
  private async run(phase: CreationState['phase'], task: (signal: AbortSignal) => Promise<void>, recover = true) {
    if (this.value.busy) return;
    const epoch = ++this.epoch, ac = new AbortController(); this.abort = ac;
    this.patch({ busy: true, phase, error: '', notice: '', notFound: false });
    const timer = setTimeout(() => { if (this.epoch === epoch) this.stop(); }, CREATION_WAIT_MS);
    try { await task(ac.signal); }
    catch (e) {
      if (epoch !== this.epoch || ac.signal.aborted) return;
      this.patch({ error: message(e), uncertain: true });
      if (recover && this.value.input) {
        try {
          this.patch({ phase: 'read' });
          await this.accept(await this.api.read(this.project, this.value.input, this.value.intent, ac.signal), ac.signal, false);
          if (!ac.signal.aborted && !this.value.notice) this.patch({ error: message(e), notice: '已读取当前回执，未自动重发生成。请按当前状态继续。' });
        } catch (readError) { if (!ac.signal.aborted) this.missing(readError); }
      } else this.missing(e);
    } finally {
      clearTimeout(timer);
      if (epoch === this.epoch) { this.abort = null; this.patch({ busy: false, phase: null }); }
    }
  }
  private missing(e: unknown) {
    if (e instanceof ApiError && e.status === 404 && !this.value.intent) this.patch({ notFound: true, notice: '尚未查到创建回执。可继续查询，或使用原请求标识重发；不会换成新请求。' });
    else this.patch({ error: message(e), notice: this.value.intent?.status === 'saved' ? 'PRD已保存，打开结果失败；请重新读取，不要重新生成。' : '状态待核实；请重新读取回执。后端是否完成不能以连接状态判断。' });
  }
}
