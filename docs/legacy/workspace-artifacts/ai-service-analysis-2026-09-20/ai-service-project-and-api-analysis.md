**ai_service 项目阅读与 API 接入说明**

分析日期：2026-09-20。实际代码目录：`E:\Git projects\Agent Project\ai_service`。用户提供的 `E:\Git projects\Agent Project\ai\_service` 不存在，本文对应找到的 `ai_service` 仓库。

代码版本：`main`，提交 `1481722733daa3fecfa44e1ff836c11666b86770`，提交日期 2026-09-18，提交说明为 `feat: add agent playground frontend and improve supervisor agent capabilities`。阅读时工作树干净；没有修改被分析项目。

本文以实现为依据区分“已接线的能力”“预留字段”“存在缺陷的能力”。阅读范围覆盖 API、服务层、Agent 构建与编排、全部 YAML 配置和技能、模型与日志、Playground 及测试脚本。完成 27 个 Python 文件语法解析和关键函数离线核验；没有启动完整服务，也没有调用外部大模型。当前可用 Python 运行时缺少该项目的 FastAPI、LangChain、LangGraph 等依赖，因此不把源码结论表述为整套服务联调通过。

**1. 项目在做什么**

这是面向汽车研发业务的 AI 文本生成与智能体编排服务。业务系统通过 HTTP 把功能诉求或已有资料传进来，服务调用大模型，返回功能定义、功能说明、提示词扩写或功能安全危害分析草稿。

技术组成：

| 层 | 实现 | 职责 |
|---|---|---|
| HTTP API | Python / FastAPI / Pydantic | 鉴权、请求解析、同步调用、异步任务查询及恢复 |
| 场景解析 | scenes.yaml + SceneResolver | 将业务场景码映射到 Agent 和技能 |
| 能力目录 | capability_registry.py + YAML | 声明技能输入、输出、提示词、所属 Agent |
| 智能编排 | LangGraph | Planner 制定步骤，Executor 顺序执行 |
| 模型调用 | LangChain ChatOpenAI | 访问 OpenAI 兼容的模型服务，默认配置指向 DeepSeek |
| 会话状态 | AsyncSqliteSaver | 保存编排图的会话检查点 |
| 异步任务状态 | 内存字典 + asyncio.Task | 当前进程内的任务运行、查询、取消、幂等和清理 |
| 调试页面 | 原生 HTML / JS / CSS | Playground，同步/异步切换、轮询、恢复中断、原始 JSON 展示 |

业务调用存在两条路径：

```text
提供 scene + inputs
  → 校验场景、必填输入
  → 读取对应技能模板
  → 用 inputs 填充模板，并追加 reference_data
  → 调用模型
  → 返回文本结果

不提供 scene，提供 message
  → Planner 根据能力目录和会话历史生成执行计划
  → Executor 顺序调用技能、专业 Agent，或由中枢回答
  → 可以引用前一步结果、拼接多个结果、暂停询问/确认
  → 返回最终文本和执行计划
```

直达模式通常只需要一次模型调用；编排模式至少需要规划步骤，随后根据计划调用模型。`compose` 是代码拼接前序结果，不是再次调用模型做内容融合；当前编排也是顺序执行，没有并行调度实现。

当前没有接入企业业务数据库读写、知识库检索/RAG、文档上传解析、后台业务工具 HTTP 调用、工作流审批系统或 Word/Excel 文件生成。`reference_data` 是调用方预先取得资料后传入的对象。功能安全技能产出 HARA 文本草稿，未实现独立的确定性 S/E/C→ASIL 计算与标准规则校验。

**2. 当前实际业务能力**

中枢配置启用 `product_agent` 和 `functional_safety_agent` 两个专业 Agent，共绑定四个技能。

| 业务能力 | Agent / Skill | 调用方式 | 结果 |
|---|---|---|---|
| 功能说明扩写 | product_agent / feature_expand | `scene=ONE_CLICK_EXPAND`，也可自然语言编排 | 目标为 50～100 字的一段纯文本 |
| 完整汽车功能定义 | product_agent / feature_definition | `scene=DEFINE_FEATURE`，也可自然语言编排 | 10 个固定章节的 Markdown 文本 |
| 提示词扩写 | product_agent / prompt_expand | `scene=PROMPT_EXPAND`，也可自然语言编排 | 目标为输入约 3 倍或以上的提示词正文 |
| 功能安全危害分析 | functional_safety_agent / hazard_analysis | **目前只能通过不带 scene 的自然语言编排触达** | 分析范围、危害分析表、安全目标建议，含 S/E/C/ASIL |
| 汽车专业问答 | 上述专业 Agent | 自然语言编排 | 模型文本回答 |
| 闲聊、通用问答 | supervisor 中枢 | 自然语言编排 | 模型文本回答 |

