# 21 手动功能 / PRD / UC / FR：实现、验收与部署

> 2026-09-23。代码已实现，真实前端→FastAPI→隔离 PostgreSQL 18 链路验收通过。2026-09-24账号改名r2已完成本地隔离验证；公司分阶段指令与证据见22号文档，**不是公司环境上线回执**。未连接公司库、未在公司执行角色改名/授权，未改密码，未执行SSH或既有3000/8000服务的启停命令；冻结R2及旧授权包不改。

## 1. 现在能看到什么

| 需求 | 具体入口 | 创建完成后的状态 |
|---|---|---|
| 共享功能全景 | 任一一级模块→工作空间→点击功能名称 | 复用同一功能全景标签，显示名称和描述；不切换正在浏览的模块 |
| 手动功能 | 工作台顶部右侧“手动新建功能” | 创建真实空功能并打开全景；六模块共用，需求工程UC/FR/FR分配全为空 |
| 手动PRD | 功能全景右上“手动创建 PRD” | 名称必填，成为Markdown H1；打开待处理正文，已有PRD时按钮置灰 |
| 手动UC | **UC全景**顶部右侧“手动新建 UC” | 名称必填，其他选填；必须有当前已接受PRD；打开单个待处理UC详情 |
| 手动FR | **FR全景**顶部右侧“手动新建 FR” | 描述必填，验收标准/来源选填；打开单个待处理FR详情 |

目录行的**名称负责打开，右侧箭头只负责折叠/展开**。功能的身份是项目+功能ID，不是名称；不会按模块复制数据。

PRD使用 react-markdown + remark-gfm 预览、textarea原文编辑、可选实时预览。原始HTML不执行，危险URL使用组件默认净化，远程图片不自动加载。

UC保留原12字段、4个分支、5类异常的合并表格。创建弹窗可填描述、参与者、前置条件、主事件流、后置条件；其余详情中补充。FR来源受控多选，只提供同项目/同功能**当前已接受UC版本**，不会把待审head当成来源。

## 2. 状态与失败处理

1. 创建 → 待处理草稿 → 编辑 → 保存到数据库 → 勾选已审阅 → 显式接受。
2. 保存追加不可变revision，更新head；旧accepted指针保留。编辑已接受对象也必须走新待处理版本。
3. PRD接受须非空正文；UC须名称/描述/主事件流；FR须描述及至少1个合格UC来源。数据库继续执行R2 D06/D07，前端提示不能代替后端校验。
4. 原来源变旧不自动改写。可原样保存草稿，但接受被阻止；UC可明确切至当前已接受PRD，FR须明确重选UC版本。上游有未接受新head时，旧当前接受版本仍可使用。
5. creation_id / mutation_id为每次意图的UUID，未知结果重试原请求，不重复插入。保存必须携带base_revision_id，旧基线返回409而非覆盖。
6. 保存并关闭须写入、同步均成功；失败保留输入和弹窗，提交时锁定重复按钮与关闭。版本冲突时复制本地草稿，取消编辑、刷新并人工核对，不静默合并覆盖。
7. 同步保留其他对象的未保存草稿、标签和项目对话。跨项目异步结果只影响原项目；不会把用户拉回原项目。
8. 已保存对象重新选择项目后可读取；未保存草稿、对话、标签排列仍在内存，不承诺刷新恢复。

## 3. 后端契约与持久化

四个新增接口（统一现有Cookie、Origin白名单、X-Project-Request: 1、JSON）：

| POST路径（前缀 /v1/projects） | 请求要点 |
|---|---|
| /{project_id}/functions | creation_id、name、可选description |
| /{project_id}/functions/{function_id}/artifacts | kind=PRD/UC/FR；creation_id；各类型字段 |
| /{project_id}/artifacts/{artifact_id}/revisions | mutation_id、base_revision_id、content（带kind） |
| /{project_id}/artifacts/{artifact_id}/accept | mutation_id、revision_id |

首次成功201，幂等重放200；返回function_id、artifact_id、revision_id、created。错误包括401认证、403权限/来源、404资源不可见、409冲突/接受条件、415媒体类型、422字段、503配置/数据库不可用、504锁/查询超时；数据库原始错误和凭据不返回浏览器。API/OpenAPI以当前后端为准。

读取沿用workspace，新增capabilities、can_create_function、按功能创建能力、accepted_use_cases、accepted_revision_id与FR acceptance_criteria。不再为无PRD功能构造“测试PRD”。

