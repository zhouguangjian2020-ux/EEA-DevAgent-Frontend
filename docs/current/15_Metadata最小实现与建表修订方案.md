# 15 Metadata 最小实现与建表修订方案（R2）

> 创建日期：2026-09-21；执行状态更新：2026-09-22。依据：14号D01—D07已确认规则。**用户回传已证明R2建表、样本导入及数据库验收通过**，执行证据见第7节；不代表前后端已消费metadata。
> 公司`ee_platform`已完成29张业务表+1张迁移记录表的R2部署，独立样本项目`XRAY-DVR-SAMPLE`已导入。旧M0包及13号旧续做命令继续停用；R2已部署文件同样冻结，不重装、不重建、不覆盖，不为继续联调重复建表/导入。

## 1. 最小范围：不增加表，不做平台化

- 沿用**29张业务表 + 1张行政迁移记录表**；物理业务列也不增加。
- 复用`artifact_types / artifact_type_versions`以及已有对象、版本、来源、审阅表。
- 只实现4类现有对象的固定适配器、2种正文完整性校验（非空白/最少项数）、既有引用规则和版本保护；没有任意脚本解释器。
- 不做动态建表、通用表单设计器、项目级metadata覆盖、审批平台、子系统维护后台、影响分析平台、自动修复/自动迁移或自动级联降级。
- 前后端metadata消费、认证用户到业务权限的正式接入仍是后续工作；本包不创建应用登录账户、不授予应用DML，也不修改后端/Agent源码。
- M1的3张AI表和任务关联仍未接入；本包不能接收真实AI更新结果，不用`manual`伪装AI来源。

## 2. 代码逐项审查结论

| 规则 | 旧包/现有代码问题 | R2处理与验证 |
|---|---|---|
| D01/D02：FR多来源与选择资格 | 旧定义把来源简化为UUID数组；缺少身份+版本自描述 | 变为明确UC对象/版本元组；新选来源检查当前接受版；组合FK继续限制本项目同功能；未变化的旧引用可随草稿继承，接受时另查D07 |
| D03：接受后允许新候选 | 旧`guard_artifact_update`禁止已有接受指针时更新head | 保留不可变历史；head须基于当前head前进；accepted只随合法accept事件改变；并发旧基版写入拒绝 |
| D03：新候选审阅不误伤旧接受 | 旧实现拿对象最后一条事件推导accepted | 当前接受指针对应最近一次accept；查看某版本的审阅状态按该版本事件计算；测试拒绝r2不损害r1 |
| D05：不完整草稿 | 旧SQL要求所有FR版本都有来源；UC名称保存时强制非空 | 来源非空移到接受阶段；允许空UC名称、零来源FR、零目标分配暂存；结构、类型、真实引用和隔离不放松 |
| D06：UC最低内容 | 旧接受触发器强制4分支+5异常全满 | 接受只按名称、描述、主事件流非空白；其他槽位不伪造；样本3/3/2分支原样保留 |
| D06：规则真正被使用 | 原field_catalog只有key/path/type | 完整定义写入数据库；`acceptance_issues`读取绑定版本的字段校验规则；新定义不重解释旧内容 |
| D07：接受时直接上游 | 旧SQL没有完整的接受时版本门槛 | UC查PRD、FR查每条UC、分配查FR；上游共享行锁与接受事务配合，双会话验证两种先后顺序 |
| 历史快照完整性 | 旧xmin=顶层事务ID写法误拒绝保存点内新快照 | 区分自己仍在进行的事务/子事务与已提交快照；合法新快照允许追加，已提交正文/关系仍拒绝追加 |
| 部署包安全 | 原SHA检查不能识别遗漏的清单项 | 精确要求18个载荷；拒绝遗漏、重复、路径越界、CRLF/BOM清单；R2独立迁移编号，拒绝在旧迁移上直接套用 |

**前端本轮只做最小阶段校验对齐，metadata/API仍未接入：**

