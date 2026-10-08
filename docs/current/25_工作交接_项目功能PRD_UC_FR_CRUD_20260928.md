# 工作交接：项目 / 功能 / PRD / UC / FR CRUD

> 更新时间：2026-09-28（Asia/Shanghai）  
> 交接目的：供新的 Codex 对话继续当前工程工作，避免重复阅读和重复盘点。  
> 当前阶段：**阶段1已获用户验收通过；阶段2删除后端/约束实现及本地验证完成，等待用户验收。总验收1/5（20%）；阶段3—5未开始，不自动继续。**

---

## 1. 当前用户目标

用户希望继续完成以下对象的前端、后端和数据库交互：

- 项目 CRUD
- 功能 CRUD
- PRD CRUD
- UC CRUD
- FR CRUD
- 本轮追加FR分配删除及无FR关联子系统节点隐藏；不扩展成完整FR分配CRUD。

用户要求先核对已有实现，再为缺失部分设计按钮和操作逻辑；确认方案后才能开始写代码。

当前最新交接点：用户已明确“验收通过，开始开发下一部分功能”，阶段1通过并授权阶段2。阶段2单对象删除、真实依赖检查、并发/幂等/审计事务、PRD删除后新ID创建及最小独立SQL已完成本地实现与验证，见[28 阶段2删除后端与PRD新建](<E:/Git projects/TS-frontend/docs/current/28_CRUD阶段2_删除后端与PRD新建_20260928.md>)。**现在停止等待阶段2验收；前端删除入口和多选未开发，未访问公司数据库/SSH、未执行公司部署，旧36份SQL未改。**

当前任务不是重新实现已有的手动创建、读取、PRD/UC/FR正文编辑功能，而是补齐真实缺口并保持已有版本机制、权限边界和交互规则。

---

## 2. 工程位置与必须遵守的边界

### 2.1 工程路径

- 前端：`E:\Git projects\TS-frontend`
- 后端：`E:\Git projects\TS-backend`
- 当前文档：`E:\Git projects\TS-frontend\docs\current`
- 本交接文件：`E:\Git projects\TS-frontend\docs\current\25_工作交接_项目功能PRD_UC_FR_CRUD_20260928.md`

### 2.2 用户已经明确的工作边界

1. **先给详细方案，澄清真正会影响实现的问题，得到确认后再写代码。**
2. 不直接访问公司数据库、公司服务器或SSH；需要公司操作时，提供经过审核的命令，由用户执行并回传结果。
3. 不读取、输出或提交密码、Agent Key、完整DSN和私密 `.env` 内容。
4. 不修改冻结数据库包、历史发布包或已执行的账号改名包。
5. 区分：
   - 本地源码已经存在；
   - 隔离数据库/浏览器已经验证；
   - 公司环境已经部署并验收。
6. 不为了一个业务功能创建一个新的PostgreSQL服务账号。
7. 不过度设计，不重复实现已有CRUD，不擅自增加独立后台、消息队列或工作流引擎。
8. 已确认的产品文案：
   - 内容主动作叫 **“确认”**；
   - 保存按钮叫 **“保存草稿”**；
   - 内部 `accept`、`accepted`、`accepted_revision_id` 和既有 `/accept` 路径暂不改名。

---

## 3. 已有文档：新对话建议按此顺序阅读

1. `E:\Git projects\TS-frontend\docs\current\25_工作交接_项目功能PRD_UC_FR_CRUD_20260928.md`
2. `E:\Git projects\TS-frontend\docs\current\README.md`
3. `E:\Git projects\TS-frontend\docs\current\02_前端交互规范.md`
4. `E:\Git projects\TS-frontend\docs\current\21_手动功能PRD_UC_FR实现与部署.md`
5. `E:\Git projects\TS-frontend\docs\current\22_数据库账号改名与一期迁移交接_20260924.md`
6. `E:\Git projects\TS-frontend\docs\current\23_待实现功能列表.md`
7. `E:\Git projects\TS-frontend\docs\current\24_项目功能PRD_UC_FR_CRUD盘点与交互设计.md`
8. `E:\Git projects\TS-frontend\docs\current\06_工程维护与验证记录.md`
9. `E:\Git projects\TS-frontend\docs\current\26_CRUD分阶段实施与验收进度_20260928.md`
10. `E:\Git projects\TS-frontend\docs\current\27_CRUD阶段1_资料编辑实现与验收_20260928.md`
11. `E:\Git projects\TS-frontend\docs\current\28_CRUD阶段2_删除后端与PRD新建_20260928.md`

