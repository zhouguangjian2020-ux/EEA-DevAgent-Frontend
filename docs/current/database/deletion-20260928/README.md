# CRUD阶段2：单对象逻辑删除与活动PRD唯一性

本包仅用于已完成R2、共享writer改名/manual-work和metadata-edit-20260928的数据库。公司操作由用户另行执行；助手不连接公司环境。先检查目标、维护窗口、备份及现有包SHA256；停止业务写入后再应用。此包不含批量删除、恢复、回收站、权限管理或分配重新创建。

## 执行与目标保护

所有入口必须显式传入expected_database和expected_system_id；要求PG18及已审核R2指纹、低权限ro/rw和阶段1精确授权基线。先执行inspect.sql并审核输出，之后apply.sql、verify.sql。psql使用-X和ON_ERROR_STOP，目标变量由当前实际检查结果提供，不复制公司旧回执。脚本包含相对\ir，必须保留本包及相邻metadata-edit-20260928目录结构。不得修改旧包来绕过检查。

- 同一事务移除prds_uq_0及旧全历史PRD索引，建立archived_at IS NULL条件的唯一索引。具体PRD身份/历史外键保持；新对象新ID，旧对象及其历史不变。
- rw仅追加projects/business_functions/artifacts的archived_at列UPDATE；项目/功能版本沿用阶段1，artifact版本沿用原有触发器。没有DELETE/TRUNCATE或历史更新授权，ro保持只读。
- 内部复用既有archive动作枚举：project/function/prd/uc/fr/fr_allocation.archive，只绑定现有project_api_author。对外仍叫删除，不提供恢复。
- 已有受控确认函数增加项目→功能→对象锁和祖先/直接上游有效性检查；保留精确owner/search_path及非PUBLIC执行权限。
- apply拒绝重复或漂移基线；verify可重复。所有业务正文、修订、来源、目录与审计均保留。

## API配套与部署顺序

新代码必须在本包及阶段1授权齐全后启用删除；旧实例不自动迁移。GET .../deletion-impact为只读预检查；DELETE同资源路径使用mutation_id和base_lock_version查询参数，不接受请求体、cascade或force。Cookie、允许的Origin、X-Project-Request:1、Content-Type:application/json仍必需。提交时重新授权、锁定、检查依赖、版本，再写归档和审计，同一事务生效。每次未知结果重试使用同一操作ID。

## 回退

先停止新写入，再执行rollback.sql。仅当每个功能全历史仍最多一份PRD时才能恢复旧唯一约束；如已经存在多个历史PRD身份，脚本会在任何变更前拒绝，必须保留新结构或继续向前修复，绝不能删除历史强行回退。

回退不取消已经执行的业务删除，不恢复归档状态，不删除正文/引用/审计；只回退本增量约束、列授权、角色动作和受控确认函数。其他角色新绑定这些动作时拒绝回退。回退阶段1授权前必须先合法回退阶段2；直接运行冻结metadata包断言在本阶段扩权后会拒绝，不能改旧断言。

阶段2测试和用户验收仍须独立记录；本说明不表示公司已部署。
