# 46 FR与项目多会话：统一接口契约与Agent联调

## 2026-10-05生产入口更新

当前生产UC/FR生成使用 `/uc-generations/append` 和 `/fr-generations/append`，成功后原子追加待确认实例；下面原候选API保留为只读联调兼容契约，不再是生产UI主流程。新接口、幂等回执及自动意图的两阶段Agent契约详见[50号接口说明](50_Agent自动意图与生成保存_接口对齐_20261005.md)。

生产对话请求发送 `auto_intent=true`，不提供操作下拉框。旧mode字段保持兼容；Agent先返回question/modify意图，再走流式回答或修改预览。无当前附件时attachments=[]，不补入当前标签或历史附件作为修改目标；正常thread和历史上下文保留。

需求依据：45号规格第2节；三项一起验收。本文描述真实业务后端契约，不代表Agent Skill已完成。FastAPI `/openapi.json` 中的类型为可执行来源。

## 1. 登录与环境

浏览器使用同源 `/api` 代理、HttpOnly `ts_session`；命令行使用登录Cookie jar。所有新POST均带 `Origin: <已允许的前端或联调台Origin>`、`Content-Type: application/json`、`X-Project-Request: 1`。不在浏览器存API Key。先 `POST /v1/auth/login`，再 `GET /v1/auth/me`。密码交互输入，勿放入仓库/trace。

Agent出站鉴权统一为 `X-API-Key`；JSON使用 `AGENT_GENERATION_INVOKE_URL`（可由流式URL派生），聊天使用 `AGENT_INVOKE_URL` 的 `/stream` 地址。密钥只由后端环境提供。公司原7000/7100及既有7018/7200未由本次开发修改。

## 2. FR生成与采纳

- `POST /v1/projects/{project}/functions/{function}/fr-generations`：`{"client_request_id":"UUIDv4"}`。
- 返回 `generation_id, scene, source_version, source, candidates`。`source.sources`为当前功能全部活动且已确认UC的完整修订快照；有任何未确认UC就409，不能仅筛确认子集。
- `source_version`是来源快照哈希。候选包含 `candidate_id,kind=FR,description,acceptance_criteria,sources:[{uc_id,uc_revision_id}]`。数量按语义决定；不会自动保存。
- `POST .../fr-candidates/adopt`：`{"creation_id":"稳定UUIDv4","source_version":"生成返回的哈希","content":{"kind":"FR","description":"人工核对后的描述","acceptance_criteria":"可选验收标准","sources":[{"uc_id":"UUID","uc_revision_id":"UUID"}]}}`。
- 后端在同一保存事务内核对全部来源哈希；来源改变返回409。正式编号由后端生成。保存只产生待确认FR；复用既有 `/artifacts/{id}/accept` 明确确认。重复保存用同一creation_id，已保存候选不会二次创建。多选逐条保存，部分成功明确保留，不宣称批量原子。

Agent出站：
```json
{
  "scene": "FROM_UC_CREATE_FR",
  "response_format": "json",
  "message": "后端生成的约束与任务说明",
  "reference_data": {"project_id":"UUID","function_id":"UUID","sources":[{"artifact_id":"UC UUID","revision_id":"UC修订UUID","head_revision_id":"UUID","accepted_revision_id":"UUID","function_id":"UUID","number":"UC编号","status":"accepted","content":{"kind":"UC","name":"用例名称","description":"完整描述及其余UC字段"}}],"subsystems":[]},
  "trace_id": "请求追踪ID",
  "idempotency_key": "client_request_id"
}
```
以上正文示意省略字段仅为文档易读；实际请求从数据库读出完整字段，不做正文裁剪。Agent返回：
```json
{"scene":"FROM_UC_CREATE_FR","structured":{"functional_requirements":[{"kind":"FR","description":"需求","acceptance_criteria":"验收标准","sources":[{"uc_id":"输入UC UUID","uc_revision_id":"输入修订UUID"}]}]}}
```
也接受 `output` 内的JSON字符串；不接受普通文本冒充JSON。Agent不生成正式FR编号或候选UUID。

## 3. FR分配完整闭环

- `POST .../allocation-generations`：同生成请求体；scene=`FROM_FR_CREATE_SS_ASSIGNMENT`，response_format=`json`。
- reference_data.sources是全部活动且已确认FR完整修订；subsystems是当前项目当前有效目录的真实UUID、名称、描述、design_version_id。没有目录则409，不混用前端Mock字符串ID。
- Agent返回 `{"scene":"FROM_FR_CREATE_SS_ASSIGNMENT","structured":{"assignments":[{"fr_id":"UUID","fr_revision_id":"UUID","targets":[{"subsystem_id":"UUID","rationale":"分配依据"}],"note":"说明","unmatched_reason":""}]}}`。每个输入FR必须恰好出现一次；允许多目标。没有目标时必须给出unmatched_reason；不允许自动新建子系统。
- `POST .../allocations`：`mutation_id,allocation_id,base_revision_id(新建为null),fr_id,fr_revision_id,design_version_id,targets,note,source_version(生成候选时携带)`。
- 人工编辑已保存草稿不必带生成哈希，但必须带原base、FR修订和原目录版本；后台逐项重校验。
- `POST /v1/projects/{project}/allocations/{id}/accept`：`{"mutation_id":"稳定UUIDv4","revision_id":"当前草稿修订"}`。无目标不能确认；过期来源/目录不能确认。
- 改已有确认分配创建新工作修订，保留旧accepted_revision_id，直到显式确认新修订。下拉选中不等于保存；保存不等于确认。已归档分配仍受原稳定身份唯一约束保护，本轮不新增恢复/重建归档分配功能，遇到此情况明确409，不绕过历史。