说明：

- `23_待实现功能列表.md` 已登记P-001项目权限设置、P-002八场景Agent链路，并新增P-003 CRUD补全。
- `24_项目功能PRD_UC_FR_CRUD盘点与交互设计.md` 是本轮CRUD盘点和按钮/删除方案的主体文档。
- `06_工程维护与验证记录.md` 保留前期盘点和阶段1历史，并追加阶段2本轮实际验证。
- `26_CRUD分阶段实施与验收进度_20260928.md` 是阶段状态和停止闸口；27号是阶段1历史交付，28号是阶段2本轮交付与真实证据，不把历史测试当成本轮通过。

---

## 4. 当前CRUD盘点结论

| 对象 | 创建 C | 读取 R | 修改 U | 删除 D |
|---|---|---|---|---|
| 项目 | **已实现**：切换项目弹窗“＋新增项目”，真实落库 | **已实现**：项目列表、项目详情、workspace及资料面板 | **阶段1已验收**：名称/简介编辑及PATCH | **阶段2后端已实现**：非空禁止删除，前端入口待阶段3 |
| 功能 | **已实现**：工作台“手动新建功能”，创建真实空功能 | **已实现**：共享功能树、功能全景 | **阶段1已本地实现**：已有标签顶部名称/描述原位编辑及PATCH | **阶段2后端已实现**，前端入口待阶段3 |
| PRD | **已实现**：功能全景“手动创建PRD”，一功能一个PRD | **已实现**：workspace、Markdown预览/原文 | **已实现**：正文编辑、保存新修订、确认 | **阶段2后端已实现**，前端入口待阶段3 |
| UC | **已实现**：UC全景“手动新建UC” | **已实现**：workspace、UC全景、UC详情 | **已实现**：12字段编辑、保存新修订、确认 | **阶段2后端已实现**，前端入口待阶段3 |
| FR | **已实现**：FR全景“手动新建FR” | **已实现**：workspace、FR全景、FR详情 | **已实现**：描述、验收标准、来源编辑、保存新修订、确认 | **阶段2后端已实现**，前端入口待阶段3 |

### 4.1 重要区分

- 关闭标签页不等于删除数据库对象。
- 取消编辑不等于删除已保存对象。
- Mock模式的“放弃”不等于真实数据库删除。
- PRD/UC/FR的更新采用**追加不可变修订**，不是覆盖历史正文。
- 保存草稿和确认是两个动作；保存不会自动确认。
- 没有五套独立详情GET，不代表R未实现；workspace聚合接口已经返回对象数据。
- 当前CRUD任务不等于已经实现八个Agent生成场景，也不等于FR分配写入和子系统图链路已经完成。

---

## 5. 已核实的后端接口

### 5.1 当前已有路由

后端路由文件：

- `E:\Git projects\TS-backend\app\api\routes\projects.py`
- `E:\Git projects\TS-backend\app\api\routes\manual_work.py`

已有接口：