10 章功能定义依次为：功能概述、功能边界、使能条件、触发条件、功能行为与执行输出、退出与抑制条件、输入信号、输出对象、异常与降级处理、法规标准与安全关注。

字数、章节、表格、工程内容要求主要通过提示词约束，没有完整的结果合规校验；不能理解为程序保证每次严格满足。

以下内容属于配置描述或预留，不是已开通的业务能力：

- `fallback_agent.yaml` 存在，但中枢成员清单将它注释掉，没有接入明确的异常恢复流程。模块批量加载该文件不等于中枢会调度它。
- `GENERATE_UC`、`GENERATE_PRD` 在 scenes.yaml 中被注释，没有启用。
- 功能安全 Agent 描述中提到的安全需求、安全案例、DIA 等没有独立技能；目前实际绑定的只有 `hazard_analysis`。专业 Agent 的通用问答也不等于这些能力有完整工程实现。
- 顶层 HTTP 请求不支持用 `agent`、`skill` 直接指定任意技能；这两个字段不在请求模型中，多传通常会被忽略。

依据：[中枢成员配置](<E:/Git projects/Agent Project/ai_service/agents/configs/supervisor_agent.yaml:26>)、[场景配置](<E:/Git projects/Agent Project/ai_service/agents/configs/scenes.yaml:4>)、[编排执行器](<E:/Git projects/Agent Project/ai_service/agents/supervisor_graph.py:263>)。

**3. 对外接口总表**

默认运行地址为 `http://<服务器>:8300`。业务路由完整前缀是 `/api/v1/agent`；源文件注释有时省略 `/api/v1`，接入时应使用下表完整路径。

| 方法 | 完整路径 | 请求 | 正常返回 | 用途 |
|---|---|---|---|---|
| POST | `/api/v1/agent/invoke` | AgentRequest JSON | 200，InvokeResponse | 同步等待本轮结果或人工中断 |
| POST | `/api/v1/agent/tasks` | AgentRequest JSON | 202，task_id / thread_id / status | 创建后台异步任务 |
| GET | `/api/v1/agent/tasks/{task_id}` | 路径 task_id | 200，TaskDetailResponse | 查询状态及结果 |
| POST | `/api/v1/agent/tasks/{task_id}/resume` | 路径 task_id + `{"reply":"..."}` | 200，TaskDetailResponse | 恢复等待人工的任务；本次 HTTP 会等待续跑结果 |
| POST | `/api/v1/agent/tasks/{task_id}/cancel` | 路径 task_id；无请求体 | 200，task_id / status / message | 尽力取消非终态任务 |
| GET | `/api/v1/agent/capabilities` | 无业务参数 | 200，agents / scenes | 查询技能目录及场景码 |
| GET | `/healthz` | 无 | 200，`{"status":"ok"}` | 存活探针 |
| GET | `/readyz` | 无 | 200 或 503，status / checks | 检查场景解析器和中枢图是否已初始化 |

前六个业务接口需要 API Key；两个健康探针不需要。没有业务查询参数定义。

辅助入口：`/playground/` 为调试台；FastAPI 默认提供 `/docs`、`/redoc`、`/openapi.json`，代码未对这些入口添加 API Key 依赖。`/readyz` 不会实际请求上游 LLM，因此返回就绪不代表模型接口可用。

没有实现 SSE/WebSocket 流式接口、任务列表接口、会话历史查询/删除接口、文件上传接口、技能配置管理接口、单独的 HARA HTTP 路由。

依据：[路由装配](<E:/Git projects/Agent Project/ai_service/api/main.py:230>)、[同步路由](<E:/Git projects/Agent Project/ai_service/api/routes/invoke.py:17>)、[任务路由](<E:/Git projects/Agent Project/ai_service/api/routes/tasks.py:32>)。

**4. 请求头与鉴权**

