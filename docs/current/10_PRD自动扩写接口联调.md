# 10 PRD 自动扩写接口联调

> 最近更新：2026-09-29（Asia/Shanghai）。本页记录当前已实现的 PRD 输入框自动扩写联调，不修改 `25_工作交接_项目功能PRD_UC_FR_CRUD_20260928.md`。

## 1. 当前 Agent 契约

Agent 服务地址由业务后端 `.env` 的 `AGENT_INVOKE_URL` 配置，当前推荐使用：

```text
POST http://192.168.64.3:8300/api/v1/agent/invoke/stream
X-API-Key: <仅由业务后端读取的密钥>
Accept: text/event-stream, application/json
Content-Type: application/json
```

请求体固定为：

```json
{
  "message": "用户在输入框中输入的文字",
  "scene": "PROMPT_EXPAND"
}
```

已验证的两种上游响应：

1. `/invoke/stream`：`HTTP 200`、`text/event-stream`，逐行返回 `token`，最后返回 `done`。
2. `/invoke`：`HTTP 200`、`application/json`，一次性返回 `output`。

典型流式事件：

```json
{"type":"token","content":"..."}
{"type":"done","scene":"PROMPT_EXPAND","output":"完整正文","trace_id":"..."}
```

后端同时兼容普通 JSON 行和带 `data:` 前缀的 SSE 行。上游的 `task_id`、`thread_id`、原始错误正文等私有字段不会转发给浏览器。

## 2. 调用边界

```text
浏览器
  → POST /api/v1/agent/prd/expand/stream
  → Next.js 同源代理
  → 业务后端 POST /v1/agent/prd/expand/stream
  → Agent /invoke/stream
```

浏览器不直连 `192.168.64.3:8300`，也不携带 `X-API-Key`。Agent Key 只存在业务后端环境变量 `AGENT_API_KEY`，不能写入前端源码、`NEXT_PUBLIC_*`、文档、测试日志或响应正文。

## 3. 业务后端接口

### 3.1 浏览器流式接口

| 项目 | 内容 |
|---|---|
| 后端路径 | `POST /v1/agent/prd/expand/stream` |
| 浏览器路径 | `POST /api/v1/agent/prd/expand/stream` |
| 登录 | HttpOnly `ts_session` Cookie |
| 请求 | JSON：`{"feature_name":"..."}`，1～4000 个字符；额外字段拒绝 |
| 成功响应 | `text/event-stream`，业务后端清洗后的 `token`、`done` |
| 错误 | 已开始响应后以 SSE `error` 事件返回；配置错误仍可返回普通 HTTP 503 |
| 业务副作用 | 只回填输入框，不创建 PRD、功能、标签，不写业务数据库 |

浏览器收到的业务事件示例：

```text
data: {"type":"token","content":"第一段"}

data: {"type":"token","content":"第二段"}

data: {"type":"done","scene":"PROMPT_EXPAND","output":"完整正文","request_id":"...","trace_id":"..."}
```

错误事件示例：

```text
data: {"type":"error","code":"agent_timeout","message":"Agent 扩写超时，原输入已保留，请稍后重试。","request_id":"..."}
```

### 3.2 兼容缓冲接口

| 项目 | 内容 |
|---|---|
| 后端路径 | `POST /v1/agent/prd/expand` |
| 浏览器路径 | `POST /api/v1/agent/prd/expand` |
| 成功响应 | JSON：`text`、`request_id`、`trace_id`、`response_mode=buffered` |
| 用途 | 兼容旧调用或不需要实时显示的调用 |

即使后端配置成 `/invoke`，缓冲接口也能解析 `application/json`；如果流式接口配置成 `/invoke`，它会把完整 `output` 作为一个 token 再发送 `done`，因此不会有真正的 token 粒度效果。要实现真实流式显示，应配置 `/invoke/stream`。

## 4. 前端输入框行为

1. 用户点击输入框中的“自动扩写”。
2. 输入框立即进入只读请求状态，原文暂时保留。
3. Agent 第一个 token 经业务后端 SSE 到达后，输入框的扩写预览开始出现。
4. 后续 token 到达时持续追加，显示真实上游 token 流，不再等待完整结果后由前端模拟逐字动画。
5. `done` 到达后，以最终 `output` 替换预览并回填输入框。
6. 不自动发送、不自动保存、不创建 PRD 或其他业务对象。
7. 点击停止或请求失败时，恢复原输入；停止不会保证远端 Agent 推理同时取消。
8. 浏览器开启 `prefers-reduced-motion` 时，不显示中间帧，只在 `done` 后一次性回填最终结果。
9. 三种输入模式（普通对话、PRD、UC）都可以使用输入框扩写；扩写不要求先选功能，也不改变当前模式或附件。

## 5. 安全与错误边界

- 后端要求登录 Cookie；未登录不会触发上游调用。
- 后端不跟随重定向，不继承代理环境变量，限制响应体和输出长度，并设置整体超时。
- 上游非 200、429、非法 JSON、错误事件、缺少 `done`、场景不匹配或空正文都会转成安全业务错误；原输入保留。
- 前端只解析业务后端 SSE，不解析或展示上游私有追踪字段。
- 该链路仍不是 PRD 生成、确认或数据库写入接口。

## 6. 验证记录

2026-09-29 已完成：

- 上游 `/invoke` JSON 响应兼容测试；
- 上游 `/invoke/stream` token 流兼容测试；
- 业务后端缓冲接口、浏览器 SSE 接口、认证、超时、错误脱敏测试；
- 前端 SSE 分块解析、Unicode、done、error、abort 和输入原文保护测试；
- 后端全量测试：186 passed，118 skipped；
- 前端受影响测试：`agent-expand.test.mjs` 18 passed，`conversation-composer.test.mjs` 21 passed；
- `pnpm typecheck` 通过。

前后端真实 Agent 地址和密钥均只从业务后端运行环境读取；本页不记录真实密钥。