```text
GET  /v1/projects
GET  /v1/projects/{project_id}
GET  /v1/projects/{project_id}/workspace
POST /v1/projects
PATCH /v1/projects/{project_id}

POST /v1/projects/{project_id}/functions
PATCH /v1/projects/{project_id}/functions/{function_id}
POST /v1/projects/{project_id}/functions/{function_id}/artifacts
POST /v1/projects/{project_id}/artifacts/{artifact_id}/revisions
POST /v1/projects/{project_id}/artifacts/{artifact_id}/accept

GET /v1/projects/{project_id}/deletion-impact
GET /v1/projects/{project_id}/functions/{function_id}/deletion-impact
GET /v1/projects/{project_id}/artifacts/{artifact_id}/deletion-impact
DELETE /v1/projects/{project_id}
DELETE /v1/projects/{project_id}/functions/{function_id}
DELETE /v1/projects/{project_id}/artifacts/{artifact_id}
```

说明：

- `/artifacts` 通过 `kind=PRD|UC|FR` 区分对象类型。
- 创建使用 `creation_id` 幂等。
- 保存修订使用 `mutation_id` 和 `base_revision_id`。
- 确认使用 `revision_id`，后端会重新校验当前head、权限、最低内容和直接上游版本。
- 阶段1两个资料PATCH使用UUIDv4的mutation_id和字符串base_lock_version；只允许更新name/description，未传字段保持原值。返回最新资料、版本与can_update能力。
- 阶段2新增3类GET deletion-impact与对应DELETE，覆盖项目/功能/PRD/UC/FR/FR分配；mutation_id和字符串base_lock_version放查询参数，无请求体。没有批量、恢复或永久清空接口。

### 5.2 关键后端文件

- `E:\Git projects\TS-backend\app\api\routes\deletion.py`、`E:/Git projects/TS-backend/app/services/deletion.py`、`E:/Git projects/TS-backend/app/schemas/deletion.py`：单对象删除/只读预检查/依赖检查与幂等审计事务。
- `E:\Git projects\TS-backend\app\services\resource_locks.py`：创建/保存/确认/删除共用项目→功能锁。

- `E:\Git projects\TS-backend\app\services\manual_work.py`
  - 创建功能、创建PRD/UC/FR、保存修订、确认修订。
- `E:\Git projects\TS-backend\app\services\projects.py`
  - 项目读取及资料编辑能力。
- `E:\Git projects\TS-backend\app\services\metadata_edit.py`
  - 项目/功能资料更新、项目→功能锁定、版本校验、同事务审计与幂等重放。
- `E:\Git projects\TS-backend\app\schemas\metadata_edit.py`
  - 资料更新字段、版本与操作标识校验。
- `E:\Git projects\TS-backend\app\services\project_workspace.py`
  - workspace聚合读取。
- `E:\Git projects\TS-backend\app\services\business_access.py`
  - 当前主要是项目级capability查询和授权校验。
- `E:\Git projects\TS-backend\app\core\project_write_database.py`
  - 写数据库连接配置入口。

---

## 6. 当前前端入口与缺口

### 6.1 项目

主要文件：

- `E:\Git projects\TS-frontend\src\components\projects\project-dialog.tsx`
- `E:\Git projects\TS-frontend\src\components\projects\project-info.tsx`

已有：

- “切换项目”弹窗、“＋新增项目”和“创建并进入”。
- 阶段1新增行尾独立“⋯ → 查看项目信息 → 编辑项目信息”；名称/简介可编辑、编号只读。
- 项目简介复用description；编辑非当前项目不切换当前项目；保存当前项目后同步列表/顶栏。
- 版本冲突、保存结果不确定、保存成功但刷新失败分别处理；不会因同步重试重复写入。

缺失：项目删除前端入口，留待阶段3；阶段2后端已实现非空禁止删除和空项目逻辑删除，不做恢复。

### 6.2 功能

主要文件：

- `E:\Git projects\TS-frontend\src\components\workbench\object-workbench.tsx`
- `E:\Git projects\TS-frontend\src\components\workbench\feature-overview.tsx`
- `E:\Git projects\TS-frontend\src\features\workbench\feature-metadata.ts`

已有：