| 请求头 | 必填 | 说明 |
|---|---|---|
| `Content-Type: application/json` | JSON 请求使用 | invoke / tasks / resume |
| `X-API-Key` | 与 Bearer 二选一 | 必须匹配服务端 AI_API_KEYS 中的某个值 |
| `Authorization: Bearer <key>` | 与 X-API-Key 二选一 | 两种同时传时 X-API-Key 优先，即使它无效也不会回退 |
| `X-Trace-Id` | 否 | 调用链标识 |
| `X-Request-Id` | 否 | 未提供 X-Trace-Id 时作为备选 |

invoke/tasks 的追踪标识优先级：请求体非空 `trace_id` → `X-Trace-Id` → `X-Request-Id` → 自动生成。响应带 `X-Trace-Id`；resume/cancel 沿用原任务的 trace_id。

鉴权只是共享密钥校验，没有按密钥/用户隔离任务、会话或幂等键。`context.user_id` 不能充当权限控制。前端正式接入宜由自己的业务后端代理访问；服务本身未配置 CORS，中枢附带的 Playground 通过同源访问运行。

依据：[鉴权实现](<E:/Git projects/Agent Project/ai_service/api/deps.py:24>)、[追踪中间件](<E:/Git projects/Agent Project/ai_service/api/main.py:120>)。

**5. invoke / tasks 完整请求参数**

两者共用 AgentRequest，但“被模型接受”不代表“执行时使用”。所有字段在 Pydantic 层都不是无条件必填；业务层另做条件校验。

| 字段 | 类型 | 必填/默认 | 实际作用与限制 |
|---|---|---|---|
| `message` | string / null | 无 scene 时业务必填 | 编排模式的自然语言任务。**有当前已启用的 scene 时，不会作为补充说明传给技能**，与注释描述有差异 |
| `scene` | string / null | 可选，默认 null | 有值则按 scenes.yaml 路由；小写自动转大写，但不自动去首尾空格 |
| `inputs` | object / null | 场景直达时需含对应必填项 | 填充技能模板；无 scene 的编排路径没有直接使用这个字段 |
| `thread_id` | string / null | 可选，不传自动生成 | 编排模式用于 SQLite 检查点及多轮会话；技能直达不会读写会话历史，仅返回此 ID |
| `context` | object / null | 可选 | 预留业务上下文；异步任务保存在内部请求快照中，但没有参与模型输入、权限、工具调用或对外回调载荷 |
| `reference_data` | object / null | 可选 | 调用方提供参考数据。紧凑 JSON、ensure_ascii=False、UTF-8 编码后最多 51,200 字节；超限 413。直达追加到技能提示；编排追加到 Planner 用户消息，不保证逐技能完整透传 |
| `response_format` | string / null | 可选，通常不传 | 接受 text/json。当前 3 个 scene 都固定 text，指定 json 得到 409。无 scene 路径没有落实强制 JSON 输出 |
| `enabled_tools` | string[] / null | 可选 | **未接入执行逻辑**，不能用来限制本次模型可用工具 |
| `callback_url` | string / null | 可选；仅 tasks 使用 | 状态终结或 waiting_human 时尝试 POST。域名必须在环境白名单；白名单外静默跳过。当前 JSON 日期序列化缺陷使实际回调不可依赖 |
| `priority` | string / null | 默认 normal | 接受 low/normal/high；没有优先级调度 |
| `timeout_seconds` | integer / null | 可选，范围 1～3600 | **同步 invoke 不执行这个超时限制**。异步优先请求值，再场景默认值，再 ASYNC_TASK_TIMEOUT_SECONDS（默认 600） |
| `idempotency_key` | string / null | 可选；仅 tasks 生效 | 当前进程内相同键复用旧任务，不比较请求内容，也不按用户隔离；随任务清理/进程重启失效 |
| `trace_id` | string / null | 可选 | 请求追踪标识；不传由请求头或服务生成 |

额外校验特点：

- 技能 YAML 将输入声明为 string，但执行层目前只检查必填值是否为真，没有完整类型/未知字段校验。空串、0、false、空列表等会被视为必填缺失；数字 123 等非空值可能通过并转换成文字。
- 顶层未知字段默认忽略，不会自动报“未知参数”。不要通过自创字段尝试指定 Agent 或模型。
- 常规枚举取 text/json 与 low/normal/high。当前 validator 使用 `if v`，空字符串会漏过枚举校验，不应依赖这一行为。
- 无 scene 且无 message：同步返回 SKILL_INPUT_MISSING；异步提交阶段没有完成该校验，会先返回 202，后台再出错。又因缺少 ApiError 导入，可能停留 planning。
- 直接场景中，重要业务说明应写入技能规定的 inputs 或 reference_data，不要只放在 message/context。

