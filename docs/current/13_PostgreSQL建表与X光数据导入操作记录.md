# 13 PostgreSQL业务库建表与X光数据导入操作记录（M0）

> 创建日期：2026-09-21。执行顺序：**确认已有实例/业务库 → 备份 → 建表 → 写入真实样本 → 数据库验收 → 后续再做前后端联调**。
> 本文件既是逐步操作手册，也是后续执行记录。**截至本文件创建：本地脚本/数据已准备并验证，公司服务器步骤全部待你执行和回传，不得打勾为已完成。**
> 不重复安装PostgreSQL、不重建集群、不删除已有库/表、不改监听/HBA/SSH、不重启现有服务。任何检查失败即停止，不能通过删库、删表或跳过校验继续。
> 最新状态（2026-09-22）：用户已回传集群`7686454253092706426`中`ee_platform`的R2备份、29张业务表+1张迁移记录表建表、`XRAY-DVR-SAMPLE`导入及回滚后精确验收全部通过。**旧包及下方旧续做命令继续停用，也不重复执行R2建表/导入。** 实际回执与后续边界见[15 Metadata最小实现与建表修订方案](<E:/Git projects/TS-frontend/docs/current/15_Metadata最小实现与建表修订方案.md>)第7节；导入后备份已于2026-09-22 09:27:31回传成功，下一步为另行实施的业务API/前端接入；公司服务器恢复演练尚未完成。原包和R2已部署包均冻结，不覆盖、不重建。

## 0. 先说明现在进度，以及你本次确认的内容

### 0.1 上次确实完成了什么

已找到归档中的用户回传记录，而不只是设计文档：

- 文件：`E:\Git projects\TS-frontend\docs\legacy\frontend-docs\database\records\4.3.12_本地SQL与运行参数验收_用户回传_2026-09-17.txt`。
- 历史结果：Ubuntu 22.04.5；`18/main`集群在线；数据目录`/data/postgresql/18/main`；TCP仅`127.0.0.1:5432`；可通过本地socket执行SQL。
- 上次手册明确写明该阶段没有创建`ee_platform`业务库、`ee`业务schema或PRD/UC/FR表；其“建库”可能指初始化集群及默认数据库。
- **你本次说后来已经建过业务库，应当以新查询为准。**本手册不会假定业务库不存在。第3步列出现有库，第4步让你选择复用还是创建，已有内容不会被覆盖。
- 不把2026-09-17的在线结果当作2026-09-21已经重新检查过服务器。历史记录中`start.conf=manual`，开机恢复未验收；此次不擅自改为auto。

### 0.2 本次数据决定已落实

| 原名称 | 正式目录/分配采用名称 |
|---|---|
| 低压电源子系统 | 低压电源管理系统 |
| 感知融合与定位系统 | 感知融合和定位系统 |
| 挡位系统 | 挡位控制系统 |
| X-call系统 / X-Call系统 | X-Call系统 |
| 外部连接子系统 / 外部设备连接系统 | **外部设备链接系统** |

- 按用户指定用“链接”，不是替你改回“连接”。源Excel不改；数据库目录名称、目标关系使用确认值，原名称/行号/文件哈希保留在导入证据中。
- **专业需求正文仍保留原文**，不将正文中的E-Call子功能或“车外传感器提供”猜测替换成另一种职责。目录和关系采用统一名称，不等于擅自改写业务需求。
- 已重新读取修改后的`UC.docx`：三处此前未提供的UC编号已删除。剩余UC编号引用都能在当前3个UC中找到。
- `UC.docx`当前SHA-256：`b888280353a6aced418f59d68d959440aebe0217ee638fa5fc2847e4e0f2cbfb`。其他4个源文件哈希与前次核查一致。
- Word自动编号不再由你手动解决。新转换器解析编号定义及列表计数，已处理PRD 14处、UC 52处；保留编号、原文、换行和合并场景。PRD导出器单级定义缺少ilvl，按本样本的唯一level0规则处理并测试；未知格式直接停止，不悄悄丢编号。
- 仍保留3/3/2条原始UC分支，不造N/A，不自动接受；导入是存储事实，不是内容批准。

### 0.3 本手册默认的样本归属，执行命令即明确选择

你尚未指定已有业务项目，所以包默认创建**一个独立的样本项目**，不修改已有项目。第7步必须显式确认项目code才导入：

| 项目 | 本包值/用途 |
|---|---|
| 业务数据库 | 2026-09-21已由用户输入确认并成功创建`ee_platform`；此前盘点无业务库，创建及复查见4.B.2 |
| 业务schema | `ee`；若已经存在但没有本包迁移记录，脚本停止，先审查旧表 |
| 项目code | `XRAY-DVR-SAMPLE` |
| 项目名称 | `X光DVR样本项目` |
| 项目ID | 本包确定性UUID；保存在`data/seed-data.json`，重跑不换ID |
| 业务功能 | `DVR-301` / 行车记录仪DVR功能；保留源分配表“行车录制功能”作为来源说明 |
| 子系统目录 | 43项，8个域，初始方案1；本批实施默认43项均可分配 |
| 子系统编号 | `SS-001`至`SS-043`，是本次受控生成的项目内code，不冒充Excel源编号 |
| 导入操作人 | 根据你执行脚本的SSH用户名登记`manual:ssh:<用户名>`，不猜应用账号，不保存密码 |
| 业务状态 | 全部待审阅；`accepted_revision_id`为空，`review_events`无伪造记录 |

**如果你要导入已有项目，或者不接受上述样本项目/可分配默认，停在第6步，先修改准备方案。不要把本包JSON中的project_id手改成别的项目，更不要运行第7步后再搬动对象归属。**

## 1. 这次执行包会做什么

本地执行包目录：