- 工作台“手动新建功能”、功能全景“手动创建PRD”。
- 功能身份以function_id为准，在六个一级工作空间共享；名称打开、箭头只展开/折叠。
- 阶段1已在已有功能标签顶部原位编辑名称/描述；编号只读，取消/保存/重新读取可用，不另开编辑弹窗。
- 草稿按项目/功能隔离；未保存关闭保护；“保存并关闭”真正成功后才关闭，失败保留。
- 保存后名称跨树/标签/上下文同步；PRD历史正文、其他草稿和项目对话不变；旧读取响应不覆盖新资料。

缺失：侧栏菜单和单条/多选删除前端接线，分别留待阶段3/4。影响检查与单条删除后端已在阶段2完成；不做恢复。

### 6.3 PRD、UC、FR

主要文件：

- `E:\Git projects\TS-frontend\src\components\prd\prd-workspace.tsx`
- `E:\Git projects\TS-frontend\src\components\uc\uc-workspace.tsx`
- `E:\Git projects\TS-frontend\src\components\fr\fr-workspace.tsx`
- `E:\Git projects\TS-frontend\src\components\workbench\database-review.tsx`
- `E:\Git projects\TS-frontend\src\features\workbench\manual-api.ts`
- `E:\Git projects\TS-frontend\src\features\workbench\use-workbench-store.ts`

已有：

- 创建入口已存在，不应重复加第二套创建按钮。
- PRD支持Markdown原文和预览编辑。
- UC保留12个顶层字段、4个分支、5类异常事件流。
- FR支持描述、验收标准和受控UC来源选择。
- 编辑、保存新修订、确认有真实数据库模式接线。
- 阶段1已统一界面动作“确认”“保存草稿”和相关状态提示；内部accept/accepted不改，保存不自动确认。

缺失：

- 三类对象工作空间侧边栏行的“删除”菜单；详情不再重复放删除入口。
- 删除影响查询和单对象删除接口已在阶段2完成，前端接线尚缺；含FR分配删除，不做恢复接口。

---

## 7. 数据库事实与安全边界

### 7.1 数据库结构事实

冻结结构文件：

`E:\Git projects\TS-frontend\docs\current\database\m0-20260921-r2\001_m0_schema.sql`

已经核实：

- `projects`、`business_functions`、`artifacts` 都有 `archived_at` 和 `lock_version`。
- PRD/UC/FR身份和历史由 `artifacts`、各类型表和revision表组成。
- 冻结R2旧基线存在全历史PRD索引和prds的功能唯一约束。阶段2独立deletion-20260928包已移除后者并把前者改为只约束未删除PRD，后端创建同步调整；不修改R2原文件。未执行新包的实例仍保持旧结构。
- `artifact_revisions`、PRD/UC/FR版本正文和来源等历史表有不可变保护触发器。
- 阶段2通过archived_at退出活动集合，保留历史和确认指针；普通读取仍过滤已删除对象，无恢复流程。
- 阶段2已统一父项目/功能有效性检查与项目写锁，创建/保存/确认/删除均防止写入已删除祖先或来源，不只隐藏左侧树。

### 7.2 PostgreSQL服务账号

当前长期设计是两个共享服务登录，不按项目或功能开账号：

- `ee_project_api_ro`：只读，约25张业务表SELECT权限。
- `ee_project_api_rw`：原 `ee_project_api_create` 原位改名后的共享写账号；具有限制性的SELECT/INSERT、指定列UPDATE和受控确认函数权限。

当前rw不是全库CRUD账号，没有通用DELETE、没有任意项目/功能UPDATE。阶段1独立[metadata-edit-20260928包](<E:/Git projects/TS-frontend/docs/current/database/metadata-edit-20260928/README.md>)已在隔离库验证，仅补name/description/lock_version列UPDATE、幂等所需审计列SELECT，以及既有author的project.update/function.update动作；公司未执行。后续CRUD继续：

- 复用ro/rw；
- 只增加经过审核的最小列权限或受控函数权限；
- 不把ro扩权为写；
- 不新建“每个功能一个账号”；
- 不修改冻结R2包。

### 7.3 公司环境最后已知状态

