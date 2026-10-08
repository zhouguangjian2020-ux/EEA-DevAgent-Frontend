# 权限管理增量包（2026-09-29）

本目录是“项目权限设置 + 本地登录账号”的独立数据库增量包，服务于本轮已确认的固定权限设计：

- 项目角色：项目管理员、项目查看者。
- 功能角色：功能查看者、功能编辑者；工程审查和确认包含在功能编辑者中，不再单独设置功能审核者。
- 权限只在当前项目内生效；功能级授权只作用于指定功能。
- 第一版没有显式拒绝规则、自由权限矩阵或组织架构权限。
- 新账号默认可以登录，但不会自动加入项目，也不会自动获得任何项目或功能权限。

## 前置条件

本包只能在以下增量已完成并验证后使用：

1. R2 基础数据库包。
2. 共享 writer 已完成 `ee_project_api_create` → `ee_project_api_rw` 改名及 manual-work 迁移。
3. `metadata-edit-20260928` 已 apply/verify 通过。
4. 现场已停止业务写入，并已完成目标数据库和 PostgreSQL cluster 的只读核对、备份和回执留存。

本包要求 PostgreSQL 18、已审核的 R2 schema migration 指纹和安全的 `ee_m0_owner` 所有权。入口脚本要求调用者显式传入 `expected_database`、`expected_system_id`；不要复制历史回执中的值。

## 文件

- `inspect.sql`：只读检查目标、现有角色、权限和表授权。
- `apply.sql`：单事务创建 `ee.app_credentials`、固定功能角色、功能 scope 和最小 writer/reader 授权。
- `assertions.sql`：apply/verify 共享断言。
- `verify.sql`：只读验证增量完整性。
- `rollback.sql`：安全边界内回退结构和授权；不会删除账号、正文、历史、审计或业务删除结果。
- `target.sql`：目标数据库、cluster、PG18、R2 指纹和 owner 安全闸门。
- `README.md`、`SHA256SUMS`：操作边界和完整性校验。

## 现场执行顺序

所有公司环境操作由用户/DBA现场执行，本项目不通过助手连接公司数据库、SSH 或重启服务。每一步失败都停止，不自行跳过检查或执行 rollback：

```text
1. 校验 SHA256SUMS
2. 在停写窗口执行 inspect.sql，并审核输出
3. 重新确认备份和停写状态
4. 执行 apply.sql
5. 立即执行 verify.sql
6. verify 通过后，再由部署人员配置后端 ro/rw DSN、写入开关和账号管理员 subject
7. 重启/发布应用后进行真实登录、项目权限和功能权限验收
```

每个 psql 入口都应使用 `-X -w -v ON_ERROR_STOP=1`，并显式传入：

```text
-v expected_database=<现场确认的数据库名>
-v expected_system_id=<现场确认的PostgreSQL system_identifier>
```

不要把密码、Argon2id hash、DSN 或安全配置写进仓库、日志或验收回执。

## 数据库行为

- `ee.app_credentials` 只保存登录名和 Argon2id password hash，不保存明文密码。
- 创建账号写入 `ee.app_users`、`ee.app_credentials` 和安全审计；不会写入 `ee.project_members`。
- 项目成员写入/调整固定项目角色；移出项目会停用成员关系并撤销该成员在当前项目的功能级授权。
- 功能授权要求账号先成为当前项目的活跃成员；删除功能级授权后，能力计算回退到项目级角色。
- 账号列表仅由部署配置的全局账号管理员访问；项目权限设置仅由当前项目管理员访问。
- 业务删除仍受现有依赖保护、版本检查和并发检查约束；拥有权限不等于绕过删除规则。
- 所有账号和授权写操作写入 `ee.security_audit_events`；审计 after_state 不包含密码或密码 hash。

## 回退边界

回退前必须停止新应用写入。`rollback.sql` 会在任何结构变更前拒绝以下情况：

- 已存在账号凭据行；
- 已存在功能级授权绑定。

满足安全条件后，回退只删除本包新增的角色、能力定义、表、索引、scope 约束和授权，并恢复本包扩展过的既有读取权限 scope。不会删除用户、项目成员、业务对象、历史版本、审计或已执行的归档删除。

本 README 只记录本地实现和执行包边界，不代表公司数据库已由助手执行或应用已经部署上线。