```text
E:\Git projects\TS-frontend\docs\current\database\m0-20260921
```

| 文件 | 作用 |
|---|---|
| `server_step.py` | 服务器分步入口；只用Python标准库和服务器已有PostgreSQL18命令行工具 |
| `001_m0_schema.sql` | V2.0的29张M0业务表、PK/UQ/组合FK、CHECK、索引、历史保护与提交完整性触发器 |
| `002_seed.sql` | 写入类型/最低权限定义、项目/功能、43目录及PRD/UC/FR/分配；重复执行逐字段比对，不覆盖 |
| `003_verify.sql` | 只读逐字段核验，不仅数行；验证正文、编号、名称、来源、目标和未接受状态 |
| `004_smoke_rollback.sql` | 错误约束测试和一FR多目标测试，最后全部ROLLBACK |
| `schema-manifest.json` | 此发布包冻结的V2.0字典 |
| `data/seed-data.json` | 当前5份源文件生成的实际待导入内容 |
| `data/preparation-report.json` | 源文件哈希、编号转换前后证据、引用核查和数量 |
| `data/prd-numbered.preview.md` | 保留编号后的PRD全文预览，不要求你重新手工整理 |
| `SHA256SUMS` | 包内文件校验清单 |

**表数量：**M0业务29张，M1的3张AI表本次不建。另有`ee_admin.schema_migrations`这1张运维迁移记录表，所以全库新建物理表合计30张，但业务表仍29张，不改变32张业务目标清单。以后接入正式迁移框架时接管/迁移这张运维记录，不另维护两套账。

**数据库角色：**本阶段仅建立/复用`ee_m0_owner NOLOGIN`作为对象所有者。通过`sudo -u postgres`受控执行建表/导入，不创建后端登录口令、不授予应用超级用户、不暴露业务API。后续联调再增加最小权限应用角色与后端鉴权事务；这不是把权限系统删掉，29表已包含类型、权限和审阅底座。

**已实现的数据库约束不等于完整业务服务：**组合归属、类型、scope形状、历史不可更新、已提交子项集合不可追加、正文完整性、当前方案、目标可分配和基本审阅一致性已在SQL中。按用户/项目逐请求鉴权、全输入集合CAS、正式接受字段质量校验、并发锁协议以及Agent任务仍需后端联调实现；未实现之前不给应用账号直接写表权限。

## 2. 在本机Windows打包并上传

所有命令在**本机PowerShell**运行，不是在服务器Bash。

### 2.1 核查本地包并压缩

```powershell
$Bundle = 'E:\Git projects\TS-frontend\docs\current\database\m0-20260921'
$Python = 'C:\Users\zhouguangjian\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$Archive = Join-Path $env:TEMP 'ts-db-m0-20260921.tar.gz'

# 已冻结的SHA256值不重算；先验证载荷，再仅规范化清单换行。
& $Python -X utf8 'E:\Git projects\TS-frontend\docs\current\database\tools\normalize_m0_checksums.py' --bundle $Bundle
if ($LASTEXITCODE -ne 0) { throw '校验清单或载荷异常，停止打包' }

& $Python -X utf8 (Join-Path $Bundle 'server_step.py') check-package
if ($LASTEXITCODE -ne 0) { throw '执行包校验失败，停止上传' }

Get-Command tar.exe, ssh.exe, scp.exe -ErrorAction Stop
& tar.exe -czf $Archive -C $Bundle .
if ($LASTEXITCODE -ne 0) { throw '打包失败' }
Get-FileHash -LiteralPath $Archive -Algorithm SHA256
```

预期看到`PACKAGE CHECK: PASS`和压缩包SHA256。保留哈希，服务器上要再次对比。包内是业务数据，请只上传到公司的目标服务器，不发到公共服务。

### 2.2 上传并登录

2026-09-21用户回传本次拟连接地址`192.168.64.3`、端口`22`；SSH用户名按上次记录预填`t7920`，如实际用户名不同，只修改`@`前的部分。地址/端口仍需实际登录验证，本次失败不能证明已连通。

**直接赋值时整个目标必须加引号：**`$SshTarget = 't7920@192.168.64.3'`。不要写`$SshTarget = 192.168.64.3`，本地已复现这种未加引号的写法得到空值，导致后面的远程命令被SSH当成主机名。也不要只写IP而无意使用Windows本地用户名登录。