依据：[请求模型](<E:/Git projects/Agent Project/ai_service/api/schemas.py:46>)、[同步执行入口](<E:/Git projects/Agent Project/ai_service/api/services/agent_runner.py:107>)、[异步提交](<E:/Git projects/Agent Project/ai_service/api/services/agent_runner.py:408>)。

**6. 业务 inputs 参数清单**

| 场景码/能力 | inputs 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| ONE_CLICK_EXPAND | `feature_name` | string | 是 | 功能名称，如 AEB 自动紧急制动 |
| ONE_CLICK_EXPAND | `feature_points` | string | 否 | 功能点/关键诉求，建议顿号或分号分隔 |
| DEFINE_FEATURE | `feature_request` | string | 是 | 完整功能诉求，可包含车型、场景及约束 |
| PROMPT_EXPAND | `prompt` | string | 是 | 要扩写的原始提示词 |
| hazard_analysis 内部技能 | `item_definition` | string | 是 | 分析对象/功能/系统描述 |
| hazard_analysis 内部技能 | `operational_scenarios` | string | 否 | 运行场景、边界、环境与人员状态 |
| hazard_analysis 内部技能 | `known_hazards` | string | 否 | 已知危害、关注点、失效模式 |
| hazard_analysis 内部技能 | `standard` | string | 否 | 适用标准，如 ISO 26262 |

危害分析这四个字段属于内部技能契约，目前应将这些信息写进 message，由 Planner 提取后交给技能。仅传无 scene 的 inputs 不会直接调到该技能；传 `scene=HAZARD_ANALYSIS` 当前会返回 SCENE_NOT_FOUND。

| 已启用 scene | response_format | 异步默认超时 |
|---|---|---|
| ONE_CLICK_EXPAND | text | 30 秒 |
| DEFINE_FEATURE | text | 120 秒 |
| PROMPT_EXPAND | text | 30 秒 |

上述超时来自配置，仅在异步初次执行时实际由 wait_for 使用。无 scene 异步默认 600 秒。resume 不使用这段 wait_for，因此等待人工及续跑不受完整生命周期的统一时限约束。

依据：[功能说明扩写](<E:/Git projects/Agent Project/ai_service/skills/feature_expand.yaml:22>)、[功能定义](<E:/Git projects/Agent Project/ai_service/skills/feature_definition.yaml:19>)、[提示词扩写](<E:/Git projects/Agent Project/ai_service/skills/prompt_expand.yaml:19>)、[危害分析](<E:/Git projects/Agent Project/ai_service/skills/hazard_analysis.yaml:19>)。

**7. 响应参数**

`POST /invoke`：

| 字段 | 类型 | 说明 |
|---|---|---|
| thread_id | string | 会话标识 |
| task_id | string | 本次调用生成的标识；**同步调用未写入 TaskStore，不能据此直接轮询/resume/cancel** |
| mode | string | skill_direct / orchestrated |
| scene | string / null | 场景码 |
| output | string / null | 当前业务主要输出；可能是纯文本或 Markdown 字符串 |
| structured | object / array / null | JSON 结构化输出槽位；现有场景未启用，通常 null |
| plan | object[] / null | 编排计划，场景直达为 null |
| interrupt | object / null | 人工补充/确认的中断信息 |
| usage | object | 直达可返回 prompt_tokens / completion_tokens / total_tokens；编排当前返回空对象 |
| trace_id | string | 追踪标识 |

`POST /tasks` 只返回：`task_id`、`thread_id`、`status`。新任务通常 pending；同一 idempotency_key 再提交时可能返回已有任务的当前状态。

`GET /tasks/{task_id}` 和 `POST /tasks/{task_id}/resume` 返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| task_id / thread_id / trace_id | string | 任务、会话、追踪标识 |
| status | string | 任务状态，见下一节 |
| mode / scene | string / null | 执行模式和场景 |
| progress | object / null | 模型定义 step_index / step_total / current_skill；**当前执行器没有更新链路，一般为 null** |
| plan | object[] / null | 执行计划，通常完成后写回；waiting_human 分支未写入 plan |
| output | string / null | 文本结果 |
| structured | object / array / null | 结构化结果槽位 |
| interrupt | object / null | type、step_id、tool、skill、message |
| error | string / null | 任务失败原因文本，不是完整的 error 对象 |
| created_at / updated_at | ISO 8601 string | API 响应序列化为 UTC 时间字符串 |
| usage | object | token 统计，编排一般为空 |