## 4. 私有项目多会话

- `POST /v1/projects/{project}/conversations`：`{"client_request_id":"UUIDv4","title":"可选标题"}`。后端生成thread UUID；同用户同项目同请求幂等。
- `GET .../conversations?offset=0`：每页最多50个，返回threads及next_offset；前端“更多会话”加载。title投影为该thread首个用户问题（归一化空白、最多120字符）；无提问时保留创建标题。历史接口同样投影标题，创建幂等校验仍使用原始创建标题，无SQL迁移。业务前端首次显示项目对话自动创建thread，下拉只显示title；独立联调台的手动thread流程不变。
- `GET .../conversations/{thread}`：返回自己的thread和turns。跨用户/项目不存在视为404。项目访问撤销后不可读取。
- `POST .../conversations/{thread}/messages/stream`：
```json
{"client_request_id":"UUIDv4","message":"请根据附件分析边界","mode":"question","attachments":[{"artifact_id":"UUID","revision_id":"当前已保存修订"}],"retry":false}
```
- 附件只支持PRD/UC/FR，当前保存版本可为待确认；前端不能提交可信正文，后端读取全量并核验归属与版本。modify模式还必须有对应修改权限。
- Agent聊天请求无强制scene（普通对话契约），`reference_data={project_id,thread_id,messages,attachments}`；messages为按序历史user/assistant消息，包含历史附件和未完成状态。当前用户要求在message中；question为text流，modify为json结构化结果。不自动遍历全项目。
- 流式：`data: {"type":"token","content":"增量"}`，后端最后发`{"type":"done","status":"completed","thread_id":"UUID"}`；失败发error，不把EOF当done。
- 相同成功请求重放历史不重复调用Agent；失败/中断明确重试使用原client_request_id和相同输入，设置retry=true，不重复用户消息。每thread同一时刻只允许一个请求。
- 历史保存到数据库；每thread最多100轮，上下文JSON最多1,500,000 UTF-8字节，超限提示新会话，不默默裁剪。附件20个，单次请求/输出另有字节限制，超限明确失败。停止等待保留中断状态，不保证外部Agent已取消计算。

## 5. 聊天修改预览

modify模式必须携带明确附件。Agent返回`{"structured":{"changes":[{"artifact_id":"附件ID","base_revision_id":"附件精确版本","content":{"kind":"PRD|UC|FR","其他字段":"完整内容"}}]}}`。content遵循OpenAPI的PrdContent/UcContent/FrContent，不可换类型、换UC的PRD来源或FR的UC来源。后端加候选ID与原内容，发送preview事件，工程师可比较。

页面“应用为待确认版本”复用 `/artifacts/{id}/revisions` 带稳定mutation_id与base_revision_id；创建新草稿，不原地覆盖历史，正式确认仍在原对象页面进行。“丢弃建议”只撤去未应用候选，不删原对象或聊天历史。刷新后历史文字保留，但不自动重激活历史预览。生成后的FR为持久化待确认实例，可刷新恢复；未保存分配候选不恢复。

## 6. 独立联调台

新增按钮：FR生成候选、FR分配建议、新建私有会话、项目对话/修改预览。先新建会话，把返回id填入对话thread_id；默认null会明确校验失败，不伪造会话。修改模式只展示预览，联调台不提供业务保存/确认按钮。

真实模式调用固定白名单路径，Origin使用LAB_PUBLIC_ORIGIN，须由管理员明确加入隔离后端PROJECTS_WRITE_ORIGINS。FR生成与分配只读业务来源；会话持久化本身需要写入聊天表。现有7018写开关关闭，因此会话创建会明确503，不能静默改开关。后续公司可写测试部署必须单独审查，不等于给生产加测试写入。

诊断仅记录启用诊断密钥且项目匹配的请求：前端/联调代理、业务后端、SQL与结果、Agent外部HTTP及SSE。Key/Cookie脱敏；超限/缺失明确显示。不是全站抓包，也不是Agent内部观测。

## 7. 验收口径

本地使用真实FastAPI、Next.js、隔离PostgreSQL和真实HTTP契约Mock；Mock源码仅在tests中。A标准通过不代表外部Skill注册、模型质量或公司上线通过。最终测试数字和未执行项见47号记录。