**将下面从`& {`到最后一个`}`整段一起粘贴。**脚本块内任何失败都会停止本块后续上传/登录；不要在报错后单独继续运行scp。本段重新设置Archive，不依赖之前PowerShell窗口中的变量。

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $SshTarget = 't7920@192.168.64.3'
    $SshPort = 22
    $Archive = Join-Path $env:TEMP 'ts-db-m0-20260921.tar.gz'

    if ([string]::IsNullOrWhiteSpace($SshTarget)) {
        throw 'SSH目标为空；请用引号填写 用户名@服务器地址'
    }
    if ($SshPort -lt 1 -or $SshPort -gt 65535) {
        throw 'SSH端口必须是1至65535的整数'
    }
    if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
        throw "找不到本地压缩包：$Archive。请先完成2.1，不要继续上传。"
    }
    Get-Command ssh.exe, scp.exe -ErrorAction Stop | Out-Null
    Write-Host "目标：$SshTarget，SSH端口：$SshPort"
    Write-Host "本地包：$Archive"

    # cd默认进入远端用户HOME；避免跨PowerShell/OpenSSH转义双引号。
    # 同时检查普通路径和悬空符号链接，存在时不覆盖。
    $RemoteCheck = 'cd || exit 43; if test -e ./ts-db-m0-20260921.tar.gz || test -L ./ts-db-m0-20260921.tar.gz || test -e ./ts-db-m0-20260921 || test -L ./ts-db-m0-20260921; then exit 42; fi; exit 0'
    & ssh.exe -p $SshPort $SshTarget $RemoteCheck
    $CheckExit = $LASTEXITCODE
    if ($CheckExit -eq 42) {
        throw '已连接服务器，但发现同名包或目录；先核查上次进度，不覆盖、不删除。'
    }
    if ($CheckExit -ne 0) {
        throw "SSH检查失败，退出码=$CheckExit。请查看上方连接/认证/远端目录错误；不能据此认定文件已存在。未执行上传。"
    }

    & scp.exe -P $SshPort $Archive "${SshTarget}:ts-db-m0-20260921.tar.gz"
    if ($LASTEXITCODE -ne 0) {
        throw '上传失败，停止；可能留下部分远端文件，先核查再重试。'
    }
    Write-Host '上传成功，下面登录服务器；登录后从第3步核对包哈希开始。'
    & ssh.exe -p $SshPort $SshTarget
    if ($LASTEXITCODE -ne 0) {
        throw '上传完成，但后续SSH会话未正常结束；不要再次覆盖上传，先核查登录状态。'
    }
}
```

首次连接如提示确认主机指纹，先和管理员/可信记录核对；已有指纹不符时停止，不能关闭主机密钥检查。密码只在SSH/sudo自己的交互提示中输入，不写入命令、不发给助手。多次提示密码可能分别对应检查、上传和登录，并非SQL执行。

**本次报错记录：**先前`Could not resolve hostname test ...`发生在解析SSH目标时；旧提示“服务器已有同名包/目录”误将全部非零退出码等同于文件存在，现已纠正。用户回传的scp也失败；尚无上传成功或服务器建表/导入完成证据。

## 3. 在服务器只读确认实例与数据库

从这里开始都在**同一个服务器Bash会话**中执行。普通SSH用户运行Python，**不要`sudo python3 server_step.py`**；脚本只对数据库子命令使用sudo。

### 3.1 解压和日志准备

**已上传/解压但遇到`SHA256SUMS`文件名末尾带`\r`错误的用户：不要重跑下面的test/mkdir/tar，直接执行3.1.1修复。新包已使用LF清单。**

```bash
set -Eeuo pipefail
umask 077
cd "$HOME"
sha256sum ts-db-m0-20260921.tar.gz
```

先人工对照Windows第2.1步的SHA256，一致再继续：

```bash
test ! -e "$HOME/ts-db-m0-20260921"
mkdir -m 700 "$HOME/ts-db-m0-20260921"
tar -xzf "$HOME/ts-db-m0-20260921.tar.gz" -C "$HOME/ts-db-m0-20260921"
cd "$HOME/ts-db-m0-20260921"
sha256sum -c SHA256SUMS
python3 server_step.py check-package

RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p -m 700 "$RUN_LOG"
sudo -v
```

`set -e`/`pipefail`意味着命令失败将停止当前流程，可能退出当前SSH shell；重新登录时先检查日志，不盲目从头建库。续做时只重新`cd`和设置变量，不重新解压或覆盖目录。

### 3.1.1 本次CRLF校验清单故障：只修复清单，不重新解压

2026-09-21用户回传：上传并解压后，`sha256sum -c SHA256SUMS`将12个文件名末尾的`\r`当作文件名字符，报告无法读取；随后SSH连接关闭。已核查本地原包中的SHA256SUMS有12个CRLF行尾，原清单列出的12个载荷文件均存在且哈希匹配。原因是Windows上文本写入自动转换换行，不是SQL文件名本身应带回车。

已有`set -e`会在校验失败时停止当前shell；这与回传的连接关闭相符，不是数据库服务故障证明。不要把之后的check-package、RUN_LOG、sudo或数据库盘点算作已完成。

**本机PowerShell先重新登录：**

```powershell
ssh.exe -p 22 t7920@192.168.64.3
```

**服务器Bash整段执行以下内容（外层括号保留，避免主动把set -e留在交互shell）：**

```bash
(
  set -eu
  cd "$HOME/ts-db-m0-20260921"
  BACKUP=$(mktemp ./SHA256SUMS.before-lf.XXXXXX)
  cp -p -- SHA256SUMS "$BACKUP"
  python3 -c 'from pathlib import Path; p=Path("SHA256SUMS"); b=p.read_bytes(); p.write_bytes(b.replace(b"\r\n", b"\n"))'
  sha256sum -c SHA256SUMS
  python3 server_step.py check-package
)
```

此操作只将**SHA256SUMS**的CRLF行尾替换为LF，并保留一个独立备份。12条预期哈希及文件名不改，SQL/Python/JSON/Markdown载荷一字节不动；不是重算清单来接受损坏文件，也不是跳过校验。不要对整个目录运行dos2unix，否则会改变SQL等文件哈希。

预期12个文件均显示`OK`，最后`PACKAGE CHECK: PASS`。若仍有缺文件或哈希不匹配，停止回传，不继续数据库操作。已知本包清单修复后SHA256：`6ea5412f0a0e575bcd71cfaaeacbc4bbad35099640ce6845d26da795d709bcb4`（仅用于核对清单自身，不代替载荷校验）。

**2026-09-21后续回传：12个文件均显示`OK`，最后`PACKAGE CHECK: PASS`，服务器解压后载荷校验已通过。**这不代表业务建库、建表或导入完成。下一步直接执行3.2的完整只读盘点块，不重新上传/解压。以下仅为通用日志初始化示例（执行3.2时不必重复执行本段）：

```bash
umask 077
cd "$HOME/ts-db-m0-20260921"
RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-resume"
mkdir -p -m 700 "$RUN_LOG"
sudo -v
```

本地工作目录的清单已修复；为保留已上传压缩包的证据，本地旧tar.gz没有被改写。服务器无需重新上传，按上面只修清单即可；以后重新打包走已更新的2.1。

### 3.2 只读盘点

在服务器Bash执行整段。此块自行恢复目录并初始化日志，只写本地日志文件、只读查询数据库，不建库/建表、不导入、不调整服务配置。失败即停止本块，不主动把`set -e`留在交互shell。`RUN_LOG`在外层赋值，便于当前会话后续使用；重新登录后仍需恢复变量。

```bash
RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-resume"
(
  set -euo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921"
  mkdir -p -m 700 "$RUN_LOG"
  printf 'RUN_LOG=%s\n' "$RUN_LOG"
  sudo -v

  {
    date -Is
    hostname
    uname -a
    sudo pg_lsclusters
    sudo findmnt -T /data/postgresql/18/main -o TARGET,SOURCE,FSTYPE,OPTIONS
    sudo systemctl is-active postgresql@18-main
    sudo ss -lntp 'sport = :5432'
  } 2>&1 | tee "$RUN_LOG/01-host-inventory.log"

  python3 server_step.py inventory 2>&1 | tee "$RUN_LOG/02-database-inventory.log"
)
```

**执行后先回传这两段输出和RUN_LOG路径，确认目标后再继续3.3及写入步骤。**本轮inventory未指定业务库，只查询实例信息及数据库清单；原有业务表清单需选定目标库后继续查询，不能由本次清单推断为空库。

检查/停止条件：

- 应为上次的`18/main`，在线；数据目录仍`/data/postgresql/18/main`，挂载不是意外落到系统盘的空目录。
- 应只有`127.0.0.1:5432`监听；本步须根据输出核对主版本18、非只读备库。未带业务库参数的inventory只显示实例信息，不自动执行validate_target；后续带目标库及system_identifier的步骤才进行该项强校验。历史小版本仅作证据，不要求你重装成某个小版本。
- 输出中有`system_identifier`。这是集群身份，不是数据库名。保存其完整数字串。
- 查看库列表：`postgres/template0/template1`是系统库，不能拿来建业务表。若已有`ee_platform`或其他你创建的业务库，优先复用已确认的目标。
- **服务未运行、挂载不符、端口不符、业务库不明确时，停在这里把日志回传；不要执行安装、initdb、格式化或自动启动脚本。**

### 3.2.1 盘点输出停在集群列表时：保留各命令退出码

2026-09-21 19:13:21 +08:00用户回传止于`pg_lsclusters`列表：主机t7920，18/main、5432、online、目录/data/postgresql/18/main，Owner为`<unknown>`。没有后续挂载、systemctl、监听和Python实例/数据库清单输出；可能只是回传不完整，也可能前段命令非零触发3.2的失败即停，不能断言确切中断点。

`<unknown>`是工具未取得集群目录所有者信息，不能据此认定数据库角色丢失或要求重装。上游实现从数据目录stat读取UID/GID；普通用户路径访问权限不足是待验证原因之一。原步骤使用普通用户运行pg_lsclusters/findmnt，本次保留原命令对照并增加sudo只读检查，不执行chmod/chown。即便sudo检查成功，也必须核对目录所有者、真实挂载、监听、system_identifier及已有库；不将online或exit0等同完整验收。

**服务器Bash整段执行以下诊断，执行完先回传，不继续3.3或任何写入。**单项失败仍采集其他只读输出，逐项打印EXIT_CODE，最后汇总failures；它是诊断采集，不是放宽建表前置检查。外层错误提示防止把可预期的诊断非零状态传给可能启用set -e的交互shell。只写日志文件，不改数据库/目录权限/服务配置。

```bash
(
  set +e
  set -uo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921" || exit 1
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-diagnose"
  mkdir -p -m 700 "$RUN_LOG" || exit 1
  printf 'RUN_LOG=%s\n' "$RUN_LOG"
  sudo -v || exit 1

  {
    failures=0
    check() {
      local label="$1" rc
      shift
      printf '\n===== %s =====\n' "$label"
      "$@"
      rc=$?
      printf 'EXIT_CODE=%s\n' "$rc"
      if [ "$rc" -ne 0 ]; then failures=1; fi
      return 0
    }

    check "01 clusters as current user" pg_lsclusters
    check "02 mount as current user" findmnt -T /data/postgresql/18/main -o TARGET,SOURCE,FSTYPE,OPTIONS
    check "03 clusters with sudo" sudo pg_lsclusters
    check "04 directory ownership" sudo stat -c '%U(%u):%G(%g) %a %n' /data /data/postgresql /data/postgresql/18 /data/postgresql/18/main
    check "05 mount with sudo" sudo findmnt -T /data/postgresql/18/main -o TARGET,SOURCE,FSTYPE,OPTIONS
    check "06 service" sudo systemctl is-active postgresql@18-main
    check "07 listener" sudo ss -lntp 'sport = :5432'
    check "08 database inventory" python3 server_step.py inventory

    printf '\nDIAGNOSTICS FINISHED; failures=%s. STOP HERE; do not run write steps.\n' "$failures"
    exit "$failures"
  } 2>&1 | tee "$RUN_LOG/03-readonly-diagnostic.log"
) || printf '\nSome checks failed; send the output for review. Do not change permissions or restart services.\n'
```

待回传后判断：普通用户命令失败而sudo对照成功，可进一步确认访问权限影响；若sudo下仍unknown或目录/挂载不符，停在这里调查，不自动改属主或权限。数据库inventory失败时同样只处理其具体错误，不创建新库来绕过。此块RUN_LOG仅在子shell内有效，下次操作需按实际日志目录恢复变量。

### 3.2.2 2026-09-21诊断回传结论：盘点通过，业务库尚不存在

日志目录：`/home/t7920/ts-db-m0-logs/20260921T112106Z-diagnose`（目录时间对应2026-09-21 19:21:06 +08:00；不据此伪填各命令精确完成时间）。

| 检查 | 用户回传事实 / 判断 |
|---|---|
| 普通用户检查 | pg_lsclusters退出0但Owner为unknown；findmnt退出1，是failures=1的唯一来源 |
| 提权只读对照 | sudo pg_lsclusters退出0，Owner为postgres；sudo findmnt退出0，挂载可见 |
| 目录元数据 | /data为t7920:t7920、755；/data/postgresql、/data/postgresql/18、/data/postgresql/18/main均postgres:postgres、700 |
| 数据挂载 | /data → /dev/nvme0n1p1，ext4，rw,relatime |
| 服务/监听 | postgresql@18-main为active；仅127.0.0.1:5432监听 |
| 数据库实测 | 18.6 (Ubuntu 18.6-1.pgdg22.04+2)，UTF8，in_recovery=false |
| 集群身份 | system_identifier为7686454253092706426（保存为字符串，不舍入、不猜测） |
| 配置摘要 | ssl=on；password_encryption=scram-sha-256；TimeZone=Asia/Shanghai；未修改 |
| 数据库/角色 | 仅postgres/template0/template1，所有者postgres；非pg_内置角色仅postgres；没有业务库/ee_m0_owner |
| 包和SQL查询 | PACKAGE CHECK: PASS；inventory退出0，结束为READ ONLY. No database/table was created. |

本次已验证普通用户目录访问限制导致工具可见性差异，不能将汇总failures=1解释为数据库服务失败。保留现有postgres目录700权限，不chmod/chown，不重启或重装。3.2常规步骤改用sudo执行这两项只读主机查询，3.2.1仍保留原用户命令用于故障对照。

实例/库清单检查可以通过；目标业务库和其表还未创建，不能标成建表完成。没有现存业务库可复用，下一步采用第4节B分支；建议名仍为ee_platform，4.B.1会要求操作者输入同名确认，尚未冒称用户已确认或已创建。

### 3.3 设定经过核对的目标

```bash
cd "$HOME/ts-db-m0-20260921"
read -r -p '粘贴上一步的system_identifier完整数字串: ' SYSTEM_ID
read -r -p '输入确认的业务数据库名（例如ee_platform，不能填postgres）: ' DB_NAME
COMMON=(--database "$DB_NAME" --system-id "$SYSTEM_ID")
printf 'Selected database=%s cluster=%s\n' "$DB_NAME" "$SYSTEM_ID"
```

脚本只接受安全的小写业务库名；若已有库名不符合规则，不改名，回传后调整工具。不要因为示例写`ee_platform`就忽略实际已有库。

## 4. 复用已有业务库，或仅在确实不存在时创建

**以下A/B二选一，不要两段都执行。**这一步不创建业务表。

### A：第3步列表中已有目标业务库

```bash
python3 server_step.py bootstrap "${COMMON[@]}" \
  2>&1 | tee "$RUN_LOG/03-reuse-database.log"
