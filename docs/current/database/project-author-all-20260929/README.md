# 全部现有项目的项目管理员绑定包（2026-09-29）

本包用于在权限管理增量已完成后，将一个**已经是全部现有项目活跃成员**的账号统一绑定为 `project_api_author`。

本次确认 subject：`engineer01`。

## 设计边界

- 所有项目共享同一套 CRUD 能力定义，不需要逐项目“启用功能”。
- 项目级 `project_api_author` 绑定会继承到该项目下的所有功能。
- 本包只调整已有项目中的角色绑定，不新增项目成员资格。
- 如果任何未归档项目没有指定 subject 的活跃成员资格，本包会停止并回滚，不会自动扩展成员范围。
- 如果发现已有非 `project_api_reader` / `project_api_author` 的项目角色，本包会停止并回滚，不覆盖人工配置。
- 每次角色变更写入 `ee.security_audit_events`，不写入密码、密码哈希或 DSN。
- `engineer01` 作为全局账号管理员通过后端 `ACCOUNT_ADMIN_SUBJECTS=engineer01` 配置，不在本包中伪造全局管理员数据库角色。

## 文件

- `inspect.sql`：只读列出指定 subject 在全部未归档项目中的成员和角色状态。
- `apply.sql`：单事务把全部未归档项目中的指定 subject 绑定为 `project_api_author`。
- `verify.sql`：只读确认指定 subject 已在每个未归档项目中具备活跃成员资格和 author 角色。
- `target.sql`：复用已审核的数据库目标保护。
- `SHA256SUMS`：文件完整性清单。

## 执行要求

必须显式传入：

```text
-v expected_database=ee_platform
-v expected_system_id=7686454253092706426
-v expected_subject=engineer01
```

先执行 `inspect.sql` 并审核输出，再执行 `apply.sql`，最后立即执行 `verify.sql`。任一步失败都停止，不自行 rollback。

本包不修改 `25_工作交接_项目功能PRD_UC_FR_CRUD_20260928.md`。