plan 每项字段：`step_id`、`tool`、`skill`、`inputs`、`input`、`output_key`、`is_final`、`mode`。mode 的设计取值为 single / chain / compose / ask / confirm；后续步骤可用 `${output_key}` 引用已完成步骤输出。

`GET /capabilities`：

- `agents`：以 Agent 名为 key，包含 description、domain、tags、skills；skills 当前序列化了完整技能 YAML 内容，包括 inputs、output、risk_level、prompt_template、可能的 system_prompt 和 `_source`。
- `scenes`：数组；每项为 scene、description、response_format、timeout_seconds。该列表不包含 agent/skill 映射，也不直接带 inputs。
- 因此自动生成表单时不能假设每个 scene 条目直接含参数 Schema；需要额外映射或后端改进。

`POST /cancel`：`task_id`、`status`、`message`。判断结果以 status 为准；当前 message 中“原状态”使用同一可变记录读取，可能错误显示为 cancelled。

依据：[响应模型](<E:/Git projects/Agent Project/ai_service/api/schemas.py:126>)、[能力查询](<E:/Git projects/Agent Project/ai_service/api/routes/capabilities.py:17>)。

**8. 状态、人工交互及持久化**

设计状态为：pending、planning、running、waiting_human、completed、failed、timeout、cancelled、rejected。

| 状态 | 调用方含义 | 当前实现情况 |
|---|---|---|
| pending | 已接收、待执行 | 已实现 |
| planning | 正在编排 | 编排任务会进入；技能执行中没有进一步细粒度更新，可能一直显示 planning |
| running | 执行中 | 直达任务会进入 |
| waiting_human | 需要人工回复 | 可显示 interrupt.message 并调用 resume |
| completed | 完成 | 读取 output；人工拒绝也可能作为 completed 返回一段终止说明 |
| failed | 失败 | 有状态写回代码，但首次后台执行异常存在 ApiError 缺失导入问题 |
| timeout | 超时 | 初次异步执行的 wait_for 超时会设置 |
| cancelled | 已取消 | 尽力取消后台协程；不保证停止底层工作线程内的模型请求 |
| rejected | 拒绝 | 仅枚举预留；鉴权/参数错误通常直接 HTTP 4xx，不创建 rejected 任务记录 |

resume 请求体唯一业务字段：

```json
{"reply":"yes"}
```

reply 必填 string；ask 时提供补充信息，confirm 时当前代码**只接受精确小写 yes**，其他字符串都会按拒绝处理。只有 waiting_human 可恢复；已终态返回 409，pending/planning/running 返回 400。

存在两项人工交互缺陷：

1. confirm 载荷通常含 skill 字符串，但 API 判断 confirm 要求 skill 为 None，导致 confirm 被标记成 ask。
2. ask 的回复只被拼接到自由文本 resolved_input，未自动重规划或补齐 skill_inputs。若原计划为带技能、但缺必填参数的 ask，回复后仍可能缺参；不能保证“追问后自动补齐技能”的完整闭环。

同步 invoke 可能返回 interrupt，但对应 task_id 没有注册到任务存储，不能直接用于 resume。涉及追问/确认的对话应从异步 tasks 入口开始。

SQLite 保存的是编排图检查点。TaskStore 保存的是进程内字典，包括结果、任务状态、幂等索引；重启后原 task_id 不可查询，现有 API 没有从检查点重建任务的流程。终态记录默认保留 24 小时，每 60 秒清理；waiting_human 不在终态清理范围。多进程部署不会共享任务字典。

依据：[任务存储](<E:/Git projects/Agent Project/ai_service/api/services/task_store.py:36>)、[中断判断](<E:/Git projects/Agent Project/ai_service/api/services/agent_runner.py:375>)、[ask/confirm 执行](<E:/Git projects/Agent Project/ai_service/agents/supervisor_graph.py:314>)、[恢复执行](<E:/Git projects/Agent Project/ai_service/api/services/agent_runner.py:576>)。

**9. 错误响应与回调**

业务 ApiError 使用如下结构（示意，不是本次真实服务器响应）：