以 `22_数据库账号改名与一期迁移交接_20260924.md` 的最后记录为准：

- 公司账号原位改名和一期授权回执已通过。
- `ee_project_api_create` 已改为 `ee_project_api_rw`。
- 旧账号OID和SCRAM verifier保留，`ee_project_api_ro`保持只读。
- **当时仍未完成或未确认：**指定项目author绑定、后端新DSN配置部署、公司端到端业务验收。
- 新对话继续时，不应把这份历史回执自动当作2026-09-28公司当前状态；需要公司操作时仍由用户执行只读检查。

---

## 8. 已登记的CRUD交互方案

完整方案见：

`E:\Git projects\TS-frontend\docs\current\24_项目功能PRD_UC_FR_CRUD盘点与交互设计.md`

核心设计如下：

### 8.1 项目

在现有项目切换弹窗每行最右侧增加“⋯”：

- 查看项目信息。
- 编辑项目信息。
- 删除项目（已确认非空禁止删除，后续阶段实施；阶段1未开放）。

阶段1已实现：名称必填、项目简介选填（最多2000字符）、编号只读；简介复用ee.projects.description，创建表单统一叫“项目简介”，没有新加同义字段。项目行“⋯ → 查看项目信息”进入资料面板后编辑，按钮叫“保存修改”；打开菜单或编辑资料不选中/切换项目，修改当前项目同步顶栏。失败保留输入，409须显式重新读取；阶段1已获用户验收通过。

### 8.2 功能资料：已有标签顶部原位编辑

用户2026-09-28进一步明确：沿用已有功能全景标签，在最上面的名称/描述资料区启用编辑模式；不另开功能编辑弹窗。

- 查看时显示名称/描述及编辑入口；编辑时单行名称、多行描述，操作为取消编辑/保存修改。
- 同一project_id + function_id只保留一个标签，成功后同步所有一级工作空间，不改PRD历史正文。
- 本地草稿按功能隔离，切换保留，关闭未保存标签有既有保护；失败保留输入。
- 阶段1FeatureOverview原位编辑已接线；保存成功后以稳定功能ID同步六模块树、标签及上下文，保留无关草稿/对话，旧workspace晚响应不回退更高版本资料。实现与验收见27号。

### 8.3 功能/PRD/UC/FR/FR分配：删除移到侧栏

用户指定五类删除都从工作空间侧边栏发起；详情保持编辑/确认/保存草稿等内容操作，不另放重复删除按钮。项目删除仍在项目切换入口设计范围，不移进对象树。

24号3.7已登记用户确认的单条+多选删除设计，尚未编码：

- 保留真实对象行尾独立“⋯”，增加侧栏“多选删除”模式与已选计数/删除操作栏；删除选择独立于AI附件，不能混用。名称打开、箭头折叠，不互相串触发。
- 功能行删除同一个共享功能；PRD/UC/FR行删除对应artifact_id；UC/FR/FR分配分类不可删除。
- FR分配按子系统分组显示真实分配行；多子系统位置共享allocation_id，菜单明确删除该FR的全部分配，确认框列全部目标，不仅解除当前一条关联。
- 真实零目标分配放在“未选择子系统”虚拟组，避免被空子系统隐藏规则藏掉；无分配对象的FR不制造假行。
- 分配行定位已有分配全景，不新建子系统或单分配详情；子系统组不能删除。成功后同步所有导航位置和空子系统隐藏，保留FR正文及全景。
- 当前前端映射未保留单个分配ID，实施需补足真实身份/版本，不用FR或子系统ID冒充。

功能规则已随删除设计确认：存在未选中的有效内容时阻止整批；全部内容明确选中且能合法清理后，在一次事务末尾删除功能。单选功能须为空，不隐式级联或整体隐藏。批次外下游阻止，批次内按分配→FR→UC→PRD→功能处理，一次确认、整批成功或整批不删。

### 8.4 已确认的精简删除规则

