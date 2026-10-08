# agent-workflows-r1 独立数据库增量

用途：私有多会话聊天表；分配写入/确认最小权限与函数。复用原ro/rw登录，不新增业务账号，不自动迁移。

## 前提
- 已完成R2、writer rename、metadata、deletion与permission-admin增量，使用受审DBA身份。
- 公司操作由用户执行；必须先备份、读当前版本、核对目标数据库和集群标识。本文不填公司密码/DSN。
- apply.sql要求 `expected_database` 与 `expected_system_id`，错误目标/重复建表会失败并事务回滚。绝不单跑001片段。

## 顺序
```bash
sha256sum -c SHA256SUMS
# 在已配置PGHOST/PGPORT/PGUSER/PGDATABASE的安全DBA终端交互输入密码
psql -X -W -v ON_ERROR_STOP=1 -v expected_database=目标库名 -v expected_system_id=已核验集群标识 -f apply.sql
psql -X -W -v ON_ERROR_STOP=1 -v expected_database=目标库名 -v expected_system_id=已核验集群标识 -f verify.sql
```

如指定项目还没有子系统目录，另行审批后执行init-project-presets.sql，并显式传 `target_project_id` 与 `actor_subject`。它只给该项目初始化7项预置目录，已存在/部分存在目录就拒绝，不改既有目录；必须人工确认预置目录适合项目，不是AI自动建目录。

ro仅SELECT；rw新表INSERT及必要字段UPDATE，无DELETE；既有分配表INSERT及窄确认函数。目录只额外授予lock_version列UPDATE以允许SELECT FOR SHARE行锁，不授予名称或current_version_id修改。仅project_api_author与既有function_editor增加分配create/update/accept；reader不扩权。后端项目创建白名单已配套接受这组精确权限，不能仅迁移数据库而不更新后端。

## 回滚
应用回滚优先保留增量表。rollback-empty-only.sql只允许聊天表无数据、没有新分配写入、没有后续其他角色新增授权时回退，不会清除聊天/业务历史。已有数据时明确拒绝：回退应用，保留数据库，另行审查迁移。预置目录不自动删除，特别是已被分配引用时。

## 部署边界
后端代码、前端构建和联调台代码需同批评审。不覆盖已发r7归档。公司前端构建仍遵守《公司前端发布必读》与已验证network=host/pull=false，不因网络失败停原服务或改DNS。现有7000/7100与7018/7200未由本次开发重启。聊天写开关与Origin配置需管理员显式确认，不在脚本中自动开放。

## 联合基线验证

verify.sql包含combined-baseline.sql，保留旧deletion的历史不可变/活动PRD唯一性保护，精确合并账号权限与本增量授权。旧冻结断言未改，也不将允许列表放宽为任意权限；临时数据库已验证误目标/直接片段/重复迁移拒绝，空库回退/重做、后续授权与有数据回退保护、预置目录重复拒绝。最终证据见47号联合交付记录。