- `src/features/prd/model.ts`、`src/features/uc/model.ts`、`src/features/fr/model.ts`现已允许不完整待审阅草稿保存；接受动作分别执行PRD正文、UC名称/描述/主事件流、FR来源/描述的最低检查。它们仍是本地Mock状态模型，不是数据库版本指针或服务端权限。
- `src/features/uc/model.ts`仍保留12个顶层字段和固定4分支/5异常显示结构，但没有实现已接受后修订、历史版本、拒绝候选保留旧接受等服务端语义。
- `src/features/fr/model.ts`仍使用单个展示来源字符串，不等同于R2的真实多UC身份+版本关系；正常来源选择、越域拒绝和D07接受时上游检查仍必须由后端/API实现。
- PRD/UC/FR/分配工作台尚未读取本包定义来动态驱动标签、控件、顺序和权限；本轮不改成通用表单，不复制UC空槽为虚构记录。既有功能测试通过不证明metadata整体联调完成。

## 3. metadata具体放在哪里

### 3.1 类型定义：仍是原来3列

| 列 | R2内容 | 不承担什么 |
|---|---|---|
| `content_schema` | Canonical读内容的JSON Schema；空字符串/空数组可构成合法草稿；`x-ee`放固定renderer、编辑方式、引用政策、实例公共契约 | 不执行任意JSON脚本；不是任意数据库DDL |
| `field_catalog` | 稳定key、实际路径、中文名/说明、按数组顺序展示、显示视图、控件、编辑类别、接受校验、场景子组与显示槽 | 静态“可编辑”不等于用户有权限 |
| `metadata_schema` | 系统管理的来源文件、校验值、表/行号、原始名称等证据说明；保留未知证据键但只读 | 不用附加JSON授予权限、决定正式状态或开放自定义业务字段 |

源定义：`docs/current/database/m0-20260921-r2/metadata_contract.py`；发布数据：`data/type-definitions.json`。4类定义的`version_no=2`且使用新UUID；样本仅更新定义绑定，不修改业务正文/来源/目标。V1不是被原地覆盖。

`x-ee.instance_contract`同时说明所有`artifacts`/M0 `artifact_revisions`物理字段和运行时字段；公共源文件为`data/instance-contract.json`，构建时嵌入每个类型版本，避免历史对象依赖一个未固定的“全局最新版”。这不是新增表或配置后台。

### 3.2 四类业务字段与编辑范围

- **PRD**：编号只读（详情默认隐藏）；正文为自由Markdown/长文本，整份编辑；正文接受时非空白，不要求标题章节。
- **UC**：依序为名称、描述、编号、参与者、前置条件、场景、后置条件、扩展用例、HMI交互逻辑、法规、性能、非功能，共12个可见顶层字段。PRD依据作为隐藏关联描述，不增加第13个显示字段。
  - 场景内主事件流、分支、异常分别定义；分支4显示槽、异常5显示槽保留。
  - 场景项的稳定身份/类别/顺序为系统值，正文可编辑。没有源记录的空槽不生成记录。
  - 名称、描述、主事件流接受时非空白；其余业务文本不强制填满；编号只读。
- **FR**：编号只读；来源为UC对象+版本元组的受控多选；描述可编辑。接受时描述非空白且来源至少一条。
- **FR分配**：编号、来源、描述从固定FR版本派生只读；只编辑本项目子系统多选。隐藏FR依据、方案版本及既有导入备注也有定义，但不新增编辑入口。接受时至少一个有效目标。

未填写的业务文本用空字符串、未选集合用空数组表示；SQL身份/类型/引用结构不因草稿不完整而允许缺失，不自动补N/A。

字段身份/数据路径保持稳定；已支持字段的中文名、顺序、控件配置由定义给出。未知控件、未知校验运算符在构建检查中拒绝，不假装任意新增控件都无需开发。

### 3.3 实例不重复保存一份“状态JSON”