1. PRD有关联未删除UC时禁止删除；UC被未删除FR引用时禁止删除。
2. FR存在未删除分配对象时禁止删除，包括空分配，不只检查子系统数量。
3. 当前可删除FR分配，不要求先取消确认；不因此删除FR或子系统目录，仍保留既有认证、读写授权与事务检查。
4. 已删除下游不再阻挡上游；检查未删除下游当前工作版及当前确认版，草稿同样覆盖，仅更早历史引用不阻止。不自动级联，不改写历史来源。
5. 底层保留历史，业务删除不恢复原对象；不做回收站、已删除列表、restore接口或永久清空。
6. 一功能最多一份未删除PRD；删后可创建新ID，不复用/恢复旧对象，不复制旧正文或确认状态。
7. 工作空间子系统节点在当前项目/功能无任何有效FR关联时隐藏；其他FR仍关联则保留，后续重新关联再显示。项目子系统目录和UC/FR/FR分配固定分类不删除。
8. 项目非空时禁止删除；先清理功能及其活动业务内容，再单独删除空项目，不做项目隐式级联。

## 9. 2026-09-28用户确认与当前停点

用户已批准空分配阻止、空子系统节点隐藏、PRD删后新ID不恢复，以及“依赖阻止删除+保留历史但不做恢复”的精简方案；权限管理暂缓，保留既有项目级读写保护，不新增仅创建人操作限制。

本轮剩余两项也已逐条批注“同意”：

- Q-01：非空项目禁止删除，先清理功能及其活动业务内容，再单独删除空项目；不做项目隐式级联。
- Q-02：检查未删除下游的当前工作版和当前确认版；仅更早历史引用不阻止删除，历史记录和来源仍保留。

**不要重复询问已确认规则，不把回收站、恢复旧PRD或仅创建人删除重新加入范围。**用户已验收阶段1并授权阶段2；现阶段2完成待验收，阶段3—5未开始。公司执行条件仍须另行确认，不把旧回执当作新部署。

## 10. 其他已确认需求背景

### 10.1 P-001：项目权限设置（登记但未实施）

入口：顶部工具栏右上角“项目权限设置”。

已确认方向：

- 项目创建人自动获得 `project_api_author`。
- 其他被加入项目的成员默认 `project_api_reader`。
- 只有项目创建人管理项目权限。
- 支持添加成员、用户名搜索、部门筛选、多选授权和移除权限。
- 支持按功能配置权限，例如：用户A可协作UC，但对PRD只有只读。
- 搜索范围只支持用户名和部门筛选。
- UC协作权限包包含读取、创建、编辑草稿、保存新修订、确认、生成、导出；不将“确认”拆成独立权限。
- “移除成员”和“移除某一功能权限”需要区分。

完整登记在23号P-001，不要在本CRUD任务中偷偷实现权限管理。

### 10.2 P-002：Agent八场景（登记但未全部实施）

场景码：

```text
PROMPT_EXPAND
FEATURE_DEFINITION
FROM_DEFINITION_CREATE_PRD
FROM_PRD_CREATE_UC
FROM_UC_CREATE_UC_DIAGRAM
FROM_UC_CREATE_FR
FROM_FR_CREATE_SS_ASSIGNMENT
FROM_SS_ASSIGNMENT_CREATE_REQ_DIAGRAM
```

用户确认过的关键触发：

- 工作台“一键扩写”调用Agent，结果回填输入框。
- 生成PRD先识别/创建功能，再生成PRD；相似功能需要用户确认“是/不是”；已有PRD时报错。
- PRD生成UC、UC全景生成图、UC全景一键生成FR、FR全景一键生成分配、分配工作空间按当前功能展示子系统需求图。
- 子系统需求图只展示当前功能下**已确认的分配**；未确认分配修改不进入图。
- 图可以由Agent返回Mermaid或其他图形代码，前端负责展示；图的复用/来源版本策略曾保留为待定。

P-002与手动CRUD分开，不要因为有Mock按钮就声称Agent链路已经真实接通。