```

预期`REUSED existing DB`。不会改已有数据库owner、编码、内容、已有数据库级授权；只确保专用NOLOGIN所有者可用。若同名所有者有异常权限/成员关系则停止，不擅自降权。

### B：确认目标业务库确实不存在

```bash
python3 server_step.py bootstrap "${COMMON[@]}" --create-if-missing \
  2>&1 | tee "$RUN_LOG/03-create-database.log"
```

预期`CREATED business database`。仅新建你指定的UTF8业务库及NOLOGIN owner，新库撤销PUBLIC连接/临时对象默认权限；不改集群配置，不删除任何库。建库故障后可能留下已创建的NOLOGIN角色或空库，重跑会重新核对并复用，不通过删除恢复。

### B.1 本次实际续做：创建ee_platform并复查（已回传完成，不重复执行）

基于3.2.2回传选择“没有业务库”的分支，使用历史建议名`ee_platform`。这不是服务器已有库，也不是产品业务项目名；执行者输入`ee_platform`后才写入。不修改冻结执行包，使用其既有bootstrap防护重新核对包、集群ID、目录、监听及目标库状态。

**在服务器Bash整段执行；确认提示输入ee_platform，sudo提示输入服务器用户密码。**以下只确保专用NOLOGIN所有者并创建业务数据库（新库撤销PUBLIC数据库权限），随后查询目标库schema/表，不建业务表/不导入/不配置应用密码。不运行备份或迁移，完成后先回传。

```bash
if (
  set -uo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921" || exit 1

  SYSTEM_ID='7686454253092706426'
  DB_NAME='ee_platform'
  COMMON=(--database "$DB_NAME" --system-id "$SYSTEM_ID")
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-create-db"
  mkdir -p -m 700 "$RUN_LOG" || exit 1
  printf 'RUN_LOG=%s\nDATABASE=%s\nSYSTEM_ID=%s\n' "$RUN_LOG" "$DB_NAME" "$SYSTEM_ID"

  read -r -p 'Type ee_platform to confirm creation: ' CONFIRM || exit 1
  if [ "$CONFIRM" != "$DB_NAME" ]; then
    printf 'Cancelled; no database changes.\n'
    exit 1
  fi
  sudo -v || exit 1

  python3 server_step.py bootstrap "${COMMON[@]}" --create-if-missing \
    2>&1 | tee "$RUN_LOG/03-create-database.log" || exit 1

  python3 server_step.py inventory "${COMMON[@]}" \
    2>&1 | tee "$RUN_LOG/04-target-database-inventory.log" || exit 1
); then
  printf '\nCREATE/INSPECT FINISHED. Send the output; stop before backup or migration.\n'
else
  printf '\nSTOP: cancelled or a command failed. Send the output; do not delete or recreate anything.\n'
