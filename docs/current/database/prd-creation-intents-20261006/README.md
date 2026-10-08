# PRD创建意图增量（仅本地隔离验证，非公司发布包）

- 新增一张 `ee.prd_creation_intents`，记录本人/项目/请求、可信plan、用户选择、稳定对象ID、租约和回执。不代替聊天任务表。
- 不修改原业务表、不迁移旧数据、不创建通用工作流。reader仅SELECT，writer仅INSERT及指定状态字段UPDATE，无DELETE/改owner/改prompt权限。
- 所有操作绑定project锁；当前应用自动创建、手动创建、改名使用统一规范化同名检查。历史重复名称不重命名；DBA绕过应用直写不受应用锁保护，不声称Unicode名称已有全库唯一索引。
- 仅允许127.0.0.1:56429、ee_manual_*且非公司cluster。公司发布前必须独立审核、取得本地用户验收并另发受控材料。本目录不能拿到公司直接执行。
- apply事务内建表；verify只读；rollback仅允许空表，存在任何意图记录即拒绝，保留恢复回执及业务数据。重复apply拒绝。
- 测试入口：TS-backend/tests/run_manual_postgres.py --prd-creation-focused；只创建新的一次性库，不迁移原有本地预览。

- verify保留旧删除/权限/workflow的逐列权限断言，仅新增意图表的12个允许UPDATE列。冻结workflows-r1校验器预期无此新表，不拿它在增量后运行；不削弱或修改其原文件。apply在创建表之前仍复核冻结组合基线。
