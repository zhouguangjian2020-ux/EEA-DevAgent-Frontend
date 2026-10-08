# 一期数据库增量 r2：共享写账号改名与手动需求维护

更新：2026-09-24。将既有`ee_project_api_create`原位改名为`ee_project_api_rw`，不新建/并存第二个写账号。本包由用户/DBA审核运行，助手不得直接连接公司库。

## 权限与范围

- `ee_project_api_ro`：25张业务表SELECT；无表/列写入、业务函数执行、持久化schema DDL、角色成员关系或转授权。
- `ee_project_api_rw`：24表SELECT、16表INSERT，仅`artifacts.head_revision_id`列UPDATE；执行`controlled_import()`、`accept_manual_revision(...)`。无DELETE/TRUNCATE/任意列UPDATE/业务schema CREATE。
- `ee_m0_owner`：既有NOLOGIN对象所有者，应用不用它登录。已有管理员postgres不是新增业务账号。
- `project_api_reader`、`project_api_author`是表内应用角色，不是PG账号。author仅11项能力：project.read、function.create、prd/uc/fr各自create/update/accept。既有项目不自动升级。
- 无新业务表，不导入/重建样本，不修改冻结R2及旧授权包。普通查询走ro；写事务中的必要SELECT与写入在同一rw连接完成。
- 项目创建仍需`project_members`、`access_bindings`的INSERT：不能声称持有数据库写凭据的人无法改变应用授权。该凭据只存在于可信后端，最终用户授权由API按项目/成员/动作验证；不要发给用户或前端。
- 本包不改变既有PUBLIC TEMP策略；“无DDL”指无持久化业务schema结构修改权限。rw不是全表全列CRUD管理员，后续操作复用这个账号并追加审核授权，不按功能/项目开户。

## 改名前提及失败策略

1. 显式指定的PG18库/集群，已部署准确指纹的R2 schema及安全NOLOGIN owner。
2. 旧名存在、新名不存在；旧账号必须仍是8表SELECT/5表INSERT基线。异常属性、成员关系、表列/函数/序列权限、转授权、缺失权限或超时配置漂移都停止，不自动修复。
3. **旧凭据必须为未过期SCRAM。MD5密码会在角色改名时被PostgreSQL清除**，故本包在ALTER ROLE之前拒绝MD5、未设密与未知格式。若遇MD5，停止并另行确认凭据迁移，不自动改密。检查只输出是否设密和格式，不输出密码/hash。
4. 改名为集群级操作。另需核查pg_hba.conf、连接池/启动配置中的旧名文本；本包拒绝其他库对象依赖和仍连接的写账号会话，不杀会话。
5. `apply.sql`是唯一写入口：目标核对→ro验证→改名/增量授权/窄函数/author角色→rw与ro复验→提交。服务器内部比较OID及SCRAM verifier未变，不返回verifier。失败整笔回滚。
6. 一次性apply重跑会安全拒绝。结果不确定时先verify，不重建账号、不重跑旧开户包。项目绑定可重跑，不重复写授权审计。
7. `BUSINESS_WRITES_ENABLED=false`只关闭新增手动业务，不等于停掉项目创建；维护窗口应停写并排空全部旧写连接。备份可能要求整个业务库没有客户端连接，按维护窗口执行。

## 文件

|文件|用途|
|---|---|
|000_inspect.sql|只读目标/角色/密码格式/权限/跨库依赖/连接/业务角色检查|
|apply.sql|唯一改名与授权事务入口|
|001_business_writer.sql|内部迁移片段，不能单独执行|
|002_verify.sql|内部写账号/函数/author能力校验|
|003_bind_project.sql|显式项目与既有活跃成员的author绑定，独立事务|
|004_verify_reader.sql|内部ro表/列/函数/DDL/应用reader角色验证|
|005_target.sql|内部目标库/实例/PG版本/schema指纹/owner核对|
|verify.sql|只读复验入口|
|render_sql.py|校验整个包并展开受控include后一次性输出；本身不连接数据库|

不要为postgres放宽用户家目录权限。由用户进程运行render_sql，通过stdin交给sudo后的psql；渲染失败不输出部分SQL，配合pipefail与ON_ERROR_STOP。包内脚本修改后必须重新审核/打包，不能绕过SHA256错误。

## 公司步骤：先只读，回传后再继续

完整交接/分步命令见前端`docs/current/22_数据库账号改名与一期迁移交接_20260924.md`。以下在Ubuntu解包目录运行，目标信息取自既有部署记录；若现场不符，停止回传，不猜测改值。

```bash
set -euo pipefail
sha256sum -c SHA256SUMS
sudo -v
python3 render_sql.py 000_inspect.sql | sudo -n -u postgres /usr/lib/postgresql/18/bin/psql \
  -X -w -h /var/run/postgresql -p 5432 -U postgres -d ee_platform \
  -v ON_ERROR_STOP=1 -v expected_database=ee_platform -v expected_system_id=7686454253092706426 -f -
```

**先到这里停止并回传输出，不贴密码、DSN或私密配置。**

只有检查已审核、停写排空、备份回执与不含密码的角色快照都确认后，才运行：

```bash
set -euo pipefail
sudo -v
python3 render_sql.py apply.sql | sudo -n -u postgres /usr/lib/postgresql/18/bin/psql \
  -X -w -h /var/run/postgresql -p 5432 -U postgres -d ee_platform \
  -v ON_ERROR_STOP=1 -v expected_database=ee_platform -v expected_system_id=7686454253092706426 -f -
python3 render_sql.py verify.sql | sudo -n -u postgres /usr/lib/postgresql/18/bin/psql \
  -X -w -h /var/run/postgresql -p 5432 -U postgres -d ee_platform \
  -v ON_ERROR_STOP=1 -v expected_database=ee_platform -v expected_system_id=7686454253092706426 -f -
```

再单独确认项目UUID/成员subject，传`-v project_id='<UUID>' -v subject='<subject>'`运行003_bind_project入口；不批量升级。以上入口自带事务，不额外加`--single-transaction`。

成功后后端写DSN用户名改为rw（有效SCRAM前提下沿用原密码）、读DSN仍ro。同步检查pg_hba/连接池/密码管理条目中的旧名。配置与代码一起切换，准备验收前保持`BUSINESS_WRITES_ENABLED=false`，前端真实模式`NEXT_PUBLIC_USE_MOCKS=false`。凭据不得进入NEXT_PUBLIC、仓库或聊天。

## 回退与信任边界

- 事务失败：改名与授权全部回滚，先读日志，不另建账号。
- 已提交后验收失败：停写并保留业务数据/历史，不DROP账号/表，不重跑旧包。确需回退角色名/授权时，由DBA依据快照独立审核并同步代码/DSN；不能只部署硬编码旧名的旧后端。
- 本包只校验数据库内前提，不检查磁盘备份回执；执行者必须先审核备份。备份归档可列出不代表做过恢复演练。
- 已通过本地隔离PG18、权限负向、真实密码认证及浏览器链路；公司执行回执仍待用户提供，本地PASS不等于公司上线。

密码/函数安全规则核对来源：`https://www.postgresql.org/docs/18/sql-alterrole.html`、`https://www.postgresql.org/docs/18/sql-createfunction.html`。