fi
```

关键命令逐一显式检查失败，两个tee管道启用pipefail；外层if处理失败，避免错误关闭交互SSH shell。并非依赖if条件中的set -e。子shell内变量不保留；下一批备份/建表指令需重新设定目标和日志变量。

预期bootstrap打印`CREATED business database: ee_platform`和NOLOGIN说明；复查应列出ee_platform、ee_m0_owner以及无业务表的清单。若期间别的操作者已建同名库，脚本可能报告REUSED，须回传审查所有者/表，不能直接继续建表。复查末尾READ ONLY只指inventory自身没有写入，不否定前面的bootstrap建库。若失败，可能已有角色或空库部分完成，不删除重建；先回传两份日志。

此块已包含下方“两种情况都要做”的目标库盘点，无须紧接着重复执行；下一步待确认结果后做第5节建表前备份。

### B.2 2026-09-21创建及目标库盘点回传：已完成

日志目录：`/home/t7920/ts-db-m0-logs/20260921T112858Z-create-db`（目录时间为19:28:58 +08:00）。用户输入ee_platform确认，回传CREATE ROLE、CREATE DATABASE、REVOKE，随后`CREATED business database: ee_platform`及完整复查结果。

- 业务库ee_platform已存在，owner=ee_m0_owner、UTF8、非模板；非系统库不再为零。3.2.2中的“仅系统库”是创建前历史快照，不能当作当前状态重复建库。
- ee_m0_owner的rolcanlogin/rolsuper/rolcreatedb/rolcreaterole/rolreplication/rolbypassrls全部false；没有配置应用密码或网络监听。
- 集群ID仍为7686454253092706426；18.6、/data/postgresql/18/main、127.0.0.1:5432、UTF8、非备库，与盘点一致。
- 指定ee_platform查询结果：schema仅public（owner=pg_database_owner），非系统表0行；ee/ee_admin和29张业务表尚未建立，样本未导入。
- 结尾`READ ONLY. No database/table was created.`只描述后运行的inventory，不否定前面bootstrap的CREATE DATABASE；实例摘要中的database=postgres来自控制库查询，目标业务库schema/表则已按参数单独查询。

本步验收通过，不重跑bootstrap。下一步先做第5节建表前完整业务库备份；即使当前无业务表，也保留该基线，并取得迁移所需的备份回执。备份/建表/导入尚无执行回传。

### 两种情况都要做：查看目标库现有schema/表

```bash
python3 server_step.py inventory "${COMMON[@]}" \
  2>&1 | tee "$RUN_LOG/04-target-database-inventory.log"
```

- 只有空`public`或无关已知schema，可以继续，但必须备份。
- 若已有`ee`业务表但没有本包`ee_admin.schema_migrations`记录，**停止并回传表清单**。本包不会尝试把不明旧库“升级”成V2.0，也不会覆盖旧表。
- 若本包迁移已成功，后续migrate会校验SQL哈希及29表字段形状后返回“已执行”，不重复DDL。

## 5. 建表前完整备份

关闭该业务库的其他客户端/管理工具，安排无人写入的窗口。脚本会检查其他客户端连接，有连接就停，不强制踢人。

```bash
python3 server_step.py backup "${COMMON[@]}" \
  2>&1 | tee "$RUN_LOG/05-before-schema-backup.log"
```

输出两条绝对路径：

```text
BACKUP: /home/你的用户/ts-db-backups/数据库名-时间.dump
BACKUP_RECEIPT: /home/你的用户/ts-db-backups/数据库名-时间.backup.json
```

原样复制`BACKUP_RECEIPT`后的路径：

```bash
read -r -p '粘贴建表前BACKUP_RECEIPT完整路径: ' SCHEMA_BACKUP_RECEIPT
```

备份为完整业务库custom archive，目录0700、文件0600；已校验文件哈希和`pg_restore --list`，**不等于已经做过恢复演练**。迁移/导入必须提供24小时内且属于同集群同业务库的有效备份回执。

### 5.1 原续做命令：仅做建表前备份（因metadata需求确认暂停）

**本次直接运行以下完整块即可，不先重复运行第5节上面的分段示例。**在服务器Bash执行，保持普通SSH用户t7920运行Python，不对整个Python脚本使用sudo。关闭目标库的其他客户端连接；脚本会核对包/集群/目录/监听、业务库和其他会话，有冲突就停止，不强行断开连接。

```bash
if (
  set -uo pipefail
  umask 077
  cd "$HOME/ts-db-m0-20260921" || exit 1

  SYSTEM_ID='7686454253092706426'
  DB_NAME='ee_platform'
  COMMON=(--database "$DB_NAME" --system-id "$SYSTEM_ID")
  RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-before-schema-backup"
  mkdir -p -m 700 "$RUN_LOG" || exit 1
  printf 'RUN_LOG=%s\nDATABASE=%s\nSYSTEM_ID=%s\n' "$RUN_LOG" "$DB_NAME" "$SYSTEM_ID"
  sudo -v || exit 1

  python3 server_step.py backup "${COMMON[@]}" \
    2>&1 | tee "$RUN_LOG/05-before-schema-backup.log" || exit 1
); then
  printf '\nBACKUP STEP FINISHED. Send BACKUP and BACKUP_RECEIPT output; do not run migration yet.\n'
else
  printf '\nSTOP: backup did not complete successfully. Send the output; do not run migration.\n'