- 身份/项目/功能/编号、创建审计来自`artifacts`；正文版本、基版、定义版本、来源方式来自`artifact_revisions`。
- 工作版与当前接受版分别由`head_revision_id / accepted_revision_id`确定。
- `review_status`按正在查看的具体版本计算；旧接受版不把接受标签借给新候选。
- `dependencies`给出直接上游的被引用版本、当前接受版及变化提示；不递归阻断，不自动改写引用。
- 有效编辑/接受能力必须由**认证后的后端**结合字段规则、项目权限、所看版本及校验结果计算。缺少能力信息时客户端禁止写操作。`actor_id`不能由浏览器随意指定。
- `bigint`计数在正式API适配时以十进制字符串传输，避免JavaScript数字精度损失；数据库仍使用原有bigint列。

普通编辑不能直接修改隐藏的PRD/FR依据版本。上游变化后的依据修订必须在明确的复核动作中生成新内容版本，不能偷偷替换引用；对象身份/编号仍不能改变。具体前端动作和认证API待接入时实现，本轮没有额外增加编辑入口。

本包提供的内部SQL适配器：`revision_document`、`revision_state`、`acceptance_issues`。它们不是已开放的业务API，不接受客户端权限声明；所有函数默认撤销PUBLIC执行权限。

### 3.4 定义升级与尚未开放事项

采用最小的“新增不可变定义版本 + 新内容修订显式绑定”方式，不修改旧定义/旧正文；新包里的元数据标签变化不会自动影响旧版本。退休定义仍能解释历史，不允许新对象新采用退休定义；既有修订链可继续保留原绑定。

这属于本次技术落地选择，不等于已开发定义发布/迁移后台。撤销接受、回退/重新打开、创建者自审、双人审批、完整权限矩阵、AI任务入口等仍未开放；本包不借此次确认新增这些产品流程。SQL保留现有reject事件的版本级一致性，但不提供拒绝/重审UI或新增API；withdraw继续拒绝。

## 4. 数据库验证与尚待联调的边界

已实际执行（本地Windows隔离PostgreSQL **18.6**，不是旧PGlite 17.5代替）：

1. 建立29张业务表；非法导入整批回滚；同一真实样本重复导入不增重；逐字段精确核对。
2. 32份Canonical读内容全部通过绑定定义的JSON Schema 2020-12校验。
3. 原8项回滚冒烟及R2新增的草稿、审阅、版本、来源、非递归、旧方案等回滚用例通过；事后再次验证样本全部待审阅、没有残留审阅事件/测试权限。
4. 3组真正双会话竞争通过：上游先更新拒绝旧引用；下游先接受后保持历史；同基版并发保存拒绝迟到写入。
5. 本地自定义格式备份、恢复到另一个隔离库、重新逐字段核对通过。不是公司服务器备份回执。
6. 16项Python契约/发布护栏回归通过；7个生成文件在隔离副本中逐字节重建一致；PowerShell/Bash指令块语法检查通过。冻结旧包和真实源文件核对不变；本轮另有3个本地对象模型及相关测试的最小阶段校验对齐改动。

证据：`artifacts/metadata-m0-r2-20260921`。执行脚本、失败尝试日志和最终通过报告均保留；不得只看曾经一次失败日志就替代最终报告，也不得隐藏曾暴露并修复的缺陷。

后续仍必须验证：前端实际消费标签/顺序/可编辑规则、后端生成OpenAPI并使用同一契约、鉴权与越域拒绝、双版本UI、真实AI接入（M1）。**这些不是恢复本轮数据库部署之前就必须全部做完，但必须在整体metadata功能验收前完成。**

## 5. 本次发布包

- 新目录：`E:\Git projects\TS-frontend\docs\current\database\m0-20260921-r2`
- 压缩包：`E:\Git projects\TS-frontend\docs\current\database\releases\ts-db-m0-20260921-r2.tar.gz`
- 迁移号：`001_m0_metadata_r2_20260921`
- 压缩包SHA-256：`b39cd42769924453df8961330eb1f2167c4b10b4483457da52e8f79ccf2420a9`
- 内容：18个载荷文件 + LF格式`SHA256SUMS`。不要混用旧包中的脚本或校验清单；不要在服务器手改SQL。
- 本包是**空业务库的初次建表包**，不是已安装旧M0包后的增量迁移。若发现旧迁移或任何意外业务表，必须停止；不提供DROP/自动重建。
- 样本仍为1 PRD、3 UC、14 FR、16条UC来源关系、14分配、43个项目子系统。五个规范名称与源内容完全保留。