---

## 11. 阶段2本轮改动与未改范围

- 后端：单对象删除/影响查询、head+accepted引用口径、空分配保护、统一项目→功能→对象锁、版本与幂等审计、已删除祖先/来源保护、能力/字符串版本读取。无批量接口。
- SQL：新增独立deletion-20260928包，调整活动PRD唯一性、三表archived_at列UPDATE、既有author的archive动作和窄确认函数；旧36份SQL（含阶段1包）逐字节未改。
- 测试：前端137通过且lint/typecheck/build通过；阶段2应用fixture216通过/54跳过，54项由旧项目fixture24与迁移30另行执行通过；真实HTTP 34项检查通过。详见28号，不沿用27号浏览器结果冒充本轮回归。
- 文档：同步README、02、06、23、24、25、26、27，新增28号及独立SQL说明；AGENTS追加仅阶段2授权。
- 未做：前端src和generated API未改；侧栏删除、空子系统节点隐藏、多选/批量、完整分配CRUD、恢复/回收站、权限管理与Agent新链路未实施。
- 未连接公司DB/SSH、未部署、未读取/展示凭据、未Git提交/reset。变更备份、哈希和本轮证据见28号。
- 阶段2自动回归的本机PG和8108临时HTTP服务已停止；3000/8000人工实例仍保持阶段1代码/schema，不自动迁移或重启。

## 12. 五阶段执行与用户验收闸口

执行进度以[26号](<E:/Git projects/TS-frontend/docs/current/26_CRUD分阶段实施与验收进度_20260928.md>)为准，24号保留详细设计。

| 阶段 | 内容 | 当前状态 |
|---|---|---|
| 1 | 项目/功能资料编辑与文案 | 用户已验收通过 |
| 2 | 单对象删除后端、引用/并发、PRD新ID与SQL | 实现及本地验证完成，待用户验收 |
| 3 | 侧栏单条/项目删除入口、分配树与界面同步 | 未开始 |
| 4 | 多选删除、批次检查和原子事务 | 未开始 |
| 5 | 全流程回归与公司执行材料 | 未开始 |

**总验收进度：██░░░░░░░░ 20%（1/5）。阶段2没有获用户验收，不能提前计40%。**

每阶段完成即停；有问题只修当前阶段，用户明确通过后才开始获准下一阶段。禁止跨阶段加UI/批量或自动连接、迁移、启停公司服务。OpenAPI仍为契约来源；阶段3接线时再按生成流程更新前端契约，不手改生成文件。

## 13. 新对话继续提示词

> 先读25、26及28号；阶段1已获用户验收，阶段2实现和本地验证已完成但尚待验收，当前应等待用户意见。只修复阶段2问题，不自动进入阶段3。规则已确认：非空项目/功能不能单删，PRD有UC、UC被head/accepted FR引用、FR有分配（含空分配）均阻止；分配可直接删、目录/FR不删；PRD删后新ID、不恢复历史。前端删除入口与空子系统隐藏仍待阶段3，多选待阶段4。当前3000/8000人工预览保持阶段1，不代表已加载阶段2。禁止公司DB/SSH、凭据泄漏或改旧SQL，不做Git reset。

## 14. 当前状态摘要与下一步

- 阶段2已交付的全部后端规则、SQL、验收矩阵和证据见[28 阶段2删除后端与PRD新建](<E:/Git projects/TS-frontend/docs/current/28_CRUD阶段2_删除后端与PRD新建_20260928.md>)。
- PRD产生多个历史身份后，旧全历史唯一约束不能合法恢复；rollback会拒绝，绝不删除历史强行回退。阶段2合法回退前不能直接回退阶段1授权包。
- 公司部署未执行。原人工验收实例保持运行；阶段2真实HTTP验证使用一次性端口8108、PG56429，均已停。
- **下一步仅等待阶段2验收。确认无问题后才开始阶段3侧栏单条删除和界面同步，不直接跳到多选。**