fi
```

默认备份目录为`/home/t7920/ts-db-backups`，目录及备份文件权限由脚本限制；本次会生成新的custom dump和对应.backup.json，不覆盖已有备份。仅执行backup，不创建业务表、不导入、不恢复数据库。管道使用pipefail并显式退出；外层if保护交互shell，失败不会继续迁移。

完成后回传完整输出，重点为`BACKUP:`及`BACKUP_RECEIPT:`两条真实绝对路径；不上传dump，也不发送密码。不要复制示例时间或猜测回执文件名。取得用户回传后再提供含实际回执路径的迁移指令；当前不执行第6节。

脚本检查归档目录可读并计算文件SHA-256，备份回执注明restore_drill_done=false；不把备份生成或pg_restore --list成功说成实际恢复演练。出现STOP时保持文件和日志，先诊断，不伪造回执或重算校验值绕过。

## 6. 创建M0的29张业务表

```bash
python3 server_step.py migrate "${COMMON[@]}" \
  --backup-receipt "$SCHEMA_BACKUP_RECEIPT" \
  2>&1 | tee "$RUN_LOG/06-migrate-schema.log"
```

预期结尾：

```text
M0 TABLE/COLUMN CHECK: 29 tables, PASS
MIGRATION COMMITTED: 29 business tables + 1 administrative migration-record table. No AI tables.
```

执行内容：

1. 核对包哈希、集群身份、库名、备份、其他连接和旧schema。
2. 开一个事务，取得迁移咨询锁；设锁等待10秒、语句上限120秒。
3. 创建schema和运维迁移记录表，创建29张业务表。
4. 先建PK/UQ再建FK；只有head/accepted/current循环指针外键设为延迟校验，不把所有FK无条件延迟。
5. 建类型、项目/功能归属、scope精确形状、历史保护等约束；拒绝UNKNOWN绕过可空scope的CHECK。
6. 写SQL SHA-256迁移记录，与DDL一起提交。
7. 回读实际表/字段与包内字典完全一致。

**异常处置：**事务未提交的建表失败会整体回滚。任何错误都停下保存日志，不执行DROP补救，不更改历史SQL校验和“骗过”迁移记录。如果已经成功提交后发现业务问题，应单独准备后续迁移，不直接重写已发布的001文件。

## 7. 再备份，然后把样本写入数据库

### 7.1 导入前备份（现在库里已有空表）

```bash
python3 server_step.py backup "${COMMON[@]}" \
  2>&1 | tee "$RUN_LOG/07-before-seed-backup.log"
read -r -p '粘贴本次导入前BACKUP_RECEIPT完整路径: ' SEED_BACKUP_RECEIPT
```

### 7.2 明确采用独立样本项目后导入

以下命令明确同意第0.3节的样本项目及初始43项均可分配默认；不修改已有项目。若目标不同，停下来调整准备包。

```bash
python3 server_step.py seed "${COMMON[@]}" \
  --backup-receipt "$SEED_BACKUP_RECEIPT" \
  --confirm-project-code XRAY-DVR-SAMPLE \
  2>&1 | tee "$RUN_LOG/08-import-seed.log"
```

导入事务顺序：

1. 登记真实SSH导入操作人（不是创建登录密码或伪造应用用户）。
2. 4种类型及类型schema、最低只读能力/角色。
3. 1个独立项目、1个DVR业务功能、项目成员/只读绑定。
4. 1个项目子系统方案、1个方案版本、43个稳定子系统及43条目录内容。
5. PRD、UC、FR、独立分配的对象身份和正文版本；UC场景、FR来源、分配目标。
6. 记录一次导入审计，保持全部未接受。
7. 触发延迟完整性校验，通过才提交。任何中途错误回滚整批业务关系。

**幂等：**同一包、同一目标、同一导入操作人重跑逐字段核对并复用数据；已有相同ID/业务编号但内容不同、源数据改变或改换操作人，会停止，不`ON CONFLICT DO UPDATE`覆盖旧成果。源码有变化要重新生成并审查新批次，不手工修改已传包。

## 8. 只读验收 + 全回滚约束测试

### 8.1 逐字段验收

```bash
python3 server_step.py verify "${COMMON[@]}" \
  2>&1 | tee "$RUN_LOG/09-verify-content.log"
```

应为`DATABASE CONTENT VERIFICATION: PASS`。验证在只读事务内执行：正文/编号/空白/来源/目录/目标与包逐字段比较，不是仅打印几张表就宣布成功。

| 数据 | 本样本预期 |
|---|---:|
| 项目 / 业务功能 | 1 / 1 |
| PRD / UC / FR / 分配对象 | 1 / 3 / 14 / 14 |
| 对象身份 / 对象版本 | 32 / 32 |
| UC场景子项 | 23＝8个原分支＋15个异常分类 |
| FR→UC来源边 | 16 |
| 子系统稳定身份 / 方案条目 | 43 / 43 |
| 分配目标边 | 14 |
| 已接受版本 / 审阅事件 | 0 / 0 |

43目录中五个规范名称应严格为：低压电源管理系统、感知融合和定位系统、挡位控制系统、X-Call系统、外部设备链接系统。

### 8.2 约束测试（全部回滚，不增加测试业务数据）

```bash
python3 server_step.py smoke "${COMMON[@]}" \
  2>&1 | tee "$RUN_LOG/10-constraint-smoke.log"
python3 server_step.py verify "${COMMON[@]}" \
  2>&1 | tee "$RUN_LOG/11-after-smoke-verify.log"
