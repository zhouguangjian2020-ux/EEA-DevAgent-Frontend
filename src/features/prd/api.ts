// Browser → same-origin business API only. The Agent address/key stay on the server.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
// Agent generation is capped at 2000s; allow receipt/persistence headroom.
export const PRD_GENERATION_TIMEOUT_MS = 2_100_000;
const MAX_OUTPUT = 200_000;
const MAX_BUFFER = 2_000_000;
const MAX_RESPONSE_BYTES = 8_000_000;
export type PrdGenerationInput = { project_id: string; function_id: string; thread_id?: string; client_request_id?: string; version?: string };
export type PrdGenerationResult = { output: string; requestId: string; traceId: string | null };
const abortError = () => new DOMException("Aborted", "AbortError");
const invalidStream = () => new Error("PRD 生成流格式异常，原 PRD 未修改，请重试。");

export async function streamPrdGeneration(
  input: PrdGenerationInput,
  signal: AbortSignal,
  onProgress: (text: string) => void,
): Promise<PrdGenerationResult> {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, PRD_GENERATION_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(API_BASE_URL + "/v1/agent/prd/generate/stream", {
      method: "POST", credentials: "include", signal: controller.signal,
      headers: { "X-Project-Request": "1", "Content-Type": "application/json", Accept: "text/event-stream" },
      // Whitelist fields; never send a project name, saved PRD body or private key.
      body: JSON.stringify({ project_id: input.project_id, function_id: input.function_id, ...(input.thread_id ? { thread_id: input.thread_id } : {}), ...(input.client_request_id ? { client_request_id: input.client_request_id } : {}), ...(input.version ? { version: input.version } : {}) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      if (response.status === 401) throw new Error("登录已过期，请重新登录后生成；原 PRD 未修改。");
      if (response.status === 422) throw new Error("生成参数无效，请刷新项目后重试；原 PRD 未修改。");
      throw new Error(typeof body?.detail?.message === "string" ? body.detail.message : "PRD 生成请求失败，原 PRD 未修改，请重试。");
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") || !response.body) throw invalidStream();
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "", accumulated = "", bytes = 0;
    let result: PrdGenerationResult | null = null;
    const consume = (block: string) => {
      if (controller.signal.aborted) throw abortError();
      const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data) return; // SSE comments/heartbeats.
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data);
        if (!event || typeof event !== "object" || Array.isArray(event)) throw invalidStream();
      } catch { throw invalidStream(); }
      if (event.type === "token") {
        if (typeof event.content !== "string") throw invalidStream();
        accumulated += event.content;
        if (accumulated.length > MAX_OUTPUT) throw new Error("PRD 生成内容过大，原 PRD 未修改。");
        onProgress(accumulated);
      } else if (event.type === "done") {
        if (event.scene !== "FROM_DEFINITION_CREATE_PRD" || typeof event.output !== "string" || !event.output.trim() || event.output.length > MAX_OUTPUT || typeof event.request_id !== "string" || !event.request_id) throw invalidStream();
        result = { output: event.output, requestId: event.request_id, traceId: typeof event.trace_id === "string" ? event.trace_id : null };
        // Final output is authoritative, not appended to the accumulated tokens.
      } else if (event.type === "error") {
        throw new Error(typeof event.message === "string" ? event.message : "PRD 生成失败，原 PRD 未修改，请重试。");
      }
    };
    while (!result) {
      if (controller.signal.aborted) throw abortError();
      const { value, done } = await reader.read();
      if (controller.signal.aborted) throw abortError();
      if (value) { bytes += value.byteLength; if (bytes > MAX_RESPONSE_BYTES) throw invalidStream(); }
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > MAX_BUFFER) throw invalidStream();
      let delimiter: RegExpExecArray | null;
      while ((delimiter = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        consume(block);
        if (result) break;
      }
      if (done) {
        if (!result && buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!result) throw new Error("PRD 生成连接中断，未收到完成结果；原 PRD 未修改，请重试。");
    return result;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timedOut) throw new Error("PRD 生成等待超时，原 PRD 未修改，请稍后重试。");
    if (error instanceof TypeError) throw new Error("无法读取 PRD 生成流，请检查网络或后端服务；原 PRD 未修改。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    // Release the HTTP stream on completion, validation failure and user cancel.
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    controller.abort();
  }
}