## 6. 用户逐步执行手册：只操作已创建的ee_platform

> 2026-09-22：本节6.1—6.7已由用户执行并回传通过，以下命令保留作历史操作记录，**当前不要从头重跑**。实际状态和下一步见第7节。

所有服务器命令由用户执行并回传；本轮未SSH/上传/修改服务器。**建议此次先做6.1—6.3，回传只读预检结果后再进入6.4。** 以下后续步骤已写全，但不是跳过检查的许可。

### 6.1 Windows PowerShell：校验新包并上传

任意PowerShell目录都可执行；IP/SSH目标和文件路径必须保留引号。这里SSH端口为22，数据库端口为5432，两者不是同一个端口。

```powershell
$ErrorActionPreference = 'Stop'
$SshTarget = 't7920@192.168.64.3'
$SshPort = 22
$Archive = 'E:\Git projects\TS-frontend\docs\current\database\releases\ts-db-m0-20260921-r2.tar.gz'
$ExpectedSha = 'b39cd42769924453df8961330eb1f2167c4b10b4483457da52e8f79ccf2420a9'
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw '本地R2压缩包不存在' }
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha) { throw '本地压缩包校验不符，停止' }

& ssh.exe -p $SshPort $SshTarget 'if [ -e "$HOME/ts-db-m0-20260921-r2.tar.gz" ] || [ -e "$HOME/ts-db-m0-20260921-r2" ]; then echo "STOP: R2 path already exists; review progress before retry" >&2; exit 40; fi'
if ($LASTEXITCODE -ne 0) { throw '远程预检未通过：保留上方真实错误；连接失败不代表目录已存在，不继续上传' }
& scp.exe -P $SshPort $Archive "${SshTarget}:ts-db-m0-20260921-r2.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'R2上传失败，停止' }
& ssh.exe -p $SshPort $SshTarget
```

若R2目录/包已存在，先核对日志和SHA，不重复覆盖或删除。旧的`ts-db-m0-20260921`目录保持不动。

### 6.2 Ubuntu SSH：双层校验与解压

括号使失败仅退出当前步骤，不因为`set -e`关闭整个SSH会话。

```bash
(
  set -euo pipefail
  cd "$HOME"
  printf '%s  %s\n' 'b39cd42769924453df8961330eb1f2167c4b10b4483457da52e8f79ccf2420a9' 'ts-db-m0-20260921-r2.tar.gz' | sha256sum -c -
  test ! -e "$HOME/ts-db-m0-20260921-r2"
  mkdir -m 700 "$HOME/ts-db-m0-20260921-r2"
  tar -xzf "$HOME/ts-db-m0-20260921-r2.tar.gz" -C "$HOME/ts-db-m0-20260921-r2"
  cd "$HOME/ts-db-m0-20260921-r2"
  sha256sum -c SHA256SUMS
  python3 server_step.py check-package
)
```

预期：压缩包OK、18个载荷全部OK、`PACKAGE CHECK: PASS; 18 payloads; release 001_m0_metadata_r2_20260921`。任何错误停止，不批量修改文件换行。

### 6.3 只读复核已有库：本次先停在这里回传

```bash
(
  set -euo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921-r2"
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-r2-inventory"
  mkdir -p -m 700 "$RUN_LOG"
  printf 'RUN_LOG=%s\n' "$RUN_LOG"
  sudo -v
  python3 server_step.py inventory \
    --database ee_platform --port 5432 \
    --system-id 7686454253092706426 2>&1 | tee "$RUN_LOG/inventory.log"
  printf '\nR2 INVENTORY FINISHED. Send output; stop before backup/migration.\n'
)
```

预期：仍为原集群、`/data/postgresql/18/main`、仅`127.0.0.1:5432`、UTF8、owner=`ee_m0_owner`、仅public且业务表0张。**不运行bootstrap，不再次CREATE DATABASE。** 若状态已变化，先处理差异；不覆盖或自动恢复。