复用 business_functions、artifacts、artifact_revisions、三类身份/正文表、uc_scenario_items、fr_uc_sources、review_events、security_audit_events 等R2表；无新业务表。FR验收标准放在revision.metadata.acceptance_criteria，本期不修改冻结类型定义。使用事务、稳定幂等标识、PRD单例锁、乐观版本检查，避免只写一半。

## 4. 长期账号管理：两个业务登录，不按功能开户

- `ee_project_api_ro`：25表SELECT普通读取连接。
- `ee_project_api_rw`：既有`ee_project_api_create`原位改名，所有业务共用。写事务内必要SELECT与写入在同一连接，不跨账号拆事务。
- `ee_m0_owner`：既有NOLOGIN对象所有者；应用不用它，DBA审核迁移/授权。
- `project_api_reader`、`project_api_author`是应用表内角色，不是数据库登录。author只有11项已审核能力，按具体项目成员绑定。

rw仅24表SELECT、16表INSERT、head_revision_id列UPDATE及2函数EXECUTE；不是全表CRUD管理员。读写登录的SELECT允许受控交集。未来业务复用账号并走增量授权，不按项目/功能开户。

项目创建需成员表和access_bindings的INSERT，这是可信后端服务边界；不能宣称持有写数据库凭据的人无法改变应用授权。浏览器不得持有凭据。接受操作通过固定`pg_catalog, ee, pg_temp`搜索路径的窄SECURITY DEFINER函数，不给API直接修改accepted指针的权限。

## 5. 账号改名与公司部署

**公司尚未执行本次r2。助手禁止直接访问，由用户运行命令并回传。**

SQL目录：`docs/current/database/manual-work-20260923`；发布归档：`ts-manual-work-20260923-r2.tar.gz`。旧r1留历史，不能用于当前改名后的后端。

完整独立交接、证据、只读检查、备份、改名、绑定、配置、验收与回退见 **22_数据库账号改名与一期迁移交接_20260924.md**。迁移只能通过`apply.sql`入口，不能把001/002/004零散拼接执行。

**纠正昨日说明：不是所有密码格式都能改名后沿用。**迁移只接受有效SCRAM；MD5/未设密/未知格式在改名前停止，不自动改密。只读检查格式，不回传密码/hash。部署人员还需检查pg_hba/连接池/私密DSN中的旧名，数据库改名不自动替换配置文本。

## 6. 2026-09-23历史验收（改名前）；改名后证据见22

- 前端typecheck/build通过，test 126/126通过，lint 0 error（2条既有图片warning）；新增模型测试覆盖空功能、跨模块身份、无假PRD、来源快照、刷新保留草稿、数据库不能误走Mock。
- 新流程后端隔离PG：115 passed、24 skipped；该24项旧数据库套件在20260923-182729的另一隔离实例单独回归24 passed；显式采纳校验、来源变化、旧接受版本保留、只读角色拒绝、并发PRD与并发保存、幂等、事务回滚和最小权限均覆盖。
- 真实浏览器验收：1440×900，前端3107→API8107→隔离PG56429；无公司访问。创建四类对象、Markdown安全预览、UC补齐接受、FR受控来源、深色主题、保存并关闭失败/重试、刷新持久化、认证与文档冒烟通过；pageerror=0。
- 已通过证据：E:/Git projects/TS-backend/artifacts/manual-workflows-20260923/20260923-182404/verification.json；同目录browser/result.json及01—05截图。测试进程由运行器结束，未执行既有3000/8000启停命令；开发模式前端可因代码变更自动重新加载。

重跑：

~~~powershell
# TS-frontend
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# TS-backend（专用隔离PG二进制需已存在，见运行器PG路径）
.\.venv\Scripts\python.exe tests/run_manual_postgres.py
.\.venv\Scripts\python.exe tests/run_manual_postgres.py --legacy
# 可选真实浏览器：设置 PLAYWRIGHT_MODULE_PATH / PLAYWRIGHT_BROWSER_PATH
.\.venv\Scripts\python.exe tests/run_manual_postgres.py --browser
~~~

未包含：真实AI生成PRD/UC/FR、分配写接口、业务删除、历史版本恢复/拒绝/撤销、通用动态metadata表单、跨登录恢复对话。公司上线需完成第5节，不能仅刷新现有页面就认为新接口已部署。
