// The browser talks only to the same-origin business backend; the Agent URL and API key never enter this module.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const EXPANSION_TIMEOUT_MS = 135_000;
const MAX_EXPANSION_CHARACTERS = 40_000;

export type PrdExpansion = {
  text: string;
  request_id: string;
  trace_id: string | null;
  response_mode: "buffered" | "stream";
};
type ExpansionErrorBody = { detail?: { message?: unknown } };
type StreamEvent = {
  type?: unknown;
  content?: unknown;
  output?: unknown;
  scene?: unknown;
  trace_id?: unknown;
  code?: unknown;
  message?: unknown;
  request_id?: unknown;
};

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function backendError(response: Response, body: ExpansionErrorBody | null): Error {
  if (response.status === 401) return new Error("登录已过期，请重新登录后重试；原输入已保留。");
  if (response.status === 422) return new Error("请输入 1～4000 个字符的文本，原输入已保留。");
  const message = typeof body?.detail?.message === "string" ? body.detail.message : "自动扩写请求失败，请稍后重试；原输入已保留。";
  return new Error(message);
}

function validateBufferedBody(body: unknown): PrdExpansion {
  if (
    !body ||
    typeof body !== "object" ||
    !((body as { response_mode?: unknown }).response_mode === "buffered") ||
    typeof (body as { text?: unknown }).text !== "string" ||
    !(body as { text: string }).text.trim() ||
    (body as { text: string }).text.length > MAX_EXPANSION_CHARACTERS ||
    typeof (body as { request_id?: unknown }).request_id !== "string"
  ) {
    throw new Error("后端未返回有效扩写文本，原输入已保留。");
  }
  const value = body as { text: string; request_id: string; trace_id?: unknown };
  return {
    text: value.text,
    request_id: value.request_id,
    trace_id: typeof value.trace_id === "string" ? value.trace_id : null,
    response_mode: "buffered",
  };
}

function validateStreamDone(event: StreamEvent, accumulated: string): PrdExpansion {
  if (event.scene !== "PROMPT_EXPAND") throw new Error("Agent 返回场景不匹配，原输入已保留。");
  const output = typeof event.output === "string" && event.output.trim() ? event.output : accumulated;
  if (!output.trim() || output.length > MAX_EXPANSION_CHARACTERS) {
    throw new Error("后端未返回有效扩写文本，原输入已保留。");
  }
  if (typeof event.request_id !== "string" && typeof event.request_id !== "undefined") {
    throw new Error("后端未返回有效扩写请求标识，原输入已保留。");
  }
  return {
    text: output,
    request_id: typeof event.request_id === "string" ? event.request_id : "stream-request",
    trace_id: typeof event.trace_id === "string" ? event.trace_id : null,
    response_mode: "stream",
  };
}

export async function requestPrdExpansion(featureName: string, signal: AbortSignal): Promise<PrdExpansion> {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, EXPANSION_TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE_URL + "/v1/agent/prd/expand", {
      method: "POST", credentials: "include", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      // The business backend maps feature_name to Agent message and owns the private key.
      body: JSON.stringify({ feature_name: featureName }),
    });
    const body = await response.json().catch(() => null) as ExpansionErrorBody | null;
    if (!response.ok) throw backendError(response, body);
    return validateBufferedBody(body);
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timedOut) throw new Error("自动扩写等待超时，原输入已保留，请稍后重试。");
    if (error instanceof TypeError) throw new Error("无法连接业务后端，原输入已保留，请检查服务是否启动。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Read the business backend's SSE bridge. Tokens are appended in arrival order
 * and passed to onProgress, so the composer can render genuine upstream
 * progress instead of simulating characters after a buffered response.
 */
export async function streamPrdExpansion(
  featureName: string,
  signal: AbortSignal,
  onProgress: (text: string) => void,
): Promise<PrdExpansion> {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, EXPANSION_TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE_URL + "/v1/agent/prd/expand/stream", {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: { "Accept": "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ feature_name: featureName }),
    });
    const errorBody = response.ok ? null : await response.json().catch(() => null) as ExpansionErrorBody | null;
    if (!response.ok) throw backendError(response, errorBody);
    if (!response.body) throw new Error("后端未返回流式响应，原输入已保留。");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let result: PrdExpansion | null = null;

    const consumeBlock = (block: string): void => {
      const data = block
        .split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(data) as StreamEvent;
      } catch {
        throw new Error("后端流式响应格式异常，原输入已保留。");
      }
      if (event.type === "token") {
        if (typeof event.content !== "string") throw new Error("后端流式响应格式异常，原输入已保留。");
        accumulated += event.content;
        if (accumulated.length > MAX_EXPANSION_CHARACTERS) throw new Error("扩写结果过大，原输入已保留。");
        if (signal.aborted) throw abortError();
        onProgress(accumulated);
        return;
      }
      if (event.type === "done") {
        result = validateStreamDone(event, accumulated);
        if (result.text !== accumulated) onProgress(result.text);
        return;
      }
      if (event.type === "error") {
        throw new Error(typeof event.message === "string" ? event.message : "自动扩写失败，原输入已保留，请稍后重试。");
      }
      // Progress metadata not needed by the composer is intentionally ignored.
    };

    let finished = false;
    while (!finished) {
      const read = await reader.read();
      if (read.done) {
        buffer += decoder.decode();
        finished = true;
      } else {
        buffer += decoder.decode(read.value, { stream: true });
      }
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        consumeBlock(block);
        if (result) break;
      }
      if (result) {
        await reader.cancel();
        break;
      }
    }
    if (!result && buffer.trim()) consumeBlock(buffer);
    if (!result) throw new Error("扩写流未正常结束，原输入已保留，请稍后重试。");
    return result;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timedOut) throw new Error("自动扩写等待超时，原输入已保留，请稍后重试。");
    if (error instanceof TypeError) throw new Error("无法连接业务后端，原输入已保留，请检查服务是否启动。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
