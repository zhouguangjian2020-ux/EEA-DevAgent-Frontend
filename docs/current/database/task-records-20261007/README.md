# 会话任务记录增量（仅一次性本地数据库）

- S4 只增加 `ee.chat_tasks`。系统任务不是聊天 turn；浏览器没有写任务状态的 API，后续 S5 由业务服务根据真实回执更新。
- `apply.sql` 只接受显式数据库名、集群 ID 和端口；只能在 127.0.0.1:56431 的 `ee_manual_*` 一次性 PostgreSQL 上验证，禁止公司集群 ID。必须先安装已有 PRD 意图增量，不修改旧迁移。
- reader 仅 SELECT；writer 仅 INSERT 与明确列 UPDATE，不可 UPDATE 归属、任务类型、请求标识和请求哈希，亦无 DELETE。重复 apply 拒绝。`verify.sql` 只读，`rollback.sql` 仅空表可执行，已有任务则拒绝。
- 当前阶段不向正在运行的用户预览数据库应用，不触发公司数据库操作或发布。验收用独立端口 56431；旧端口 56429 保留。