```

测试覆盖：历史正文不能改、非法项目FK、错误授权scope、只有版本头没有正文、混类型身份、向已提交FR追加来源、无审阅伪造接受，以及一个FR的分配新版可有两个目标。新分配版本/目标最终ROLLBACK，再验原始数据未改变。

这是数据库级冒烟，不是生产并发/完整权限/真实Agent验收。本轮没有后端API和前端保存刷新验收，也不需要先部署其他Agent场景。

## 9. 出错怎么处理，如何续做

### 9.1 只做这些，不自行清库

- 停止后续步骤，保存对应`RUN_LOG`路径和报错；把日志里与问题相关的输出发回，不发密码/连接串/私钥/全库dump。
- 集群身份/路径不符：回到第3步确认目标，不改脚本比较值来绕过检查。
- 同名旧schema：先列旧表/约束/数据，再制定迁移，不DROP重建。
- package checksum失败：重新核对本地包/传输，不删除SHA256SUMS或禁用验证。
- 超过24小时：重新执行backup，不能伪造备份回执时间。
- 不同导入人重跑不一致：继续用第一次导入的SSH操作人，或另行审查身份映射，不UPDATE历史created_by。

### 9.2 重新登录后的变量恢复

```bash
set -Eeuo pipefail
umask 077
cd "$HOME/ts-db-m0-20260921"
read -r -p '已核对的system_identifier: ' SYSTEM_ID
read -r -p '已核对的业务库名: ' DB_NAME
COMMON=(--database "$DB_NAME" --system-id "$SYSTEM_ID")
RUN_LOG="$HOME/ts-db-m0-logs/$(date -u +%Y%m%dT%H%M%SZ)-resume"
mkdir -p -m 700 "$RUN_LOG"
sudo -v
python3 server_step.py inventory "${COMMON[@]}" 2>&1 | tee "$RUN_LOG/resume-inventory.log"
```

然后按日志确认停在哪一步，只运行未完成步骤；成功migrate可安全重查，成功seed重跑为逐字段比对。不要重跑上传解压去覆盖已有包。

### 9.3 回退/恢复边界

建表和导入各有独立事务，失败自动回滚。**成功提交后的回退不自动执行`pg_restore --clean`、DROP或TRUNCATE。**保留第5/7步备份；先把备份恢复到另一个明确命名的验证数据库进行恢复演练、校验并评审切换方案。已有库可能含其他业务，不能直接恢复覆盖。需要恢复时先回传目标与备份信息，另给专门逐步指令。

## 10. 执行记录（根据你的回传更新，不预填成功）

| 步骤 | 状态 | 实际时间 | 目标/日志/结果 |
|---|---|---|---|
| 本地5文件复查、名称确认、编号转换 | 已完成（本地） | 2026-09-21 | 3个缺失引用已删除；14/52处编号；原文件未改 |
| 本地SQL演练 | 已完成（本地隔离） | 2026-09-21 | PGlite内嵌PostgreSQL17.5；DDL/重复导入/逐字段校验/回滚约束测试通过；不是公司PG18验收 |
| 服务器上传、解压与包校验 | 已完成（用户回传载荷校验通过） | 2026-09-21 | 12个文件均OK，PACKAGE CHECK: PASS；CRLF清单问题已解决；压缩包整体SHA对比回传仍未见，不与解压后载荷校验混同 |
| 只读实例与数据库盘点 | 已完成（用户回传并人工核对） | 2026-09-21 | 日志20260921T112106Z-diagnose；集群7686454253092706426；18/main在线；挂载/属主/监听已核对；仅3个系统库，无业务库；普通用户findmnt失败已由sudo只读对照定位 |
| 复用/创建目标业务库 | 已完成（用户确认并回传） | 2026-09-21 | 日志20260921T112858Z-create-db；ee_platform/UTF8，owner=ee_m0_owner/NOLOGIN；仅public、非系统表0行；集群ID一致 |
| 建表前备份 | 暂停，尚无成功回传 | — | 先确认14号metadata需求及修订包；5.1旧续做指令暂不执行 |
| M0建表 | 暂停，未执行 | — | 原包29业务表+1运维表；metadata要求补齐后重新评审和发布，不原地改冻结包 |
| 导入前备份 | 待执行 | — | dump及backup.json路径 |
| 样本导入 | 暂停，未执行 | — | 待metadata定义/新包验证及建表后继续；项目code/ID、操作人、源文件哈希待验 |
| 逐字段验收 | 待执行 | — | 数量+正文+关系，待审阅 |
| 约束测试与回滚后复验 | 待执行 | — | 最后两份日志 |
| 后端/前端联调 | 未开始，本轮后续阶段 | — | 应用账号/认证subject映射/业务API/项目目录/刷新持久化 |

完成后回传`02/04/06/08/09/10/11`对应日志中的结果，我再把这张表更新为实际执行记录。当前不要求你一次跑完；**第一批可以只做到第3步，把实例及库清单回传，确认目标后再继续写入。**

## 11. 本地验证范围与维护约定

- 执行包针对V2.0 M0；3张AI表及其FK/字段没有提前建。SQL改动必须重新测试、冻结并计算哈希；已在服务器应用的001不能原地修改，后续用新版本迁移。
- 本地测试使用PGlite所带PG17.5执行了实际DDL/触发器/数据SQL。服务器历史版本为PG18，因此第8步PG18原生验收仍必须实际执行；未声称已完成服务器兼容性验证。
- 提取器14项单测覆盖编号起始/续编、明确映射、引用删除、23个场景、源文件哈希不变、无伪造接受/AI记录及目标/备份保护。
- Word只转换业务正文和表格，不复制Word版式、页眉图片或其他附件。本批XML正文无图形/修订；未知编号、字段、嵌套表等会停止处理。PRD正文仍以text全文保存。
- 官方技术参考（待服务器执行时按实际版本核对）：PostgreSQL18的`app-psql`、`app-pgdump`、`app-pgrestore`、`sql-createdatabase`和`ddl-constraints`章节。本轮网页检索未获得可用返回，因此没有把远程文档核验标记成功；依据已有设计和本地SQL执行证据编制。
- 本次不会改后端`.env`、现有认证、服务器监听、业务应用进程或前端Mock目录。落库验收完成后，再单独接通真实项目目录和CRUD接口。