### 6.4 预检确认后：备份现有空库

```bash
(
  set -euo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921-r2"
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-r2-backup"
  mkdir -p -m 700 "$RUN_LOG"
  sudo -v
  python3 server_step.py backup \
    --database ee_platform --port 5432 \
    --system-id 7686454253092706426 \
    --backup-dir "$HOME/ts-db-backups" 2>&1 | tee "$RUN_LOG/backup.log"
)
```

保存输出的`BACKUP_RECEIPT:`绝对路径。脚本检查备份归属、文件哈希、归档可列出和24小时有效期；公司服务器恢复演练仍未完成，不能因本地恢复测试通过而替代它。失败后不要继续。

### 6.5 使用明确的备份回执建表

```bash
(
  set -euo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921-r2"
  read -r -p '粘贴刚才BACKUP_RECEIPT的完整绝对路径: ' BACKUP_RECEIPT
  test -n "$BACKUP_RECEIPT" && test -f "$BACKUP_RECEIPT"
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-r2-migrate"
  mkdir -p -m 700 "$RUN_LOG"
  sudo -v
  python3 server_step.py migrate \
    --database ee_platform --port 5432 \
    --system-id 7686454253092706426 \
    --backup-receipt "$BACKUP_RECEIPT" 2>&1 | tee "$RUN_LOG/migrate.log"
)
```

预期：29业务表+1迁移记录表；只建表，不自动导入。整次迁移在事务中提交；相同R2迁移号/哈希再执行只核对，不重复DDL。意外表/旧迁移/其他会话/备份不符均停止。

### 6.6 明确同意独立样本项目后再导入

本包目标为独立样本项目`XRAY-DVR-SAMPLE`，并非自动挑选现有项目。如果希望预置到别的项目，停在这里，调整目标与重发新包，不能只手改UUID。

```bash
(
  set -euo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921-r2"
  read -r -p '确认导入独立样本项目，请输入XRAY-DVR-SAMPLE（其他输入停止）: ' PROJECT_CODE
  test "$PROJECT_CODE" = 'XRAY-DVR-SAMPLE'
  read -r -p '粘贴仍有效的BACKUP_RECEIPT完整绝对路径: ' BACKUP_RECEIPT
  test -n "$BACKUP_RECEIPT" && test -f "$BACKUP_RECEIPT"
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-r2-seed"
  mkdir -p -m 700 "$RUN_LOG"
  sudo -v
  python3 server_step.py seed \
    --database ee_platform --port 5432 \
    --system-id 7686454253092706426 \
    --backup-receipt "$BACKUP_RECEIPT" \
    --confirm-project-code "$PROJECT_CODE" 2>&1 | tee "$RUN_LOG/seed.log"
)
```

预期：全部对象仍待审阅；没有假接受/AI记录；没有应用账号或新网络监听。源数据或已有样本不同则停止，不覆盖旧值。只有受控DBA导入可保留未接受上游，普通来源选择不能用该例外。

### 6.7 数据库验收：回滚测试后再精确核对

```bash
(
  set -euo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921-r2"
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-r2-verify"
  mkdir -p -m 700 "$RUN_LOG"
  sudo -v
  python3 server_step.py verify --database ee_platform --port 5432 \
    --system-id 7686454253092706426 2>&1 | tee "$RUN_LOG/verify-before.log"
  python3 server_step.py smoke --database ee_platform --port 5432 \
    --system-id 7686454253092706426 2>&1 | tee "$RUN_LOG/smoke.log"
  python3 server_step.py verify --database ee_platform --port 5432 \
    --system-id 7686454253092706426 2>&1 | tee "$RUN_LOG/verify-after.log"
  printf '\nR2 DATABASE CHECKS FINISHED. Send logs; API/frontend integration is not yet accepted.\n'
)
```

`smoke`临时授予的测试权限、测试审阅/版本/方案变化全部ROLLBACK，随后再次精确核对原始样本。双会话竞争在本地隔离库验证，不在公司空库上启动额外压力任务。任何步骤失败先发日志，不DROP、不重建、不改权限/监听来强行继续。

