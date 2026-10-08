# 04 Agent 接入契约与限制

> 核对日期：2026-09-20。核对对象：`E:\Git projects\Agent Project\ai_service` 本地源码。  
> **历史快照：第 1～9 节中的“当前/本轮/未部署”均指 2026-09-20，不是今日部署判断。**
> 2026-09-22 用户已确认 PRD 扩写改接 `192.168.64.3:8300/api/v1/agent/invoke/stream`；最新有效接入规则见[第 10 篇](<E:/Git projects/TS-frontend/docs/current/10_PRD自动扩写接口联调.md>)，优先于本页历史示例。
> 2026-09-29 实现状态：PRD 扩写业务后端已固定发送 `scene=PROMPT_EXPAND`，同时兼容上游 `/invoke` 的一次性 JSON 和 `/invoke/stream` 的 `text/event-stream`。浏览器通过业务后端 `/v1/agent/prd/expand/stream` 接收清洗后的 SSE；旧 `/v1/agent/prd/expand` 保留为缓冲兼容接口。以下关于 `ONE_CLICK_EXPAND` 的历史分析不再适用于当前 PRD 输入框链路。

## 1. 地址、端口与调用边界

- 用户提供的服务器 IP：`192.168.64.3`，未验证该机当前服务状态。
- 源码入口 [api/main.py](<E:/Git projects/Agent Project/ai_service/api/main.py>) 读取 `AGENT_HOST` / `AGENT_PORT`；使用 `python -m api.main` 时默认 `0.0.0.0:8300`。采用显式 uvicorn 命令时端口由其启动参数决定。
- 默认端口不是部署承诺；不能把 `http://192.168.64.3:8300` 写成已可调用地址。
- 业务后端调用 Agent；前端只调用业务后端，不把 Agent API Key 下发浏览器。
- 本轮没有启动 Agent、访问其健康检查、调用模型或发送任何补充提示词请求。

## 2. 源码中注册的接口

| 方法 | 路径 | 请求 / 主要响应 | 鉴权 |
|---|---|---|---|
| GET | `/healthz` | 进程存活探针 | 无 |
| GET | `/readyz` | 场景解析器与编排图是否加载；不是模型推理验收 | 无 |
| GET | `/api/v1/agent/capabilities` | 场景和 Agent/技能能力描述 | API Key |
| POST | `/api/v1/agent/invoke` | `AgentRequest`；同步返回结果 | API Key |
| POST | `/api/v1/agent/tasks` | `AgentRequest`；202，返回 task_id/thread_id/status | API Key |
| GET | `/api/v1/agent/tasks/{task_id}` | 任务状态、结果、错误或中断信息 | API Key |
| POST | `/api/v1/agent/tasks/{task_id}/resume` | `{"reply":"人工回复"}`；恢复等待人工的任务 | API Key |
| POST | `/api/v1/agent/tasks/{task_id}/cancel` | 无请求体；返回任务取消状态 | API Key |

源码没有为需求链路提供已实现的 SSE 流式结果接口。以上路由存在不等于异步、回调和人工确认分支已经无缺陷。

鉴权配置为服务端环境变量 `AI_API_KEYS`；请求可传 `X-API-Key` 或 `Authorization: Bearer <key>`，前者优先。文档不收录真实密钥。

## 3. 当前启用的三个场景

| scene | 对应技能 | inputs | 源码描述 / 配置 |
|---|---|---|---|
| `PROMPT_EXPAND` | `prompt_expand` | `prompt`：string，必填 | 提示词扩写；text；配置超时 30 秒 |
| `ONE_CLICK_EXPAND` | `feature_expand` | `feature_name`：string，必填；`feature_points`：string，可选 | 50～100 字功能说明；text；配置超时 30 秒 |
| `DEFINE_FEATURE` | `feature_definition` | `feature_request`：string，必填 | 10 章功能定义；text；配置超时 120 秒 |

注意：

- 配置超时不是已验证的执行保证，见第 7 节。
- `PROMPT_EXPAND` 的技能提示要求扩写至约原输入的三倍；这是提示约束，不是精确长度验证或稳定质量承诺。
- `DEFINE_FEATURE` 是现有汽车功能定义技能，不自动等于项目已约定的完整 PRD 生成接口。
- `hazard_analysis` 技能文件存在，但不是第四个已启用的场景码。
- 预留的 PRD / UC 等场景不能因为写在注释、路线图或评估建议中就调用；当前启用场景以配置为准。

## 4. AgentRequest 参数清单

`invoke` 和 `tasks` 共用请求模型。虽然模型字段多为可选，业务校验仍要求能够选择有效场景或提供自由文本；空对象不是有效业务请求。

| 字段 | 类型 / 默认 | 使用规则与限制 |
|---|---|---|
| `scene` | string / null | 有值时优先场景直达；小写会转大写；必须为已注册场景 |
| `inputs` | object / null | 场景对应技能参数；提示词扩写应把正文放在 `inputs.prompt` |
| `message` | string / null | 无 scene 时用于智能编排；不能代替技能必填 inputs，也不应依赖它自动补齐直达场景输入 |
| `thread_id` | string / null | 会话标识，不传可新建并返回；不是业务对象 ID |
| `context` | object / null | 业务上下文透传；不能代替鉴权、权限校验或技能输入 |
| `reference_data` | object / null | 后端提供的只读参考资料；不等于文件上传接口 |
| `response_format` | `text` / `json` / null | 不传采用场景配置；与场景冲突会报错 |
| `enabled_tools` | string[] / null | 允许的后端工具集合；声明字段不等于全部工具集成已交付 |
| `callback_url` | string / null | 异步回调目标；受 hostname 白名单约束；目前有序列化缺陷，不能依赖 |
| `priority` | `low` / `normal` / `high`，默认 normal | 预留；当前不做差异化调度 |
| `timeout_seconds` | integer / null，范围 1～3600 | 字段有范围校验；同步执行未按它落实超时，不能当作强制截止 |
| `idempotency_key` | string / null | 异步任务内存幂等；不承诺同步幂等、跨进程或重启后幂等 |
| `trace_id` | string / null | 调用追踪；不传自动生成 |

