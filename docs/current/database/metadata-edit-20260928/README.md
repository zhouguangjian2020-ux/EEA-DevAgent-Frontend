# 资料编辑最小增量（2026-09-28，CRUD阶段1）

仅新增项目/功能 name、description、lock_version 列UPDATE授权，以及幂等所需的审计列SELECT；复用现有两服务账号和project_api_author，不新增业务表/账号，不开放删除、归档、角色配置或正文原位更新。updated_at由既有触发器维护。ro仍为只读。

## 边界

本包是阶段1的本地增量材料，不是公司已执行记录。公司操作必须由用户执行，助手只审核只读检查与回执；不得自动连接、SSH或启停服务。冻结旧包保持原样；旧manual-work验证器预期的是旧权限基线，新增列授权后应运行本包verify.sql，不应把旧验证器的基线差异当作新包失败。

## 文件及执行顺序

1. SHA256SUMS：先逐文件验证摘要；任何差异停止。不得修改目标检查以绕过环境限制。
2. inspect.sql：只读检查，指定expected_database与expected_system_id，核对PG18/R2、共享rw账号及旧增量已完成。
3. 另行确认备份与维护条件后，使用同样的明确目标参数执行apply.sql；单事务，版本/动作或授权基线不同则失败，不自动修复漂移。重复apply必须停止，已实施者用verify。
4. verify.sql：只读检查精确列权限、author动作与reader负向权限。应用端仍需开启既有业务写入开关和项目author绑定；不在本包创建新绑定。
5. 先关闭新增写入口/回退应用，再按review后的rollback.sql撤销本包新增权限与动作。存在其他角色依赖时停止，不级联。已修改名称、描述及审计/业务历史全部保留；不声称回退UI能还原旧资料值。

从本包目录使用psql的-X、-v ON_ERROR_STOP=1以及明确的-v expected_database和-v expected_system_id运行；凭据使用既有安全渠道，不写进仓库、文档、进程输出或完整DSN。入口通过相对include读取target.sql/assertions.sql，须完整保留本目录。公司执行前等待用户提供只读检查结果；本轮不提供可直接命中公司库的命令。

## 本地验证入口

仅在已配置仓库虚拟环境及临时PG18二进制的工作站运行后端tests/run_manual_postgres.py --metadata；附加--browser运行原手动流程与阶段1浏览器验收。脚本创建独立127.0.0.1数据库，拒绝公司集群ID，密码随机且不输出，并在finally停止其自己创建的数据库和服务。结果以当次artifacts/metadata-edit-20260928下的verification.json和日志为准，不能引用历史通过代替重跑。