```json
{
  "error": {
    "code": "SKILL_INPUT_MISSING",
    "message": "技能 feature_expand 缺少必填输入：feature_name",
    "task_id": null,
    "trace_id": "request-001",
    "details": null
  }
}
```

| HTTP | code | 触发情况 |
|---|---|---|
| 401 | UNAUTHORIZED | 缺少或无效的 API Key |
| 400 | SCENE_NOT_FOUND | 未配置的场景 |
| 400 | SKILL_INPUT_MISSING | 必填技能输入或同步编排 message 缺失 |
| 400 | AGENT_NOT_FOUND / SKILL_NOT_FOUND | 场景与能力注册表不匹配 |
| 400 | REQUEST_INVALID | 对非 waiting_human 的非终态任务发起 resume |
| 404 | TASK_NOT_FOUND | 任务不存在、已清理、重启丢失；或误用同步 task_id |
| 409 | OUTPUT_FORMAT_CONFLICT | 与场景固定格式不一致 |
| 409 | TASK_ALREADY_FINISHED | 对终态任务 resume/cancel |
| 413 | REFERENCE_DATA_TOO_LARGE | 参考资料超过 51,200 字节 |
| 422 | SKILL_OUTPUT_INVALID | 技能输出解析/校验失败 |
| 502 | LLM_UPSTREAM_ERROR | 模型/图执行异常在相应路径中被转换 |
| 500 | INTERNAL_ERROR | 未处理异常 |

Pydantic/FastAPI 请求验证失败也会返回 422，但本项目没有注册 RequestValidationError 的统一处理器，因此它是默认 `{"detail":[...]}` 格式。客户端需兼容两种错误体。

`INVOKE_TIMEOUT`、`RATE_LIMITED`、`FORBIDDEN`、`THREAD_NOT_FOUND`、`NOT_IMPLEMENTED`、`TASK_TIMEOUT` 等工厂虽然定义在 errors.py 中，不能据此认定对应限流、超时转异步、会话检查等功能已经接好。异步超时主要表现为查询响应 status=timeout，而不是查询接口返回 HTTP 504。

callback_url 的设计行为：任务进入终态或 waiting_human 时向该 URL POST，正文为任务详情加 `event`（状态字符串），头部附 X-Trace-Id、X-Task-Id、User-Agent。没有签名，不重试，默认请求超时 10 秒。白名单实际按 URL hostname 精确匹配，不是完整内网网段判定。

**当前回调缺陷**：`TaskRecord.to_detail_dict()` 的 created_at/updated_at 是 Python datetime 对象，回调直接将整个字典传给 `httpx.post(json=payload)`，未做 JSON 兼容转换。离线序列化复现 TypeError。因此不能把 callback_url 当作已经联调可用的通知机制，当前接入仍需轮询。

依据：[错误处理](<E:/Git projects/Agent Project/ai_service/api/main.py:142>)、[错误码](<E:/Git projects/Agent Project/ai_service/api/errors.py:41>)、[回调发送](<E:/Git projects/Agent Project/ai_service/api/services/callbacks.py:98>)。

**10. 可供接入使用的请求示例**

以下均为根据代码整理的示例；没有实际发送模型请求。所有业务请求需带 X-API-Key 或 Bearer。

A. 一键扩写：POST `/api/v1/agent/invoke`

```json
{
  "scene": "ONE_CLICK_EXPAND",
  "inputs": {
    "feature_name": "AEB自动紧急制动",
    "feature_points": "识别前方碰撞风险；提醒驾驶员；必要时自动制动"
  },
  "trace_id": "feature-expand-001"
}
```

B. 生成完整功能定义：POST `/api/v1/agent/invoke`

```json
{
  "scene": "DEFINE_FEATURE",
  "inputs": {
    "feature_request": "定义乘用车AEB功能，覆盖城市跟车场景，说明功能边界、输入信号与异常降级，未确定阈值标注待标定。"
  },
  "reference_data": {
    "vehicle_type": "乘用车",
    "known_constraints": ["输入来自前视摄像头和毫米波雷达"]
  }
}
```

C. 扩写提示词：POST `/api/v1/agent/invoke`

```json
{
  "scene": "PROMPT_EXPAND",
  "inputs": {"prompt": "请分析AEB功能的使用场景、边界及异常情况"}
}
```

D. 危害分析/多步编排：POST `/api/v1/agent/tasks`