## 7. 执行记录（只据实际回传更新）

### 7.1 2026-09-22 用户回传：数据库阶段完成

以下公司服务器状态来自用户手动执行后的完整终端回传，不是助手直连结果；助手未SSH、执行远程SQL、修改权限/监听或重启服务。

| 步骤 | 已回传结果 |
|---|---|
| 本地R2设计/脚本/规则检查 | 已完成；见第4节本地证据 |
| 公司ee_platform创建 | 已于2026-09-21回传成功；此次复用 |
| R2上传、文件校验、只读复核 | 已通过；压缩包哈希与第5节相同，18载荷PASS；迁移前0张业务表 |
| 建表前备份 | 已生成dump和回执，归档可列出/哈希检查通过；不是恢复演练 |
| R2建表 | MIGRATION COMMITTED；29业务表+1行政迁移记录表；没有M1 AI表 |
| 导入目标确认 | 用户实际输入XRAY-DVR-SAMPLE；不是自动选择其他项目 |
| 样本导入 | SEED COMMITTED；所有业务对象仍未接受 |
| 精确内容核对 | 导入后、smoke前、smoke内部回滚后及最终verify均PASS |
| 两组回滚测试 | 004/005均执行完毕并ROLLBACK；CONSTRAINT SMOKE CHECKS: PASS |
| 建表/导入后的新备份 | 2026-09-22 09:27:31已回传成功；归档可列出/哈希检查通过；保留建表前备份，不等同于恢复演练 |
| 公司服务器恢复演练 | 尚未完成；本地隔离库恢复测试不能替代 |
| 正式业务API、前端消费metadata、AI更新 | 尚未完成，不据本表打勾 |

**集群与回执：**

- 集群：`7686454253092706426`；PostgreSQL18.6；数据库`ee_platform`；所有者`ee_m0_owner`（NOLOGIN）；复核监听`127.0.0.1:5432`。
- R2迁移号：`001_m0_metadata_r2_20260921`。
- 迁移前只读日志目录：`/home/t7920/ts-db-m0-logs/20260922T011012Z-r2-inventory`。
- 建表前备份：`/home/t7920/ts-db-backups/ee_platform-20260922T011617895453Z.dump`。
- 对应回执：`/home/t7920/ts-db-backups/ee_platform-20260922T011617895453Z.backup.json`。
- 备份时间按文件名为2026-09-22 09:16:17（Asia/Shanghai）；该备份生成于迁移/导入前，不包含本次后续创建的业务表和样本。
- backup/migrate/seed/verify各命令均使用RUN_LOG和tee；回传未打印这些目录的具体时间戳，因此不猜测其完整目录名。
- 原始回传存档：`E:\Git projects\TS-frontend\artifacts\db-m0-r2-server-20260922\user-server-transcript.txt`；索引及来源哈希见同目录`server-review.json`。

**实际导入内容：**类型定义4份（版本2）；PRD1、UC3、FR14、FR分配14，共32个对象；FR→UC来源关系16条；1套项目子系统方案及其固定版本、43个子系统、8个域组。`003_verify.sql`不只对数量，还按包内预期值逐字段核对metadata、正文、编号、身份与关系，并检查没有接受指针/审阅历史。上述内容由PASS回执及已校验的同版验证脚本共同支持。

五个统一名称已在回传目录中确认：低压电源管理系统、感知融合和定位系统、挡位控制系统、X-Call系统、外部设备链接系统。

**规则测试结论与边界：**

- 允许不完整草稿，但接受时检查最低内容；受控导入仍待审阅，普通来源选择不能选择未接受UC。
- 已接受UC可产生待审阅r2；旧r1内容/接受保留；拒绝r2不清除r1；上游待审阅版本不使旧接受引用失效。
- 接受时核对直接上游；过时引用拒绝接受；上游后续接受变化不自动降级已接受下游，依赖变化另行表示。
- 合法固定方案不强制为最新版本；绑定metadata参与接受校验，新metadata不重解释旧版本。
- 两处ROLLBACK是有意撤销测试权限、版本、审阅、方案和metadata变更，不是撤销正式建表/导入。回滚后原始样本再次精确核对通过，样本没有被测试自动标记为已接受。
- 本次服务器回传覆盖单连接回滚规则测试；真实双会话并发与恢复演练仅有第4节本地证据，不扩大为公司服务器已验证。