历史离线探测表明：未知顶层字段可能被忽略；技能输入校验偏向必填存在性，并非完整严格类型/未知键校验。调用方仍应按已声明参数构造请求，不能把未报错视为新参数已支持。

## 5. 提示词扩写：部署后供后端适配的请求示例

**下面仅展示请求格式，本轮未执行。**

```http
POST /api/v1/agent/invoke
Content-Type: application/json
X-API-Key: <由业务后端安全读取的密钥>
```

```json
{
  "scene": "PROMPT_EXPAND",
  "inputs": {
    "prompt": "请梳理车辆自动紧急制动功能的使用场景与边界。"
  },
  "response_format": "text"
}
```

同步响应模型声明了 `thread_id`、`task_id`、`mode`、`scene`、`output`、`structured`、`plan`、`interrupt`、`usage`、`trace_id`。本场景正常文本结果读取 `output`；正式对接要处理错误和空结果，不能只假定 HTTP 成功就有可用文本。

业务后端应校验登录与对象范围后调用；前端仅回填输入框，不自动发送、不生成或接受 PRD。暂不在此虚构一个尚未实施的前端→业务后端扩写接口路径。

## 6. 异步与人工确认

- 异步状态枚举包括 pending、planning、running、waiting_human、completed、failed、timeout、cancelled、rejected。
- `waiting_human` 需展示中断信息并通过相同任务的 resume 回复。业务数据库尚缺明确对应映射。
- 同步响应也有 task_id，但没有注册到当前任务存储，不能直接拿它查询或恢复；涉及人工中断应评估异步流程，且先修复相关缺陷。
- 当前 confirm 文本处理与中断类型识别存在问题，不能声称任意“确认”“是”都能继续执行。
- `thread_id`、`task_id` 与业务后端自己的 run_id 必须分开保存与关联。

## 7. 已发现的接入风险：未在本轮修复

| 风险 | 影响 | 证据性质 |
|---|---|---|
| 后台异常处理引用未导入的 `ApiError` | 异常分支可能再次 NameError，任务不能正确结束 | 前次离线函数级复现；本轮核对源文件 |
| 回调字典含 datetime，直接传 JSON 序列化 | 回调发送前失败，不能依赖 callback_url 通知 | 前次真实 TaskRecord 序列化复现 |
| 同步 `timeout_seconds` 未落实 | 调用不能保证按声明时间退出 | 前次替代模型函数级复现 |
| 同步 task_id 未注册任务存储 | 查询/恢复同步中断不可用 | 源码检查 |
| confirm 可能被识别为 ask；ask 回复未自动补全技能 inputs | 人工交互分支或续跑失败 | 前次离线探测 + 源码检查 |
| 任务、幂等索引为进程内存 | 重启丢任务；多个进程不共享查询状态 | 源码检查；SQLite 仅存图检查点 |

这些是局部源码/离线证据，不是本轮服务器端到端测试。正式部署前需在修复后的确定版本回归，不把归档旧测试结果当作永久结论。

## 8. 接入前检查清单（不是本轮执行计划）

- 工程师提供正式部署地址、端口、启动方式、版本和密钥分发方式。
- 确认模型配置与依赖，分别验收存活、就绪、实际推理，避免只测 readyz。
- 修复并复测所选调用链涉及的问题；约定超时、错误、幂等、重试和任务恢复。
- 确认 `PROMPT_EXPAND` 输入/输出、业务后端转接契约、前端只回填行为。
- 再由用户安排实际联调；本轮不自动重试网络请求。

## 9. 依据

- [入口与端口](<E:/Git projects/Agent Project/ai_service/api/main.py>)、[鉴权](<E:/Git projects/Agent Project/ai_service/api/deps.py>)、[请求响应模型](<E:/Git projects/Agent Project/ai_service/api/schemas.py>)
- [场景配置](<E:/Git projects/Agent Project/ai_service/agents/configs/scenes.yaml>)、[提示词扩写技能](<E:/Git projects/Agent Project/ai_service/skills/prompt_expand.yaml>)
- [执行服务](<E:/Git projects/Agent Project/ai_service/api/services/agent_runner.py>)、[任务存储](<E:/Git projects/Agent Project/ai_service/api/services/task_store.py>)、[回调实现](<E:/Git projects/Agent Project/ai_service/api/services/callbacks.py>)
- [归档项目/API 分析](<E:/Git projects/TS-frontend/docs/legacy/workspace-artifacts/ai-service-analysis-2026-09-20/ai-service-project-and-api-analysis.md>)、[离线探测结果](<E:/Git projects/TS-frontend/docs/legacy/workspace-artifacts/ai-service-analysis-2026-09-20/offline-probe-results.json>)

旧分析中的网络请求记录仅代表当时尝试；当前可用性以用户“未部署”的最新确认优先。评估文档提出的额外请求字段、PRD/UC 场景和能力目标不属于本页已核对的当前接口。