```json
{
  "message": "请使用功能安全危害分析技能，对乘用车AEB自动紧急制动系统进行HARA。运行场景为城市道路跟车，关注误制动、未制动和制动不足，适用标准ISO 26262。缺失信息标注待确认，输出分析范围、危害分析表和安全目标建议。",
  "timeout_seconds": 180,
  "idempotency_key": "project-demo-aeb-hara-v1",
  "trace_id": "hara-demo-001"
}
```

提交响应形状：

```json
{
  "task_id": "t-example",
  "thread_id": "conv-example",
  "status": "pending"
}
```

后续请求：

```text
GET  /api/v1/agent/tasks/t-example
POST /api/v1/agent/tasks/t-example/resume  Body: {"reply":"补充信息或yes"}
POST /api/v1/agent/tasks/t-example/cancel  无请求体
```

新的对话请求复用返回的 thread_id，可使编排器看到此前保存在该会话中的消息。场景直达结果并不自动加入此会话历史。

E. 查询能力：GET `/api/v1/agent/capabilities`，无请求体。

可直接在 PowerShell 中使用以下模式（替换服务地址与测试密钥）：

```powershell
$agentBase = 'http://localhost:8300'
$agentHeaders = @{ 'X-API-Key' = '<你的测试密钥>' }
$agentBody = @{
  scene = 'ONE_CLICK_EXPAND'
  inputs = @{
    feature_name = 'AEB自动紧急制动'
    feature_points = '碰撞预警；必要时自动制动'
  }
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$agentBase/api/v1/agent/invoke" `
  -Headers $agentHeaders -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($agentBody))