### 7.2 导入后备份：已执行回传（保留命令记录）

第6节保留为部署过程记录，不再从6.1重跑。本节导入后备份也已由用户执行并回传成功，无需为完成本轮重复执行。它保存R2建表及样本导入后的数据库状态，不覆盖建表前备份，也不执行迁移/导入/自动恢复。

- 用户回传时间按备份文件名为2026-09-22 09:27:31（Asia/Shanghai）。
- RUN_LOG：`/home/t7920/ts-db-m0-logs/20260922T012731Z-r2-post-seed-backup`。
- BACKUP：`/home/t7920/ts-db-backups/ee_platform-20260922T012731358586Z.dump`。
- BACKUP_RECEIPT：`/home/t7920/ts-db-backups/ee_platform-20260922T012731358586Z.backup.json`。
- 同版18载荷包检查PASS；辅助脚本报告归档可列出/哈希检查通过，并输出POST-SEED BACKUP FINISHED。回传未包含dump哈希具体值，助手未读取远程dump或回执JSON，不补写未回传字段。
- 公司服务器恢复演练仍未完成。导入前、导入后两份备份均保留，不自动恢复到任何库。
- 本次回传登记：`E:\Git projects\TS-frontend\artifacts\db-m0-r2-post-seed-backup-20260922\user-reported-backup.json`（本地登记，不是服务器原始回执文件）。

以下为已执行的Ubuntu命令记录，**当前不需要再次运行**：

```bash
(
  set -euo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921-r2"

  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-r2-post-seed-backup"
  mkdir -p -m 700 "$RUN_LOG"
  printf 'RUN_LOG=%s\n' "$RUN_LOG"
  sudo -v

  python3 server_step.py backup \
    --database ee_platform --port 5432 \
    --system-id 7686454253092706426 \
    --backup-dir "$HOME/ts-db-backups" 2>&1 | tee "$RUN_LOG/backup.log"

  printf '\nR2 POST-SEED BACKUP FINISHED. Send BACKUP and BACKUP_RECEIPT output.\n'
)
```

本轮R2部署、样本数据库验收及导入后备份均已回传通过；恢复演练与业务联调未因此完成。

### 7.3 当前下一步：业务API与前端接入

之后进入另行实施/验收的业务API与前端接入：先核对认证身份/业务权限和连接方式，再按既有专用工作台接入四类对象及绑定metadata；FR受控来源选择和分配项目子系统列表由后端使用真实身份/版本保障。不得把此次数据库通过当作动态UI、正式应用登录、真实AI更新或子系统划分功能已经完成，也不得为赶联调开放5432外网监听或使用postgres超级用户作为应用账号。


### 7.4 2026-09-22 进度汇总与查表入口

本轮部署、样本核对、导入前/后备份已完成；没有新的公司服务器写入或回传，仍不把恢复演练、业务API/前端/AI接入记为完成。用户日常查看数据库请使用[16 数据库查表操作手册](<E:/Git projects/TS-frontend/docs/current/16_数据库查表操作手册.md>)：先看完整表名/用途，再按终端环境连接只读查询。不要从第6节重跑部署，也不要用smoke代替只读查表。

### 7.5 2026-09-22 后续项目只读工作（与R2回执分开）

新授权范围是样本项目显示名“测试项目1”、唯一功能“行车记录仪DVR”和两个项目GET接口。R2表和原包不修改，保留所有项目/功能/对象ID及数据关系。独立变更包/后端本地测试已完成，公司步骤待回传，详见[17号执行手册](<E:/Git projects/TS-frontend/docs/current/17_测试项目1配置与项目只读接口.md>)。改名成功后R2原seed/verify/smoke仍按旧名称比对，不再用于新基线；使用17号新verify，原backup仍可用。
