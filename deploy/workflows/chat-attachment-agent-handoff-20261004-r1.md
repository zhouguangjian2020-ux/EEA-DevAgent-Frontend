# 项目对话附件：Agent 联调排查（2026-10-04）

## 状态与边界

附件问答仍未通过；修改预览仍被上游拒绝。已由用户执行只读诊断，证明下列两次请求的后端附件快照包含完整PRD，与所引用的数据库版本完全一致。此证据不等于Agent收到了或将正文放入模型上下文。禁止据此宣布全部修复，禁止通过用户另贴正文或强改json为text掩盖问题。

未修改应用源码，未重新调用Agent，未连接公司服务器或改配置；没有新部署、SQL写入或重启。保留此前会话持久化和A/B上下文通过记录。

## 精确请求定位（北京时间，UTC+08:00）

- 用户：engineer01
- 项目：新项目 / bf8f4d08-d086-44bf-9cbe-f31abc67ee03
- 功能：DVR / 3bb1333a-1ebf-428c-831f-c26dcd66cfa3
- thread_id：d9fe85d3-70c7-4294-9457-ca84fa6d2f5f
- PRD artifact_id：e1d2a68f-7fdb-4244-b362-c4ddd3486ddb
- 本次引用的 revision_id：8995ab55-2970-45eb-a214-b572fdc1e4a8（不推断为未来请求的当前版本）

| 操作 | 请求时间 | client_request_id / Agent idempotency_key | 后端记录状态 | 用户看到的结果 |
|---|---|---|---|---|
| question | 2026-10-04 10:29:09.149986+08:00 | 4d533de0-794a-4c0f-9590-9eaad4019858 | completed | Agent说未收到PRD正文 |
| modify | 2026-10-04 10:30:29.812692+08:00 | 5e44ba46-c965-40ac-a28c-3c28244e344b | failed | Agent拒绝请求，请核对场景和输出契约 |

注意：上述关联键是idempotency_key，不能当作HTTP trace_id使用。completed仅为请求输出完成，不代表回答正确或附件被使用。

## 两个请求均已证实的快照

- attachment_count=1；kind=PRD；正文为非空字符串。
- 正文17641个字符（Python len，不是字节数或token数）。
- UTF-8正文SHA256：0e19bbc613175ce34d289b418207986a81ae9231372e35879359d807030994e9。
- saved_revision_found=true；matches_saved_revision=true。
- 因而这两条记录不是前端漏选附件、后端读取空正文或快照截断。较早的无附件会话记录不能用于解释这两次请求。

安全证据回执：E:/Git projects/TS-frontend/deploy/workflows/server-chat-snapshot-evidence-20261004-r1.json。未保存业务正文或密钥。

## 冻结版本源码事实（不是Agent入站证据）

已比对主后端workflows-r2冻结归档和本地源码：app/services/workflow_agent.py、app/services/project_chat.py、app/api/routes/workflows.py、app/core/diagnostic_http.py字节一致。

1. 后端将附件快照、历史消息和thread_id组成context；写入chat_turns.attachments与传入Agent请求使用同一批附件。
2. Agent请求字段为reference_data；本轮PRD正文路径是reference_data.attachments[].content.markdown_body。用户指令位于message中，不把附件正文直接拼在message里。
3. question使用response_format=text，走流式调用；modify使用response_format=json，走同步invoke，期望结构化changes数组（artifact_id、base_revision_id、完整content）。
4. 当前聊天调用不传显式scene；需核对Agent实际默认路由/Skill如何选择，不能擅自套用UC等其他场景。
5. 当前modify代码对非200上游响应统一转换为上述拒绝提示；只在诊断捕获已激活时读取拒绝响应体，因此该提示本身无法区分401/403/409/422/5xx等具体原因，也不能据此断言text/json不匹配。

## 请Agent工程师按两个idempotency_key返回

1. **入口证据**：是否收到reference_data.attachments，附件数量、PRD正文字符长度/UTF-8 SHA256；如果入口没有正文，请同时核对网关转发前后。
2. **模型上下文证据**：如果入口完整，正文是否进入本次Skill/模型上下文，而非只传message；如被限长、过滤或丢弃，请给出发生的环节与规则，不必发送完整提示词。
3. **修改失败证据**：原始HTTP状态码、脱敏错误code/message、实际路由/Skill，以及该路由支持的response_format。不得只回传本后端映射后的502文案。

先查已有请求，不要求重放或新生成；不需要API key、Cookie、完整PRD或聊天正文。如果这些历史日志未保存，请明确返回“未保留”，再协商本地隔离复现与脱敏观测，不直接打开公司环境全量日志。

## 后续处理规则

- Agent入口缺正文：核对后端实际出站与网关传递，再确定缺失位置。
- Agent入口正文完整、模型上下文缺正文：修复Agent侧上下文组装/Skill读取。
- 上下文完整仍声称无正文：核查路由、提示词和Skill行为，不按传输丢失处理。
- 修改被拒绝：按原始状态码和错误对齐协议；不得为了通过检查删除结构化修改契约或绕过人工确认。
- 所有新修复先本地调试和测试，由用户本地体验通过后再准备公司发布；当前只继续既有版本验收。