```

**11. 服务端环境参数**

这张表是部署配置，不属于 HTTP 请求字段。core/llm.py 会读取项目根目录 `.env`；当前检出的目录没有看到 `.env` 或 `.env.example`。本次没有读取或输出任何真实密钥。

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| AI_API_KEYS | 无 | 接入方密钥，逗号分隔；为空拒绝启动 |
| LLM_MODEL | deepseek-chat | 模型名称 |
| LLM_BASE_URL | https://api.deepseek.com/v1 | OpenAI 兼容接口地址 |
| LLM_API_KEY | EMPTY | 上游密钥，需按模型服务配置 |
| LLM_TEMPERATURE | 0.7 | 模型温度 |
| LLM_MAX_TOKENS | 8192 | 模型输出 token 配置 |
| LLM_TIMEOUT | 120 | 模型客户端请求超时，秒；不同于业务任务超时 |
| AGENT_HOST | 0.0.0.0 | python -m api.main 启动时的监听地址 |
| AGENT_PORT | 8300 | python -m api.main 启动时的端口 |
| CHECKPOINT_DB | 项目 data/checkpoints.db | 编排会话检查点 SQLite 文件 |
| TASK_RESULT_TTL_HOURS | 24 | 终态任务在内存中的保留小时数 |
| ASYNC_TASK_TIMEOUT_SECONDS | 600 | 无场景且请求未指定时的异步初次执行时限 |
| CALLBACK_TIMEOUT_SECONDS | 10 | 回调 HTTP 请求超时 |
| CALLBACK_DOMAIN_WHITELIST | 空 | 允许回调的 hostname，逗号分隔；空时不回调 |

源码提供的启动方式：`python -m api.main`，或 `uvicorn api.main:app --host 0.0.0.0 --port 8300`。需要先安装 requirements.txt 中的依赖；源码还使用 yaml，依赖清单没有单独声明 PyYAML，部署时需确认该依赖已满足。requirements 使用最低版本范围，没有锁定完整依赖版本。

**12. 接入前应优先处理的问题**

| 优先顺序 | 问题 | 影响 | 证据与验证 |
|---|---|---|---|
| 1 | 后台执行 `except ApiError` 未导入 ApiError | 模型失败、缺参等异常发生时再触发 NameError，任务可停留 planning/running，客户端轮询无法结束 | agent_runner.py:557；离线提取原函数并注入失败内核已复现 |
| 2 | callback payload 含 datetime | 回调发送前 JSON 序列化失败 | callbacks.py:110 + task_store.py:76；实际 TaskRecord 字典 json.dumps 已复现 |
| 3 | 同步 timeout_seconds 未使用 | 请求不能按声明时限退出，也不会自动转异步 | run_invoke 实现中未执行 wait_for；离线替代模型耗时 >1 秒，请求 timeout=1 仍成功返回 |
| 4 | 同步 task_id 不进入 TaskStore | 同步中断的结果不能用任务恢复接口续跑；同步结果不能据 ID 查询 | run_invoke 仅生成 ID 后返回，没有 store.create |
| 5 | confirm 被识别成 ask；ask 不补齐技能 inputs | 前端按钮分支错误，补充信息后可能仍无法执行技能 | _detect_interrupt 条件已离线复现；executor_node 的变量更新静态确认 |
| 6 | context、enabled_tools、priority 等与接口描述不一致 | 调用方误认为业务上下文、工具授权或优先级已生效 | 请求到执行链路追踪 |
| 7 | 内存任务与会话检查点持久化范围不同 | 服务重启后 task_id 失效；多进程实例无法统一查询任务 | TaskStore._tasks/_idem_index 为实例内字典 |
| 8 | 无实际 progress 更新、编排 usage 聚合 | 前端不能据这些字段展示可靠百分比或 token 总量 | 无执行端 progress 写入；编排响应 usage={} |
| 9 | JSON/Markdown 输出契约存在不一致 | hazard_analysis 的 output.schema 是 Markdown 字符串，而 v2 会对非空 schema 尝试 JSON 解析；未来直接给 HARA 增加 scene 可能失败 | hazard_analysis.yaml + _validate_structured_output；**当前 HARA 编排使用旧 execute_skill，不走该 v2 校验** |
| 10 | 每次创建日志回调清空同一日志文件 | 多请求追踪历史丢失，难以稳定按 trace_id 排查 | core/logging.py:38；run_invoke 每请求新建日志器 |

对取消也要按当前实现理解：它会取消 asyncio 包装任务，但技能执行用 asyncio.to_thread 包装同步模型调用，底层线程可能继续工作。resume 本身同步等待续跑，没有注册为原来的后台任务句柄，也没有重设 running 状态和应用统一超时。

现有测试脚本主要面向正在运行的服务，部分需要可达的大模型；人工确认识别、真实回调送达、异步异常状态闭环等并没有得到充分覆盖。本次离线核验专门验证了影响接口理解的几个确定性行为，没有修改这些问题。

**13. 接入建议**

第一批功能最适合选择 3 个已定义的场景：一键扩写、10 章功能定义、提示词扩写。用固定 inputs 表单提交即可。

HARA 和多轮智能对话适合使用 `/tasks` + 轮询 + `/resume`，但应先修复后台异常处理及人工交互问题。HARA 若要做稳定按钮式调用，应新增明确场景，同时修正 Markdown schema 与 v2 校验的冲突，不能只在前端自行传一个场景名。

调用端当前应将 output 当作文本/Markdown处理；不要依赖 structured、progress、priority、enabled_tools，也不要把当前 callback 当作唯一的任务通知方式。任务状态、权限和业务落库由自己的后端管理会更可靠。

**附：关键代码入口**

- [FastAPI 入口](<E:/Git projects/Agent Project/ai_service/api/main.py>)
- [请求/响应模型](<E:/Git projects/Agent Project/ai_service/api/schemas.py>)
- [执行桥接层](<E:/Git projects/Agent Project/ai_service/api/services/agent_runner.py>)
- [场景配置](<E:/Git projects/Agent Project/ai_service/agents/configs/scenes.yaml>)
- [能力注册表及技能执行](<E:/Git projects/Agent Project/ai_service/agents/capability_registry.py>)
- [Planner / Executor](<E:/Git projects/Agent Project/ai_service/agents/supervisor_graph.py>)
- [任务存储](<E:/Git projects/Agent Project/ai_service/api/services/task_store.py>)
- [回调客户端](<E:/Git projects/Agent Project/ai_service/api/services/callbacks.py>)
- [模型配置](<E:/Git projects/Agent Project/ai_service/core/llm.py>)
- [Playground](<E:/Git projects/Agent Project/ai_service/playground/app.js>)
- [离线核验脚本](<C:/Users/zhouguangjian/Documents/ChatGPT/EE AGENT FRONTEND/artifacts/ai-service-analysis-2026-09-20/offline_probes.py>)
- [离线核验结果](<C:/Users/zhouguangjian/Documents/ChatGPT/EE AGENT FRONTEND/artifacts/ai-service-analysis-2026-09-20/offline-probe-results.json>)
