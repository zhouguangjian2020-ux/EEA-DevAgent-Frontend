# PostgreSQL：Ubuntu + SSH 手动安装与配置手册（阶段一）

> 编写日期：2026-09-17；最近更新：2026-09-18。已记录安装、数据盘初始化、挂载保护、HBA 加固、首次启动排障及本地 SQL 验收。**最新结果：服务于 2026-09-17 20:33:36 CST 成功启动；4.3.12 已确认 PostgreSQL 18.6 正常运行、配置无解析错误、十条 HBA 规则均被服务端成功解析，TCP 仅监听 127.0.0.1:5432。下一步仅为 Windows SSH 隧道与 pg_isready 可达性验证（4.3.13），不重复安装、修复、启动或修改服务器配置。** 首次系统盘点为 2026-09-17 15:59:29 CST；实际启动时间以回传 systemd 记录为准，其余未提供精确时刻的操作不臆造时间。
> 执行人：**由你本人手动执行；助手没有连接、检查或修改你的服务器。**  
> 本阶段目标：安装 PostgreSQL 18，建立保守的本机监听与认证配置，验证服务和 SSH 隧道。  
> 本阶段不做：业务建库、建表、schema、业务角色/密码、权限迁移、项目数据导入、后端连接串修改。  
> 适用前提：Ubuntu LTS、systemd、可用的 SSH 与 sudo 权限；**主流程仅面向没有既有 PostgreSQL 集群的新环境**。已有实例必须走盘点/变更方案，不能直接套用。  
> 关联设计：[数据库设计与实施方案 V1.1](数据库设计与实施方案_V1.1.md)。本手册只准备基础环境，不执行设计中的 SQL。

## 0. 先读这页：本阶段做到什么程度

> **当前状态（用户回传，非助手远程验收）**：修复、启动及本地 socket SQL 验收均已完成，**18/main/5432/online/postgres，服务 active(running)，PostgreSQL 18.6，TCP 仅监听 127.0.0.1:5432**。配置文件与数据目录路径、UTF8、SCRAM、时区、SSL、端口均符合预期，十条 HBA 规则无解析错误，所列参数均无需重启（4.3.12）。**当前只执行 4.3.13：Windows SSH 隧道与 `pg_isready` 可达性验证；不修改配置、不重启、不建业务库。** `start.conf` 仍为 `manual`；开机恢复、SSH 隧道和业务角色登录仍未验收，不把本次运行成功等同阶段一全部完成。

**可以通过 SSH 远程安装 PostgreSQL。SSH 是远程执行命令及建立加密通道的工具，不是数据库账号。** 本手册采用“服务器仅本机监听 + 管理电脑 SSH 隧道”，不开放公网数据库端口。[S1][S2]

完成路径：

1. 在 Windows 检查并登录 SSH。
2. 在 Ubuntu 只读盘点系统、磁盘、已有数据库和端口；满足条件才继续。
3. 添加 PostgreSQL 官方软件源，安装明确主版本的包。
4. 初始化指定数据目录并保持 manual/down；回读实例与配置。
5. 先备份配置并配置实例挂载保护、认证范围，再首次启动指定实例并验证本地 SQL。
6. 在 Windows 建立隧道；使用 PostgreSQL 客户端探测全链路。
7. 填写验收单，**停在这里，后面再建业务库**。

### 0.1 “不建库”与安装初始化的区别

安装服务包时，Ubuntu/Debian 的 PostgreSQL 包通常会初始化一个 `main` 集群；初始化包含系统目录，以及 `postgres`、`template0`、`template1` 数据库。这是服务能运行所必需的基础初始化，不是创建我们项目的业务库。[S3][S4]

- 本阶段允许：安装程序正常初始化、读取默认 `postgres` 数据库中的系统信息。
- 安装程序通常也会准备系统用户 `postgres` 和用于管理的数据库超级用户；两者身份体系不同，不等于创建了应用账号。[S3][S4][S7]
- 本阶段不创建：`ee_platform`、`ee` schema、任何 PRD/UC/FR 业务表或应用账号。
- 不向 `postgres` 数据库或 `template1` 写入业务内容。
- 如果你要求“连默认集群都不初始化”，那只能安装软件包而暂不启用服务，也无法完成本手册的可连接验收；这是不同的阶段目标。

### 0.2 不要把四种成功混为一谈

| 检查层次 | 怎么证明 | 本阶段是否验收 |
|---|---|---|
| SSH 登录成功 | Windows 能登录目标 Ubuntu | 是 |
| 数据库实例运行并能执行 SQL | Ubuntu 上通过本地 socket 执行只读查询 | 是 |
| 电脑 → SSH → PostgreSQL 可达 | 隧道后的 `pg_isready` 返回正常 | 是；需本机客户端工具 |
| 业务账号能连接业务库，权限正确 | 应用角色登录指定业务库并做授权测试 | **否，下一阶段** |

**`Test-NetConnection` 成功、`pg_isready` 成功，都不能单独证明业务账号认证成功。** `pg_isready` 检测服务状态，即使用户名/密码不正确，也可能报告服务器接受连接。[S5]

---

## 1. 执行约定与安全边界

### 1.1 每段命令在哪里运行

- **【本机 PowerShell】**：你自己的 Windows 电脑，不是 Ubuntu。
- **【服务器 Bash】**：先用 SSH 登录 Ubuntu，再输入命令。
- **【配置文件内容】**：写到指定文件中，不要当终端命令运行。
- 命令块不带 `$`/`#` 提示符，可以复制，但必须先阅读相邻的前提和预期结果。
- **按小节逐步执行；任何失败先停止，不能整篇全选粘贴。** 一个命令失败后，普通 shell 不保证自动停止后续命令。

### 1.2 本手册有意不做的危险操作

- 不执行全系统升级、重装系统、重启整台服务器。
- 不删除旧 PostgreSQL 包、数据目录、实例或 Docker 卷。
- 不把数据库监听改为 `*`，不开放 `0.0.0.0/0` 数据库入口。
- 不把认证改成 `trust`，不设置/分享 `postgres` 的远程密码。
- 不关闭防火墙，不直接启用一套未经盘点的防火墙规则。
- 不修改 SSH 登录策略、端口或禁止密码登录；不重启 SSH 服务。
- 不执行 `curl ... | bash`；软件源使用 HTTPS 和限定的签名密钥。
- 不安装管理面板、Docker、Redis、图数据库或向量数据库。
- 不把 SSH 私钥、数据库密码、完整连接串发给助手或提交 Git。

### 1.3 开始前你需要准备

| 项目 | 你填写/确认 |
|---|---|
| 服务器 IP 或域名 | `YOUR_SERVER_IP`（必须替换） |
| SSH 端口 | 实际值，下面默认示例 `22` |
| SSH 用户 | 当前系统用户为 `t7920`；后文示例已预填，实际 SSH 登录方式仍沿用你已有配置 |
| SSH 登录方式 | 现有密钥/SSH 配置，或交互密码 |
| 主机指纹 | 通过云控制台或管理员可信渠道确认 |
| Ubuntu 版本/架构 | 已回传：Ubuntu 22.04.5 LTS / jammy；x86_64 / amd64 |
| 服务器用途 | 是否与其他应用共用，是否允许安装/短暂服务操作 |
| 存储 | 已见 `/` 位于 `/dev/sda2`、`/data` 位于 `/dev/nvme0n1p1`；已选 `/data/postgresql/18/main`；当前读写挂载和 fstab 项已核对（4.3.2.1），开机实际恢复、挂载失败保护及其他业务占用仍待验收 |
| 网络出口 | 能访问 Ubuntu 软件源及 PostgreSQL 官方源；受限环境需管理员提供批准的镜像/代理 |
| 应急入口 | 云控制台/VNC/带外终端，避免只有一条 SSH 通路 |

**始终保留一个已经登录的 SSH 窗口作为备用。不要把唯一连接窗口关闭后再试新规则。**

---

## 2. Windows：验证 SSH，进入 Ubuntu

### 2.1 填写参数

**【本机 PowerShell】**

```powershell
$Server = "YOUR_SERVER_IP"
$SshUser = "t7920"
$SshPort = 22

if ($Server -eq "YOUR_SERVER_IP" -or $SshUser -eq "YOUR_SSH_USER") {
    throw "请先填写真实服务器地址；用户名已预填 t7920，若实际登录用户不同请一并修改。"
}
Get-Command ssh
Test-NetConnection -ComputerName $Server -Port $SshPort
```

预期：存在 `ssh` 命令，`TcpTestSucceeded : True`。这一步只检测 SSH 端口，不检测数据库。若 `ssh` 不存在，先按你们电脑管理规范准备 OpenSSH 客户端，不为此安装整套数据库。

### 2.2 登录

**【本机 PowerShell】**

```powershell
ssh -p $SshPort "${SshUser}@${Server}"
```

已有非默认密钥时，使用你现有的密钥路径；例如在命令中增加 `-i "C:\实际路径\私钥文件"`。不要将私钥内容粘贴到终端命令或聊天中。

第一次连接时，先核对服务器主机指纹，确认后才接受。若提示主机身份变化，先核实是否重建过服务器；**不要关闭主机密钥校验或直接删除整个 known_hosts 来绕过**。[S2][S6]

登录成功后命令环境已变为 Ubuntu。SSH 密码/私钥口令、本机账号密码与后面的数据库账号不是同一回事。[S7]

---

## 3. Ubuntu：安装前只读盘点（必做）

### 3.1 系统、权限、磁盘与时间

**【服务器 Bash】**

```bash
cat /etc/os-release
uname -m
dpkg --print-architecture
whoami
id
sudo -v
ps -p 1 -o comm=
df -hT / /var/lib
lsblk -f
free -h
timedatectl status
locale
locale -a
```

逐项确认：

- `ID=ubuntu`，系统使用 systemd；其他系统/容器/WSL 不按本流程继续。
- `sudo -v` 成功；无权限时请管理员处理，不提供绕过办法。
- 可考虑官方源支持的 Ubuntu LTS；本次核对包含 22.04/jammy、24.04/noble、26.04/resolute。以实际部署当天的官方列表及架构支持为准。[S8]
- 持久磁盘有足够空间，记录可用容量；还没确认业务数据量，不把固定内存/磁盘数字写成生产容量保证。
- 时间同步正常；系统时区保持原状。本实例首次启动保留初始化时区，后续如需统一数据库 UTC 再单独确定，不包含在本次加固中。
- 可用 UTF-8 locale。若 locale 失效、报错或不存在合适 UTF-8 环境，先处理系统 locale，再安装；本手册不盲目改全机语言设置。

### 3.1.1 本机实际检查记录（用户已提供）

**证据来源**：用户手动执行第 3.1 节后粘贴的终端输出；`timedatectl` 显示采集时刻为 **2026-09-17 15:59:29（Asia/Shanghai，UTC+08:00）**。以下是该次快照，不代表持续监测；助手未登录服务器。为便于阅读，已还原聊天中的下划线等转义，不改变数值或命令结果。

| 检查项 | 实际结果 | 本次状态/边界 |
|---|---|---|
| 操作系统 | Ubuntu **22.04.5 LTS**，Jammy Jellyfish，`VERSION_ID=22.04` | 已记录 |
| 发行版标识 | `ID=ubuntu`，`ID_LIKE=debian` | 已记录 |
| 发行版代号 | `VERSION_CODENAME=jammy`、`UBUNTU_CODENAME=jammy` | 后续仓库代号应基于实际 jammy，不能照抄其他版本例子 |
| 内核架构 | `uname -m`：`x86_64` | 已记录；未提供 CPU 型号/核心数 |
| 包架构 | `dpkg --print-architecture`：`amd64` | 后续软件源架构依据 |
| 当前用户 | `whoami`：`t7920`；UID/GID 均为 1000 | 已记录；终端提示符主机名为 `t7920`，不等于已知服务器 IP |
| 附属组 | adm、cdrom、sudo、dip、plugdev、lpadmin、lxd、sambashare、docker、ollama（完整 ID 见下方摘录） | 只证明组成员关系；不能据此断定对应服务正在运行 |
| sudo | `sudo -v` 提示输入密码后正常回到提示符，用户输出无错误 | 依据本次回传记录为通过；不记录密码 |
| PID 1 | `systemd` | 已记录 |
| 根目录与 `/var/lib` | 两者都在 `/dev/sda2`，ext4；总量 **439G**，已用 **171G**，可用 **246G**，使用率 **42%** | 这是 `df -hT` 的原值；没有独立 `/var/lib` 挂载 |
| 根分区补充输出 | `lsblk` 显示 `/dev/sda2` 可用 **245.4G**、FSUSE **39%** | 与 df 分别保留，不混算、不推定磁盘异常或采样原因 |
| 数据分区 `/data` | 首次 `lsblk`：可用 **1.6T**、FSUSE **5%**；后续 `df -hT /data`：总量 **1.8T**、已用 **100G**、可用 **1.7T**、使用率 **6%** | 后续快照见 3.1.2；保留各次原值，不混算，不假设可供本项目独占 |
| EFI 分区 | `/dev/sda1`，vfat/FAT32，挂载 `/boot/efi`；可用 504.9M、FSUSE 1% | 已记录，不作为数据库数据盘 |
| 其他块设备 | `sdb` 列出了设备名，但未提供文件系统、容量、挂载信息 | 不推定为空盘，不格式化、不分配给数据库 |
| Snap 挂载 | 输出中存在多项 `/snap/...` 的 loop 设备 | 记录其存在，不逐项重复；不作为数据库数据盘或清理目标 |
| 系统时区 | `Asia/Shanghai (CST, +0800)` | 已记录；不改系统时区，首次启动也不额外改数据库时区 |
| 系统时间 | 本地 `2026-09-17 15:59:29`；UTC/RTC `2026-09-17 07:59:29` | 是回传时刻，不是当前实时值 |
| 时间同步 | `System clock synchronized: yes`，`NTP service: active`，`RTC in local TZ: no` | 本次输出正常，无需据此修改时间服务 |
| 默认 locale | `LANG=en_US.UTF-8`；CTYPE/COLLATE/MESSAGES 为 en_US.UTF-8；其余多项为 zh_CN.UTF-8 | 已记录，无错误输出；不擅自统一系统语言 |
| 可用 UTF-8 locale | `locale -a` 包含 `C.utf8`、`en_US.utf8`、`zh_CN.utf8` 等 | 本次有 UTF-8 locale；未来库编码/排序规则仍需独立核对 |
| 内存与交换空间 | 已补：Mem 总量 **62Gi**、used **17Gi**、available **44Gi**；Swap 总量 **2.0Gi**、used **401Mi**、free **1.6Gi** | 完整字段见 3.1.2；只记录快照，不据此擅自修改内存或 Swap 参数 |

**本次结论：环境信息已部分核实，但尚未达到“确认新环境，可以安装”的放行条件。** 特别是已有集群、容器中数据库、5432 占用、已有软件源、其他业务维护窗口、数据库落盘位置，都不能从第 3.1 节推出。

#### 当前检查进度与剩余确认（不安装或迁移数据）

1. **已完成**：补齐 `free -h` 与 `df -hT /data`，见 3.1.2，无需为补缺再次执行。
2. **已完成主机常规及补充检查**：第 3.2 节已确认 0 个匹配 unit 文件、默认目录不存在、标准路径未显示 PGDG 域名匹配，见 3.2.1 / 3.2.2。**仍待管理员确认**容器/自定义部署；docker/lxd 组成员身份不能代替该确认。
3. **已完成 3.3 本机 UFW 状态检查**，结果为 inactive，见 3.3.1；其他主机/外部网络策略仍待你或管理员说明，不适用的项目可以注明不适用。
4. **数据目录已确认**：使用 `/data/postgresql/18/main`，见 3.4。4.3.2 的挂载与目标路径结果已核对；4.3.4 管理包已安装，自动创建策略已关闭且新模拟通过（4.3.5.1），服务包已实际安装（4.3.6.1），4.3.7 初始化已完成且保持 down，4.3.8 全部回读已完成，首次启动故障已修复，4.3.12 本地 SQL 验收已通过；当前只做 4.3.13 Windows SSH 隧道可达性验证。不先安装默认集群再直接修改 data_directory，不移动或格式化磁盘。
5. `/data` 已挂载不等于它的开机挂载、可靠性、其他业务占用或容量预留已确认。这些需要你/管理员确认；当前记录不视为服务器仅供本项目使用。

**以下只读命令已由用户执行并回传，保留供日后复查；本轮无需重复补交。**

```bash
free -h
df -hT /data
```

#### 原始检查输出摘录（便于以后核对）

<details>
<summary>展开查看用户回传的第 3.1 节关键输出</summary>

```text
$ cat /etc/os-release
PRETTY_NAME="Ubuntu 22.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="22.04"
VERSION="22.04.5 LTS (Jammy Jellyfish)"
VERSION_CODENAME=jammy
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=jammy

$ uname -m
x86_64
$ dpkg --print-architecture
amd64
$ whoami
t7920
$ id
uid=1000(t7920) gid=1000(t7920) groups=1000(t7920),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev),122(lpadmin),135(lxd),136(sambashare),139(docker),999(ollama)
$ sudo -v
[sudo] password for t7920:
[输入密码后回到终端提示符；未提供密码内容，未显示错误]
$ ps -p 1 -o comm=
systemd

$ df -hT / /var/lib
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda2      ext4  439G  171G  246G  42% /
/dev/sda2      ext4  439G  171G  246G  42% /

$ lsblk -f
[记录注释：各 /snap/... 的 loop 挂载项省略；以下保留磁盘分区、UUID 与挂载信息]
NAME FSTYPE FSVER LABEL UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
sda
├─sda1
│    vfat   FAT32       F2CA-822D                             504.9M     1% /boot/efi
└─sda2
ext4   1.0         9a719415-45fc-4480-979d-f415f3f90b67  245.4G    39% /
sdb
nvme0n1
│
└─nvme0n1p1
ext4   1.0         7a36a8d0-78cb-4385-8660-ebd3522bfaf5    1.6T     5% /data

$ timedatectl status
Local time: 四 2026-09-17 15:59:29 CST
Universal time: 四 2026-09-17 07:59:29 UTC
RTC time: 四 2026-09-17 07:59:29
Time zone: Asia/Shanghai (CST, +0800)
System clock synchronized: yes
NTP service: active
RTC in local TZ: no

$ locale
LANG=en_US.UTF-8
LANGUAGE=
LC_CTYPE="en_US.UTF-8"
LC_NUMERIC=zh_CN.UTF-8
LC_TIME=zh_CN.UTF-8
LC_COLLATE="en_US.UTF-8"
LC_MONETARY=zh_CN.UTF-8
LC_MESSAGES="en_US.UTF-8"
LC_PAPER=zh_CN.UTF-8
LC_NAME=zh_CN.UTF-8
LC_ADDRESS=zh_CN.UTF-8
LC_TELEPHONE=zh_CN.UTF-8
LC_MEASUREMENT=zh_CN.UTF-8
LC_IDENTIFICATION=zh_CN.UTF-8
LC_ALL=

$ locale -a
C
C.utf8
en_AG
en_AG.utf8
en_AU.utf8
en_BW.utf8
en_CA.utf8
en_DK.utf8
en_GB.utf8
en_HK.utf8
en_IE.utf8
en_IL
en_IL.utf8
en_IN
en_IN.utf8
en_NG
en_NG.utf8
en_NZ.utf8
en_PH.utf8
en_SG.utf8
en_US.utf8
en_ZA.utf8
en_ZM
en_ZM.utf8
en_ZW.utf8
POSIX
zh_CN.utf8
zh_SG.utf8
```

注：提示符统一省略为 `$`，排版已规整；Snap loop 明细省略，存在该类挂载已在汇总表记录。方括号内容为记录注释，不是原始系统输出。首次回传未包含 `free -h`；后续真实输出另记于 3.1.2，不填进首次快照。

</details>

### 3.1.2 内存与数据盘补充记录（用户已提供）

**补录日期：2026-09-17；具体命令执行时间未提供。** 以下是用户后续回传的实际输出，补齐原来的内存和数据分区总量缺项；不是助手远程读取，也不替换首次 `lsblk` 快照。

| 项目 | 本次输出 |
|---|---|
| 内存 total / used | **62Gi / 17Gi** |
| 内存 free / shared | **1.1Gi / 385Mi** |
| 内存 buff/cache / available | **43Gi / 44Gi** |
| Swap total / used / free | **2.0Gi / 401Mi / 1.6Gi** |
| 数据设备 / 文件系统 / 挂载点 | **`/dev/nvme0n1p1` / ext4 / `/data`** |
| `/data` Size / Used / Avail / Use% | **1.8T / 100G / 1.7T / 6%** |

**记录口径**：`free` 与 `available` 是输出中的不同列，两者都保留；不把 free=1.1Gi 单独作为“只能给数据库 1.1Gi”的结论。首次 `lsblk` 的 1.6T/5% 与后续 `df` 的 1.7T/6% 分开记录，不根据不同输出推算数据增减或格式化状态。不因这次资源快照就设置 shared_buffers、禁用 Swap，或宣称已完成生产容量验证。

```text
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            62Gi        17Gi       1.1Gi       385Mi        43Gi        44Gi
Swap:          2.0Gi       401Mi       1.6Gi

$ df -hT /data
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/nvme0n1p1 ext4  1.8T  100G  1.7T   6% /data
```

- [x] 内存与交换空间输出已补齐。
- [x] `/data` 总量、使用量和可用量已补齐。
- [x] ~~数据目录待选择~~ → 用户已同意 `/data/postgresql/18/main`，详见 3.4。
- [x] 当前挂载、fstab 配置及目标路径现状已回传，见 4.3.2.1。
- [x] 初始化输出已确认成功，18/main 位于选定数据盘且为 down（4.3.7.1）。
- [x] 初始化后的 manual/数据路径/监听配置、PG_VERSION、目录属主/权限及无 5432 监听已回传（4.3.8.1）。
- [ ] 剩余认证/SSL/systemd 回读、服务挂载失败保护及实际开机恢复尚未验收。
- [ ] 目标磁盘持续挂载、备份位置、既有业务占用和维护窗口仍需确认。

### 3.2 是否已经有 PostgreSQL

**【服务器 Bash】**

```bash
command -v psql || true
command -v pg_lsclusters || true
if command -v pg_lsclusters >/dev/null 2>&1; then
    pg_lsclusters
fi
dpkg -l 'postgresql*' 2>/dev/null
systemctl list-units --all 'postgresql*' --no-pager
sudo ss -lntp 'sport = :5432'
sudo ls -ld /etc/postgresql /var/lib/postgresql 2>/dev/null
sudo grep -Rns 'apt.postgresql.org' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null
```

“文件不存在”“没有匹配包/实例”在新环境中可能正常。检查结果必须人工判断，不能只看某一行空输出。

**出现以下任一情况，停止主流程：**

1. 已有运行或停止的数据库集群、非空数据目录、历史数据库服务。
2. 5432 被任何进程占用，或者数据库实际运行在容器/其他端口。
3. 已经有 PGDG 软件源、第三方 PostgreSQL 软件源，无法确定由谁维护。
4. 服务器有现有业务，但没有安装/重启维护窗口。

只有客户端工具而没有服务，不一定冲突，但仍需检查软件源和依赖。Docker/Kubernetes 或非标准路径中的实例未必会被上述命令列出，应向管理员确认。**不要用“卸载再装”“删目录”解决不明情况。**

### 3.2.1 本机实际盘点记录（用户已提供）

**记录日期：2026-09-17。** 来源为用户手动执行第 3.2 节后粘贴的连续输出，主机提示符为 `t7920@t7920`；未提供具体执行时间、逐条退出码。助手未连接服务器。下面的“未显示”仅指这次回传范围，不能扩展为全盘、所有命名空间或历史数据均不存在。

| 检查 | 本次可见结果 | 记录结论 |
|---|---|---|
| `command -v psql` | 没有路径输出 | 当前命令搜索路径未发现 psql；不排除其他自定义目录 |
| `command -v pg_lsclusters` 与条件执行 | 没有路径/集群输出 | 当前搜索路径未发现该工具；条件分支不能据此证明“工具运行后返回空集群” |
| `dpkg -l 'postgresql*'` | 仅 `un postgresql-pgmp <none> <none>` | 本次未列出已安装的 PostgreSQL 包；`un` 不是已安装，也不是安装失败提示，详见下文 [S19] |
| `systemctl list-units --all 'postgresql*'` | `0 loaded units listed.` | 首次未见匹配的已加载 unit；后续 list-unit-files 已补，结果同样为 0，见 3.2.2 [S20] |
| `sudo ss -lntp 'sport = :5432'` | 只有列标题，没有监听行 | 本次主机查询未显示 TCP 5432 监听；不排除其他端口、其他网络命名空间或停止的实例 |
| 默认目录 `/etc/postgresql`、`/var/lib/postgresql` | 首次无输出；补充 ls 明确为 `No such file or directory` | 这两个默认路径本次不存在，已消除首次屏蔽 stderr 的歧义；不外推到自定义目录 |
| 标准 APT 配置中的 `apt.postgresql.org` | 首次无输出；补充不隐藏 stderr 的 grep 仍无输出，未回传读取错误 | 标准路径未显示该域名匹配；未取得退出码，不外推到其他镜像域名/非标准源位置 |

#### 关于 `un postgresql-pgmp`：无需把它当作已装数据库去卸载

`dpkg -l` 的前两列分别表示期望动作和当前包状态：`u` 是 Unknown，`n` 是 Not-installed。因此这行表示该名称被查询列出，但**没有安装该包**；不能把看见 `postgresql` 字样就当成已安装服务。[S19]

**本次结论：主机常规检查已记录，尚未发现需要立即处理的 PostgreSQL 安装/5432 占用迹象。无需执行卸载、删除目录或停止服务；安装放行仍需完成后面的检查。**

#### 安装前补充核对命令（已回传，结果见 3.2.2）

**以下命令已由用户手动执行，保留供复查，不再作为本轮待补项。**

```bash
systemctl list-unit-files 'postgresql*' --no-pager
sudo ls -ld /etc/postgresql /var/lib/postgresql
sudo grep -Rns 'apt.postgresql.org' /etc/apt/sources.list /etc/apt/sources.list.d
```

- 补充结果已经明确两个默认目录不存在；这是记录结果，不要求创建它们来消除提示。
- 如果列出 PostgreSQL unit 文件、源配置或已有目录，先核对用途，不直接覆盖。
- 请你/管理员确认是否曾通过 Docker/LXD、其他端口或自定义目录部署 PostgreSQL，是否有停止的实例/历史数据需要保留。本轮不要求启动容器服务、扫描全盘或清理卷。
- `free -h`、`/data` 容量与 3.3 的 UFW 状态均已回传。选盘、当前挂载和 fstab 配置已确认；仍需核对启动保护、容器/自定义部署、其他适用网络策略及维护条件；**本条记录不是第 4 节安装已完成或已具备全部条件的结论。**

#### 用户回传原始输出

下方保留原始输出内容，去掉聊天传输的转义符；前面没有输出的命令不能被误读为执行了空结果的集群查询。

```text
Desired=Unknown/Install/Remove/Purge/Hold
| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend
|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)
||/ Name            Version      Architecture Description
+++-===============-============-============-=================================
un  postgresql-pgmp <none>       <none>       (no description available)
 UNIT LOAD ACTIVE SUB DESCRIPTION
0 loaded units listed.
To show all installed unit files use 'systemctl list-unit-files'.
State   Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process
```

### 3.2.2 服务文件、目录与软件源补充记录（用户已提供）

**补录日期：2026-09-17；具体执行时间和逐条退出码未提供。** 本次目录/源命令不再隐藏 stderr，结果如下：

| 补充检查 | 用户回传 | 结论 |
|---|---|---|
| `systemctl list-unit-files 'postgresql*' --no-pager` | `0 unit files listed.` | 本次主机未列出名称匹配 postgresql* 的 unit 文件；已完成原先未加载服务文件的补查 |
| `/etc/postgresql` | `No such file or directory` | 默认配置目录不存在；不需要为“修复检查”提前创建 |
| `/var/lib/postgresql` | `No such file or directory` | 默认数据目录不存在；不是权限不足提示 |
| 标准 APT 路径检索 PGDG 域名 | 无输出，未回传错误 | 当前没有显示 `apt.postgresql.org` 匹配；不能据此排除其他镜像域名 |

结合 3.2.1 的包、PATH、服务和主机监听结果，**目前没有发现主机常规 PostgreSQL 安装的冲突迹象**。这些检查项目已完成，不再要求重复执行。容器、停止的卷、自定义路径/命名服务等仍需你或管理员确认；不通过卸载、清目录或启动未知服务来验证。

```text
$ systemctl list-unit-files 'postgresql*' --no-pager
UNIT FILE STATE VENDOR PRESET

0 unit files listed.

$ sudo ls -ld /etc/postgresql /var/lib/postgresql
ls: cannot access '/etc/postgresql': No such file or directory
ls: cannot access '/var/lib/postgresql': No such file or directory

$ sudo grep -Rns 'apt.postgresql.org' /etc/apt/sources.list /etc/apt/sources.list.d
[记录注释：本次回传无匹配行，也没有显示错误；未提供退出码。]
```

- [x] PostgreSQL 名称匹配的 unit 文件补查完成。
- [x] 默认目录存在性补查完成，结果为两个目录均不存在。
- [x] 不隐藏 stderr 的 PGDG 域名检索已回传，无可见匹配/错误。
- [x] 3.3 的本机 UFW 状态已回传，见 3.3.1。
- [ ] 其他适用网络策略、容器/自定义部署及维护条件仍待确认；路径选择、当前挂载和 fstab 配置已核对，启动保护尚未实施。

### 3.3 防火墙与外部安全组只做盘点

**【服务器 Bash】**

```bash
if command -v ufw >/dev/null 2>&1; then
    sudo ufw status verbose
    
else
    printf '%s\n' '未检测到 ufw；不要据此认定没有其他防火墙。'
fi
```

在云控制台/公司网络策略中另外确认：

- 现有 SSH 入口允许你的管理来源；不要扩大成所有来源。
- 没有给数据库新增公网 5432 入站规则。
- 如果历史上已有广泛开放规则，交管理员按变更流程收紧，不在本安装手册中直接删除可能被其他服务使用的规则。
- 发现 UFW 未启用时，不要直接执行 enable；先确认 SSH 和其他既有服务的放行策略及应急入口。[S9]

### 3.3.1 本机 UFW 状态记录（用户已提供）

**补录日期：2026-09-17；用户未提供精确命令执行时间。** 来源为用户手动执行第 3.3 节检查后的输出，助手未登录或修改服务器。

| 检查项 | 用户回传/记录结论 |
|---|---|
| UFW 命令分支 | 执行后返回 UFW 状态，而不是“未检测到 ufw”提示；已检测到该命令 |
| UFW 当前状态 | **`Status: inactive`，本次检查时未启用** |
| 本机 UFW 状态检查 | **已完成**，不再列为待补输出 |
| 其他主机防火墙/网络规则 | 未提供检查结果，不能由 UFW 状态推定全部不存在 |
| 云安全组、上游网关、VPN/公司网络策略 | 环境是否涉及这些设施及其策略尚未说明；没有对应设施时可由用户/管理员注明“不适用” |
| PostgreSQL 公网可达性 | 本次没有进行外部访问测试，不能据此判定“全部端口开放”或“5432 已暴露” |

#### 执行输出

```text
$ if command -v ufw >/dev/null 2>&1; then
    sudo ufw status verbose
else
    printf '%s\n' '未检测到 ufw；不要据此认定没有其他防火墙。'
fi
Status: inactive
```

#### 本次处理决定

- **记录现状，不改动它。** 本手册不会因为 inactive 就自动增加启用 UFW 的操作，也不会执行 disable、reset 或修改 SSH 放行规则。
- 不要为使检查“通过”而直接运行 `sudo ufw enable`；若你们需要启用或调整防火墙，先由管理员核对既有 SSH/业务入口和应急方案，单独安排变更。
- 继续保留本手册既定方案：PostgreSQL 仅监听服务器本机，通过 SSH 隧道进行管理，不新增公网 5432 放行。该方案尚未执行，不能写成已经生效。
- 这里完成的是**状态盘点**，不是整台服务器安全策略验收，也不是数据库已部署的证明。

#### 安装前剩余确认

1. **容器/自定义部署**：是否有 Docker/LXD 或非标准路径中的 PostgreSQL、停止的实例/历史卷需要保留。
2. **数据库落盘位置已确认**：`/data/postgresql/18/main`，见 3.4。当前读写挂载、fstab UUID 及目标目录不存在均已核对（4.3.2.1）；服务挂载失败保护仍待实施，不移动既有数据。
3. **运维与网络边界**：是否允许本次安装、目标磁盘持续挂载及其他业务占用；其他主机/外部访问策略由你或管理员确认，确实不适用的项目注明即可。

这些事项仍未由回传输出回答；不需要重复执行已经补齐的 3.1、3.2 和本机 UFW 检查。助手本轮只更新本地文档，没有执行任何服务器命令。

**正式安装服务包前的通过条件：系统/架构可支持、权限足够、磁盘可靠、没有既有集群冲突、SSH 可恢复，且已核对软件源优先级/依赖计划。** 4.1 工具准备已由用户执行；这不代替尚未完成的前置确认。

---

### 3.4 数据目录选择：`./postgreSQL`、`/postgreSQL` 与 `/data`

**2026-09-17 用户先询问根目录下 `./postgreSQL`，在目录比较和 `/data` 访问说明之后回复“我同意”；现记录为同意推荐路径 `/data/postgresql/18/main`。目录选择已完成；当时尚未部署，后续软件包安装及所选目录初始化现均已完成（4.3.6.1 / 4.3.7.1），没有进行数据迁移。** 本节所说的目录是数据库实际数据文件目录（PGDATA），不是把 APT 安装的程序、配置、日志全部集中到一个文件夹。

#### 先区分路径含义

| 写法 | 含义 | 对本次部署的判断 |
|---|---|---|
| `./postgreSQL` | 当前工作目录下的子目录；不是固定的系统根路径 | 用户提示符显示 `~`，通常会指向 `/home/t7920/postgreSQL`，准确结果取决于当前目录；服务配置不建议使用这种相对路径 |
| `/postgreSQL` | 系统根目录 `/` 下的一个目录 | 技术上可配置；若没有单独挂载或符号链接，仍使用根文件系统，不会自动使用 `/data` 数据盘 |
| `/root/postgreSQL` | root 用户家目录内的子目录 | 与系统根目录不同；不建议把数据库数据放在这里，不为此放宽 `/root` 权限 |
| `/var/lib/postgresql/18/main` | Ubuntu/Debian 包管理下的常见默认数据目录 | 部署步骤最简单；按已回传布局，使用根盘 `/dev/sda2` [S3] |
| `/data/postgresql/18/main` | 已挂载 `/data` 数据盘下的专用目录 | **用户已确认使用；当前挂载及 fstab 配置已核对，启动保护待实施** |

路径以 `/` 开头才是绝对路径，`.` 代表当前目录。[S27] 建议目录统一使用小写 `postgresql`；`18` 标识主版本，`main` 标识集群，方便以后区分不同实例。混合大小写本身不是不能使用，只是容易在手写命令时混淆。

#### 为什么更推荐 `/data/postgresql/18/main`

1. **利用已存在的数据盘**：用户回传 `/data` 位于 `/dev/nvme0n1p1`、ext4，补充 `df` 显示总量 1.8T、可用 1.7T。根盘 `/dev/sda2` 的早期回传为总量 439G、可用 246G。这里只比较用户采集时的容量，不代表持续监测结果。
2. **减少与根盘竞争空间**：在挂载正常、数据确实写入该盘的前提下，数据库增长不会直接消耗根盘的数据空间；配置、系统日志等仍可能使用根盘。这不等于已经具备备份、磁盘冗余或故障保护。
3. **路径清晰**：`/data` → `postgresql` → `18` → `main`，将服务数据与用户家目录、项目源代码分开。PostgreSQL 官方建议独立卷的数据目录放在挂载点下的专用子目录，而非直接把挂载点本身作为 PGDATA。[S26]
4. **不把 NVMe 名称当性能保证**：真实吞吐、磁盘健康、掉电保护、其他服务占用都没有测量，不据此承诺性能或生产可靠性。

**以下根盘说明保留作方案比较，不是当前实施路径。** 如果以后明确改用根盘，也可以。 此时更建议沿用 `/var/lib/postgresql/18/main`，而不是为了路径短另建 `/postgreSQL`。若仍坚持自定义根目录，建议组织为 `/postgreSQL/18/main`；这只是命名与管理建议，不代表已确定或已创建该路径。

#### 选择自定义数据目录后的实施约束（现在不执行）

- 使用绝对路径；数据目录由专用系统用户 `postgres` 管理，采用严格权限（通常 `0700`），不由普通 SSH 用户长期持有，不设为 `777`。不要递归更改整个 `/data` 的权限。[S3][S26]
- APT 安装的程序、配置及日志保留包管理布局；例如集群配置通常位于 `/etc/postgresql/18/main`，不把所有文件一并搬进 PGDATA。[S3]
- `/data` 当前挂载与 fstab 配置已核对，含 `defaults,nofail`。保留现有 fstab；初始化前复核实际挂载，首次启动前为目标实例设置挂载依赖及挂载点检查。服务保护和实际重启恢复尚未验收，不能把本次读取配置当成已生效的数据库保护。[S29][S30]
- PostgreSQL 服务包通常会自动初始化默认集群；本次改为先准备 `postgresql-common` 并控制默认集群创建，再安装服务包、显式初始化自定义目录；实施顺序见 4.3.3。管理包准备及自动创建开关设置已完成（4.3.4.1 / 4.3.5.1），服务包也已安装（4.3.6.1）；自定义初始化也已完成（4.3.7.1）；配置回读、启动保护和首次启动仍未完成。[S3]
- 不采用“先自动建默认集群，再直接修改 `data_directory`”的做法；不删除集群、不移动既有数据、不改挂载或格式化磁盘。

**已确认：绝对数据目录为 `/data/postgresql/18/main`。** 不再询问选盘，不创建根目录下 `/postgreSQL`。4.3.2 已回传，4.3.4 管理工具已准备完成，4.3.5 已完成，4.3.6 已完成，4.3.7 初始化也已完成，4.3.8 全部回读已完成，4.3.9 配置脚本已完成，首次启动已失败，现已修复并 online，4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证；服务已由用户手动启动成功（4.3.11.1），业务建库仍不涉及。

---

## 4. 安装 PostgreSQL 18（确认是新环境后）

采用官方 PGDG APT 源，明确安装 `postgresql-18`，而不是不带主版本的元包。本次不固定某个补丁号，实际版本以安装时经过签名验证的软件源候选包为准。[S8]

### 4.1 更新包索引并安装下载工具

**【服务器 Bash】**

```bash
sudo apt update
sudo apt install ca-certificates curl
```

每条命令成功后再继续。`apt update` 是更新包索引，不是全系统升级；但安装依赖仍可能触发包维护脚本及服务提示，先阅读 apt 的变更清单，发现非预期移除/重启则停止。不要删除 apt 锁文件，不在另一个升级事务运行时强行安装。

### 4.1.1 本机 APT 准备执行记录（用户已提供，已完成）

**补录日期：2026-09-17；具体执行时间及退出码未提供。** 来源为用户上传的 `pasted-text.txt`，助手只读取附件、更新本地文档，没有通过 SSH 执行命令。

完整原始日志已原样保存：[4.1 APT 准备用户回传](records/4.1_APT准备_用户回传_2026-09-17.txt)。日志里的自动提示仅作为输出证据，**不是要求继续升级或删除软件包的指令**。

| 检查项 | 实际输出 | 记录结论 |
|---|---|---|
| `sudo apt update` | 下载 37.4 MB，1min 31s；package lists / dependency tree / state information 均完成 | 本次包索引更新输出正常，附件未见 E:/W:/Err:；未提供退出码，不补写 exit=0 |
| `ca-certificates` | `20260601~22.04.1`，APT 报 already the newest version | 已安装；“最新”仅按此次配置源/索引判断，不是全网版本结论 |
| `curl` | `7.81.0-1ubuntu1.27`，APT 报 already the newest version | 已安装，无需为完成 4.1 再次安装 |
| 包安装状态标记 | `ca-certificates set to manually installed.` | APT 将此包标为手动安装；不能把 0 个包升级误写成系统完全没有变化 |
| 本次软件包操作汇总 | `0 upgraded, 0 newly installed, 0 to remove and 112 not upgraded.` | 未升级、新装或移除软件包；仍有 112 个可升级项 |
| 自动清理提示 | libfwupd2、libfwupdplugin5、libgcab-1.0-0、libsmbios-c2 | 只是 APT 的建议清理列表，本轮不执行 autoremove |
| Ubuntu 源 | 阿里云镜像的 jammy / jammy-security / jammy-updates / jammy-backports，以及 **jammy-proposed** | 已记录当前索引获取范围；proposed 需检查现有选包策略，见 4.1.2 |
| CUDA / NVIDIA 源 | `file:/var/cuda-repo-ubuntu2204-12-6-local` 与 NVIDIA CUDA 网络源 | 已有源，不能随数据库准备任务删除/替换；不据此推定 GPU 服务正在运行 |
| PostgreSQL 安装进度 | 本附件只有 apt update 与 ca-certificates/curl 准备 | **没有 PostgreSQL 安装成功的证据，也没有 PGDG 源添加完成的证据** |

**4.1 判定：已完成。** 不需要重复执行这两条命令。`apt update` 更新包信息，真正升级是其他动作；112 个待升级包不表示本轮发生了升级，也不要求现在升级。自动删除是另一个会移除软件包的操作，本手册不把它当作后续安装的必要步骤。[S21]

关键输出摘录：

```text
Fetched 37.4 MB in 1min 31s (412 kB/s)
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
112 packages can be upgraded. Run 'apt list --upgradable' to see them.

ca-certificates is already the newest version (20260601~22.04.1).
ca-certificates set to manually installed.
curl is already the newest version (7.81.0-1ubuntu1.27).
The following packages were automatically installed and are no longer required:
  libfwupd2 libfwupdplugin5 libgcab-1.0-0 libsmbios-c2
Use 'sudo apt autoremove' to remove them.
0 upgraded, 0 newly installed, 0 to remove and 112 not upgraded.
```

- [x] 包索引更新结果已回传，未显示更新错误。
- [x] ca-certificates 与 curl 已安装，4.1 准备完成。
- [x] 原始日志已归档；未把自动清理/升级提示当作执行要求。
- [x] 4.2 的参数确认与密钥下载已回传，详见 4.2.1。
- [x] 4.2 源文件已创建，PGDG 索引与候选已正常回传，见 4.2.3。
- [x] 4.3 包查询的找不到包问题已解决；两个包均有 PGDG 候选。
- [x] 4.3 修复后的完整依赖模拟已回传并核对，见 4.3.1；**未进行真实安装**。

### 4.1.2 本次新增的安装前核对项：jammy-proposed

日志明确获取了 `jammy-proposed` 的索引。Ubuntu 官方将 proposed 用于预发布更新测试，并对 Ubuntu 22.04 及更早版本说明了通过优先级配置进行选择性安装的做法。[S22]

这不意味着机器已经安装了 proposed 版本，也不意味着本次更新失败；是否会影响下一次选包，需要查看现有 APT 优先级、候选版本和实际依赖计划。**不能仅凭源名称就断言服务器已损坏，或直接删源/降级。**

下面两条读取包策略的命令**现已由用户执行并回传**，结论见 4.1.3，本轮不再要求重复补交。`apt-cache policy` 用于查看源/包优先级，不执行软件安装、升级或删除。[S23]

**【服务器 Bash，由你手动执行】**

```bash
apt-cache policy
apt-cache policy ca-certificates curl
```

- 两条输出均已记录；源优先级已知，但 PostgreSQL 及其依赖的选包计划仍待 PGDG 配置后核对，不要求全系统升级。
- 不直接启用、禁用或重写 proposed 的 pinning，更不能照搬参考资料中的启用/回滚示例；先查现有管理员策略。
- 不改已有 CUDA/NVIDIA 源，不执行 autoremove 来“清理安装环境”。
- 之后在 4.3 使用明确带 `--simulate` 的命令查看 PostgreSQL 依赖计划，再人工确认是否涉及非预期来源、删除或系统级升级。
- 数据库放盘、容器/自定义部署、适用网络策略等原有确认项仍保留；4.1 完成不会自动替它们作出决定。

### 4.1.3 已回传的 APT 优先级与工具候选版本

**补录日期：2026-09-17；精确执行时间/先后关系未提供。** `apt-cache policy` 完整输出来自用户附件，两个工具的策略来自同条用户消息；全局输出已原样保存：[APT 优先级原始日志](records/4.1.3_APT优先级_用户回传_2026-09-17.txt)。

| 源/状态 | 本次显示优先级 | 记录 |
|---|---:|---|
| jammy、jammy-security、jammy-updates | **500** | 输出中的相应 Ubuntu 条目 |
| jammy-proposed | **500** | 与上述通道同优先级，未从本次全局输出看到较低的 proposed 源优先级 |
| jammy-backports | **100** | 记录原值 |
| NVIDIA CUDA 网络源与本地 CUDA 源 | **600** | 保留管理员既有配置，不自动修改 |
| `/var/lib/dpkg/status` | **100** | 记录已安装状态条目的优先级，不是远程软件源 |
| PGDG 条目（本节早期快照） | **当时未出现** | 保留历史快照；后续 PGDG 索引/候选已成功，见 4.2.3，不再作为当前缺失状态 |
| `Pinned packages:` | 标题后为空 | 仅记录输出，不据此推断 preferences 文件不存在或完全没有通用规则 |

| 工具 | Installed | Candidate | 当前版本表列出的通道 |
|---|---|---|---|
| ca-certificates | `20260601~22.04.1` | `20260601~22.04.1` | jammy-security / jammy-updates，优先级 500 |
| curl | `7.81.0-1ubuntu1.27` | `7.81.0-1ubuntu1.27` | jammy-security / jammy-updates，优先级 500 |

**已确认**：这两项工具的已装版本与候选相同，当前版本表未列出它们的 proposed 候选。这里只说明当前版本可由列出的通道提供，不把 policy 当作历史下载来源证明，更不外推为其他所有包都未使用 proposed。

**仍需注意**：APT 在依赖等约束下按优先级选择版本；同一包的多个可选版本优先级相同时，会优先选择版本号更高的版本。因此 proposed=500 并不意味着“仅显式指定时才会用”；之后应检查 PostgreSQL 与依赖的实际候选和模拟计划。[S25]

本次不立即改全局 pinning，不禁用源，不降级现有包。先补齐 PGDG 源文件与索引检查，再在 4.3 模拟安装；发现拟从 proposed 引入的依赖或非预期 CUDA/系统包变动，暂停核对。不需要重复收集本节这两条 policy 输出，除非源或策略后来发生改变。

- [x] 源优先级已回传并记录。
- [x] ca-certificates / curl 已装版本与候选版本已核对。
- [x] PostgreSQL 候选及完整依赖模拟计划已回传，见 4.2.3 / 4.3.1；本次列出的来源未显示 proposed，未修改源策略。

### 4.2 添加受限签名密钥与软件源

> **当前进度：本节已完成。用户已回传源文件、PGDG 索引与两项包候选，见 4.2.3；4.2.2 故障已解决，请勿重复下载密钥或创建源文件。该模拟、安装及初始化现也已完成，现已修复且成功启动，4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，不重复本节命令。**

**【服务器 Bash】**：先确认当前代号和架构。

```bash
. /etc/os-release
printf 'ID=%s VERSION=%s CODENAME=%s ARCH=%s\n' "$ID" "$VERSION_ID" "$VERSION_CODENAME" "$(dpkg --print-architecture)"
```

如果不是官方支持的 Ubuntu 版本/架构，停止。不要把旧系统的代号硬改成 `noble` 来骗过仓库。

确认第 3.2 节没有既有 PGDG 源或密钥配置需要保留，再执行：

```bash
sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
sudo curl --fail --show-error --location --proto '=https' --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
```

下载失败就停下，不能继续创建一个引用空密钥文件的源。不要用 `curl -k`、`trusted=yes` 或禁用 APT 签名验证绕过问题。[S8]

下一段会新建 `/etc/apt/sources.list.d/pgdg.sources`；如果已存在会停止，不覆盖：

```bash
(
    set -eu
    . /etc/os-release
    test "$ID" = ubuntu
    : "${VERSION_CODENAME:?无法读取 Ubuntu 代号}"
    ARCH=$(dpkg --print-architecture)
    sudo test -s /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    if sudo test -e /etc/apt/sources.list.d/pgdg.sources; then
        printf '%s\n' 'pgdg.sources 已存在，请人工核对，不重复创建。' >&2
        exit 1
    fi
    sudo tee /etc/apt/sources.list.d/pgdg.sources >/dev/null <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${VERSION_CODENAME}-pgdg
Architectures: ${ARCH}
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
)
```

这里括号内的 `set -eu` 只对该段生效；任一校验失败会停止该段，不会主动注销你的 SSH 会话。

### 4.2.1 参数确认与密钥下载记录（早期快照，后续已完成见 4.2.3）

**补录日期：2026-09-17；精确执行时间未提供。** 本节依据用户消息中的终端输出，未连接服务器。转贴中的断行/提示符混入不作为新的命令执行；按明确可读的实际结果记录。

| 子步骤 | 实际证据 | 状态 |
|---|---|---|
| 系统参数确认 | `ID=ubuntu VERSION=22.04 CODENAME=jammy ARCH=amd64` | 已完成；源应对应 `jammy-pgdg` / `amd64` |
| 密钥目录准备 | 已执行 `sudo install -d -m 0755 /usr/share/postgresql-common/pgdg`，未显示错误 | 已回传；未另做目录属性读回，不补造权限验收 |
| 密钥下载 | 官方 HTTPS 地址，curl 显示 `100 4812 100 4812` | 下载进度完成，收到 **4812 字节**；本次没有回传文件内容/指纹或单独退出码 |
| 源文件写入 | 曾报告不存在；最新已回传 6 行正确配置 | **已完成**，见 4.2.3；旧故障保留在 4.2.2 |
| PGDG 索引/签名检查 | 最新 apt update 成功获取 jammy-pgdg InRelease 与 amd64 Packages，未显示签名/下载错误 | **本次索引检查通过**，见 4.2.3；不额外声称做了密钥指纹独立核验 |
| PostgreSQL 包候选 | 最新两个包 Candidate 均为 18.6-1.pgdg22.04+2，源为 jammy-pgdg/main amd64 | **候选检查通过**；不等于已安装 |
| PostgreSQL 安装（历史与后续） | 早期找不到包已解决；候选阶段曾为 Installed=(none) | 软件包已安装（4.3.6.1），集群已初始化但未启动（4.3.7.1），不新建业务库 |

关键输出摘录（来自用户消息，不修造被截断的命令）：

```text
ID=ubuntu VERSION=22.04 CODENAME=jammy ARCH=amd64

% Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
Dload  Upload   Total   Spent    Left  Speed
100  4812  100  4812    0     0   5190      0 --:--:-- --:--:-- --:--:--  5185
```

#### 通用后续流程（本机源与候选已通过，以下保留供参考）

1. 执行上方 4.2 的**创建 pgdg.sources** 代码块。它会先检查密钥文件非空、阻止覆盖已有同名文件，并按实际 Ubuntu 代号生成配置。[S8]
2. 若提示文件已存在，不覆盖、不重复追加源；先查看它的内容。正确的本机目标配置如下；这只是目标值，**不是声称文件已经存在**。

```conf
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: jammy-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
```

3. 创建成功或确认已有文件一致后，只执行下面的**读取/索引/候选/模拟**步骤，回传结果；**暂不执行真实 apt install**。[S8][S24]

**【服务器 Bash，由你手动执行；每条成功再继续】**

```bash
sudo cat /etc/apt/sources.list.d/pgdg.sources
sudo apt update
apt-cache policy postgresql-18 postgresql-client-18
sudo apt-get --simulate install postgresql-18 postgresql-client-18
```

`apt update` 会写入本机包索引，但不等同于安装数据库；最后一条必须保留 `--simulate`。遇到签名/下载错误、Candidate 为 none、非预期依赖升级或移除就停止，不忽略错误继续。[S21][S24]

**原有“容器/自定义实例、数据库放盘、适用网络策略与维护条件”仍需在实际安装前确认。** 本阶段不因为下载了密钥而默认把数据库放到根分区或 `/data`。

### 4.2.2 源文件缺失与找不到包的处理（已解决，保留历史）

**补录日期：2026-09-17；精确执行时间未提供。** 本节原错误已经由后续源文件创建/索引更新解决，验收证据见 4.2.3。**下方修复命令仅作历史留档，不再执行；软件包安装现已完成（4.3.6.1），初始化现也已完成（4.3.7.1），当前入口为 4.3.12 运行中的本地只读 SQL。**

#### 已确认的错误链

```text
$ sudo cat /etc/apt/sources.list.d/pgdg.sources
cat: /etc/apt/sources.list.d/pgdg.sources: No such file or directory

$ apt-cache policy postgresql-18 postgresql-client-18
N: Unable to locate package postgresql-18
N: Unable to locate package postgresql-client-18

$ sudo apt-get --simulate install postgresql-18 postgresql-client-18
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
E: Unable to locate package postgresql-18
E: Unable to locate package postgresql-client-18
```

**当时的判断（现已解决）**：预定的 PGDG 源文件不存在，当时包索引也找不到这两个包；当时仍停留在软件源准备阶段，不是“数据库启动失败”，不需要卸载、清库或反复模拟安装。下载签名密钥与创建软件源文件是两个独立步骤，随后还要更新索引才能检查包候选。[S8]

#### 第一步：创建本机的源文件

**【服务器 Bash，由你手动执行】** 以下整段只适用于已经确认的 **Ubuntu 22.04/jammy、amd64**。它检查密钥非空、防止覆盖已有源文件，使用 `Signed-By` 限定密钥，并让 APT 能读取这两个公共配置文件；不会安装软件或建库。

```bash
(
    set -eu
    KEY=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    SOURCE=/etc/apt/sources.list.d/pgdg.sources
    if ! sudo test -s "$KEY"; then
        printf '%s\n' '密钥文件不存在或为空，停止；请回传此提示。' >&2
        exit 1
    fi
    if sudo test -e "$SOURCE"; then
        printf '%s\n' '源文件已存在，停止，避免覆盖；请回传现有内容。' >&2
        sudo cat "$SOURCE"
        exit 1
    fi
    sudo chmod 0644 "$KEY"
    sudo tee "$SOURCE" >/dev/null <<'EOF'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: jammy-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
    sudo chmod 0644 "$SOURCE"
    sudo cat "$SOURCE"
)
```

应打印 6 行配置，其中 `Suites: jammy-pgdg`、`Architectures: amd64`。出现密钥缺失、文件已存在或任何权限错误时，**在这里停止并回传，不执行第二步**。如提示文件已存在，先核对它，不删除重建。

#### 第二步：更新索引

只在第一步成功且配置正确后执行：

```bash
sudo apt update
```

检查输出是否包含 PGDG 的 `jammy-pgdg` 索引正常获取/命中，且没有该源的下载或签名错误。**不能仅凭最后出现 Done 就忽略前面的错误/警告。** 若有相关错误，停止，不绕过 HTTPS/签名校验，不继续第三步。[S8]

#### 第三步：检查候选，到这里先停

```bash
apt-cache policy postgresql-18 postgresql-client-18
```

预期两个包均有 Candidate（不是 `(none)` 或 Unable to locate），对应官方 PGDG 仓库。请回传**第一步打印的源内容、第二步 apt update 输出、第三步 policy 输出**。

**当时要求先不运行模拟或真实安装；现在源/候选已通过，此暂停条件已解除。** 完整模拟现也已通过核对（4.3.1），当前挂载及 fstab 已核对；服务端安装/初始化仍需按自定义目录方案核对前置条件。已有 proposed=500、CUDA/NVIDIA=600 的记录保留，本段不改变它们的优先级。

- [x] 源文件缺失及包查询/模拟错误已记录。
- [x] 源文件创建成功已回传，见 4.2.3。
- [x] PGDG 索引已正常获取，未显示签名/下载错误，见 4.2.3。
- [x] 两个包的 Candidate 已正常回传，见 4.2.3。
- [x] 完整依赖模拟已完成并核对，见 4.3.1。
- [x] 管理工具包实际安装已完成（4.3.4.1）。
- [x] 服务端软件包已安装并核对（4.3.6.1）；业务建库仍属于下一阶段。

### 4.2.3 源文件、索引与包候选验收记录（用户已回传成功）

**补录日期：2026-09-17；精确执行时间未提供。** 信息来自用户回传的源文件读取、apt update、apt-cache policy 输出。助手只更新文档，未登录服务器。

| 验收项 | 用户回传 | 状态 |
|---|---|---|
| 软件源文件 | 打印出 Types、URIs、Suites、Architectures、Components、Signed-By 六项 | **已创建并回读** |
| Suite / 架构 | `jammy-pgdg` / `amd64` | 与已确认系统匹配 |
| PGDG 索引 | 获取 InRelease **189 kB**、main amd64 Packages **837 kB** | 本次索引更新成功，未显示签名/下载错误 |
| 总获取量与耗时 | **1,025 kB / 23s / 45.3 kB/s** | 保存原值，不从分别四舍五入的索引大小重算 |
| postgresql-18 | Installed **(none)**；Candidate **18.6-1.pgdg22.04+2** | **候选存在，尚未安装** |
| postgresql-client-18 | Installed **(none)**；Candidate **18.6-1.pgdg22.04+2** | **候选存在，尚未安装** |
| 两项候选来源 | 官方 PGDG `jammy-pgdg/main amd64 Packages`，优先级 **500** | 当前索引中的候选来源已明确；不是运行中数据库版本 |
| Ubuntu 待升级提示 | **112 packages can be upgraded** | 不作为升级指令；本次回传没有真实软件包安装/升级命令 |
| 历史故障 | 源文件缺失、Unable to locate package | **已解决**；旧输出保留在 4.2.2，不再重复修复 |

源配置回读（对聊天自动添加的 URL 链接格式作文本还原）：

```conf
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: jammy-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
```

关键输出摘录：

```text
Get:8 https://apt.postgresql.org/pub/repos/apt jammy-pgdg InRelease [189 kB]
Get:9 https://apt.postgresql.org/pub/repos/apt jammy-pgdg/main amd64 Packages [837 kB]
Fetched 1,025 kB in 23s (45.3 kB/s)
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
112 packages can be upgraded. Run 'apt list --upgradable' to see them.

postgresql-18:
Installed: (none)
Candidate: 18.6-1.pgdg22.04+2
Version table:
18.6-1.pgdg22.04+2 500
500 https://apt.postgresql.org/pub/repos/apt jammy-pgdg/main amd64 Packages
18.4-1.pgdg22.04+1 500
500 https://apt.postgresql.org/pub/repos/apt jammy-pgdg/main amd64 Packages
18.3-1.pgdg22.04+1 500
500 https://apt.postgresql.org/pub/repos/apt jammy-pgdg/main amd64 Packages

postgresql-client-18:
Installed: (none)
Candidate: 18.6-1.pgdg22.04+2
Version table:
18.6-1.pgdg22.04+2 500
500 https://apt.postgresql.org/pub/repos/apt jammy-pgdg/main amd64 Packages
18.4-1.pgdg22.04+1 500
500 https://apt.postgresql.org/pub/repos/apt jammy-pgdg/main amd64 Packages
18.3-1.pgdg22.04+1 500
500 https://apt.postgresql.org/pub/repos/apt jammy-pgdg/main amd64 Packages
```

**当前结论：4.2 完成；4.3 的候选检查通过。** 用户消息中混有 Markdown 围栏与自动网址链接，但后续 APT 已成功解析源并获取索引；不将聊天展示格式误判为服务器源文件仍损坏，也不因此重写已经有效的源。

- [x] ~~源文件不存在~~ → 已创建并回读。
- [x] ~~APT 找不到两个包~~ → 两项均有明确候选。
- [x] PGDG 索引获取完成，未显示签名/下载错误。
- [x] 修复后的完整依赖模拟结果已回传并核对，见 4.3.1。
- [x] 数据目录选择已确认，见 3.4。
- [x] 当前挂载、fstab 配置及专用目录现状已回传（4.3.2.1）。
- [ ] 实例启动保护、容器及其他适用前置确认仍未全部收口。
- [x] 服务端软件包实际安装已完成（4.3.6.1）。
- [x] 集群初始化输出已核对，见 4.3.7.1。
- [ ] 配置回读、运行中版本与本地 SQL 验收尚未进行。

**服务包安装及集群初始化均已成功（4.3.6.1 / 4.3.7.1）；4.3.8 全部回读已完成，4.3.9 配置脚本已完成，HBA/down/无监听也已回读，4.3.10 守卫已通过但启动失败，修复与启动现已通过，4.3.12 本地 SQL 已通过，下一步仅执行 4.3.13 Windows SSH 隧道验证。** 不需重复 4.2 或本次已完成的模拟，不卸载、不全系统升级。proposed=500 的配置未改变；本次完整依赖计划核对结果见 4.3.1，若后续索引或计划变化则重新核对。

### 4.3 核对来源并安装

> **当前进度：安装、初始化及第 60 行语法修复均已完成；2026-09-17 20:33:36 CST 服务已 active(running)，18/main online，TCP 仅回环监听。4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，不重装、不重启、不重复修复或建业务库。** 验收依据见 4.3.11.1。

**下面的索引/候选检查已由用户执行并回传，保留为流程参考，本轮无需重复。**

```bash
sudo apt update
apt-cache policy postgresql-18 postgresql-client-18
```

预期：两者有 Candidate，来源包含已配置的官方 PGDG 仓库。若 Candidate 为 `(none)`，先排查网络、发行版代号、架构、签名或镜像，不能随便添加陌生 PPA。

**这台服务器的额外检查：4.1.3 已记录 proposed 与正式 Ubuntu 通道同为 500。此次完整依赖模拟已核对，结果见 4.3.1；以下保留原命令，不要求无变化时重跑。** 该命令仅模拟，不安装；`--simulate` 不得省略。[S24]

```bash
sudo apt-get --simulate install postgresql-18 postgresql-client-18
```

检查全部计划中的安装/升级/移除与版本来源；如果涉及未知 proposed 依赖、删除现有软件或非预期系统升级，暂停，交管理员核对，不加 `-y` 强行执行。模拟不会替你跑包维护脚本，也不保证之后运行状态，正式安装仍需验收。源索引或策略改变后应重新检查计划。

**当前已选择自定义数据目录，不再使用原默认目录的一步安装入口。** 管理工具和服务包均已装好，自动创建仍为 off；选定目录已显式初始化，4.3.8 回读已完成，4.3.9 配置脚本已完成，HBA/down/无监听也已回读，首次启动已失败，现已修复并启动，4.3.12 本地 SQL 已通过，下一步仅执行 4.3.13 Windows SSH 隧道验证，不创建或迁移集群。

### 4.3.1 原完整模拟安装记录（历史计划，后续已单独安装管理包）

**补录日期：2026-09-17；精确执行时间未提供。** 用户再次回传两项包 policy 及完整 `sudo apt-get --simulate install postgresql-18 postgresql-client-18` 输出。重复回传不表示执行了多次真实安装；助手没有连接服务器。

```text
postgresql-18 / postgresql-client-18:
Installed: (none)
Candidate: 18.6-1.pgdg22.04+2

0 upgraded, 12 newly installed, 0 to remove and 112 not upgraded.
```

下表逐项记录模拟输出的 **12 个拟新装包**，不是已安装清单：

| 拟安装包 | 计划版本 | 本次 `Inst` 行列出的来源 |
|---|---|---|
| libjson-perl | 4.04000-1 | Ubuntu jammy |
| postgresql-client-common | 293.pgdg22.04+1 | PGDG jammy-pgdg |
| postgresql-common | 293.pgdg22.04+1 | PGDG jammy-pgdg |
| libcommon-sense-perl | 3.75-2build1 | Ubuntu jammy |
| libtypes-serialiser-perl | 1.01-1 | Ubuntu jammy |
| libjson-xs-perl | 4.040-0ubuntu0.22.04.1 | Ubuntu jammy-security / jammy-updates |
| libpq5 | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| liburing2 | 2.1-2build1 | Ubuntu jammy |
| postgresql-client-18 | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| postgresql-18 | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| postgresql-18-jit | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| sysstat | 12.5.2-2ubuntu0.2 | Ubuntu jammy-security / jammy-updates |

**该次核对结论：模拟计划未见非预期升级或移除，依赖计划检查通过；当时未进行实际安装。** 后续管理工具已在 4.3.4.1 单独安装，原 12 项不能当作剩余安装清单；后续服务端也已安装成功（4.3.6.1）。

- 0 项现有包升级、0 项移除，112 项待升级保留未动；12 项全部为拟新增。
- 表中来源未显示 `jammy-proposed`；未显示 CUDA/NVIDIA 包安装、升级或移除。这只描述本次计划，不表示已禁用 proposed、核实全机包来源或保证以后计划不变。
- 每项 `Inst` 和 `Conf` 都属于模拟显示，不证明真实安装、配置、服务启动或集群创建成功。[S24]
- `Suggested packages: libpq-oauth postgresql-doc-18 isag` 只是建议项，不属于本次 12 项拟新装清单；不额外安装。
- `libfwupd2 libfwupdplugin5 libgcab-1.0-0 libsmbios-c2` 的 autoremove 提示只记录，**不执行清理**，也不运行全系统 upgrade。
- **无需重复本次模拟**；若后续调整初始化安装顺序、软件源、索引或拟安装包集合，应核对那一次实际事务计划，不能把本表当永久保证。

- [x] ~~完整依赖模拟待回传~~ → 已回传并逐项核对。
- [x] 数据目录 `/data/postgresql/18/main` 已获用户确认。
- [x] 挂载与目标路径只读核对已完成，见 4.3.2.1。
- [x] 管理包安装已完成，见 4.3.4.1。
- [x] 默认集群自动创建已禁用并回读为 off，备份及新模拟已核对（4.3.5.1）。
- [x] 服务包实际安装已完成（4.3.6.1）。
- [x] 自定义初始化已完成，见 4.3.7.1。
- [ ] 初始化后配置回读及启动保护尚未完成。
- [ ] 其他尚未收口的适用前置确认：见 3.3.1。
- [x] 服务端软件包实际安装已完成。
- [x] 集群初始化输出已核对；当前为 down。
- [x] 后续服务运行及仅回环监听已验收（4.3.11.1）。
- [ ] 本地 SQL 与 SSH 隧道仍待验收。
- 业务建库、业务角色和表结构：**不属于本阶段**，本轮没有执行。

### 4.3.2 数据盘挂载与目标路径只读核对（已回传）

**此项已由用户执行，结果见 4.3.2.1，无需重复提交。** 以下保留检查方法；不重复系统/内存/APT 全套检查，不安装软件，不创建目录，不修改 `/etc/fstab`。

**【服务器 Bash，由用户手动执行】** 三条命令分别执行，保留没有输出和错误提示，不要把它们理解为自动放行：

```bash
findmnt --mountpoint /data -o TARGET,SOURCE,FSTYPE,OPTIONS
findmnt --fstab --mountpoint /data -o TARGET,SOURCE,FSTYPE,OPTIONS
sudo ls -ld /data /data/postgresql /data/postgresql/18 /data/postgresql/18/main
```

如何理解输出：[S28]

1. 第一条查询当前实际挂载，预期目标为 `/data`、文件系统 ext4、来源对应此前的 `/dev/nvme0n1p1`，挂载选项含 `rw`。无输出、只读挂载或来源异常时先停，不往同名目录写数据。
2. 第二条查询 `/etc/fstab` 中 `/data` 的配置。来源可以写为 UUID；此前 `lsblk` 回传此盘 UUID 为 `7a36a8d0-78cb-4385-8660-ebd3522bfaf5`，需与实际配置核对。还要查看 `noauto`、`nofail` 等选项，不以“存在一行”替代开机挂载可靠性验收。
3. 第二条无输出，**只表示没查到这份 fstab 中的匹配项**，不证明没有持久挂载方案。可能另有 systemd mount unit 等方式；先回传结果，再针对实际方式核对，不自行追加 fstab 或执行重启。
4. 第三条仅查看目录存在性、属主和权限。`/data` 应存在，后面尚未创建的目录提示 `No such file or directory` 可以是正常现状。若已有 `postgresql`、`18` 或 `main`，或显示符号链接，不覆盖、清空或改权限，先核对用途和真实路径。`ls -ld` 不验证目录内部是否为空。

**这三条输出已齐全，详见 4.3.2.1。** 不为消除目录不存在提示提前创建目录；这些结果不代替容器/历史数据及适用维护边界确认。

### 4.3.2.1 数据盘核对结果（用户已回传）

**补录日期：2026-09-17；命令精确执行时间未提供。** 以下来自用户 SSH 终端回传，助手没有远程检查服务器。目录输出中的“8月 27 16:56”是 ls 显示的目录时间字段，不是本次命令执行时间。

| 核对项 | 实际回传 | 结论 |
|---|---|---|
| 当前挂载 | `/data` → `/dev/nvme0n1p1`，ext4，`rw,relatime` | 已挂载且为读写；与此前设备一致 |
| fstab 来源 | `UUID=7a36a8d0-78cb-4385-8660-ebd3522bfaf5` | 与此前 lsblk 中该数据盘 UUID 一致 |
| fstab 类型/选项 | ext4，`defaults,nofail` | 存在持久化挂载配置；不等于已经重启验证 |
| `/data` 目录 | `drwxr-xr-x`，`t7920:t7920` | 当前权限 0755；保留现状，不更改整个数据盘属主或权限 |
| 三层数据库专用目录 | `/data/postgresql`、`/data/postgresql/18`、`/data/postgresql/18/main` 均不存在 | 符合尚未创建的状态，不是需要修复的安装报错；未发现这些目标路径上的已有目录 |

原始输出（去除终端提示符，不包含 sudo 密码输入）：

```text
TARGET SOURCE         FSTYPE OPTIONS
/data  /dev/nvme0n1p1 ext4   rw,relatime

TARGET SOURCE                                    FSTYPE OPTIONS
/data  UUID=7a36a8d0-78cb-4385-8660-ebd3522bfaf5 ext4   defaults,nofail

ls: cannot access '/data/postgresql': No such file or directory
ls: cannot access '/data/postgresql/18': No such file or directory
ls: cannot access '/data/postgresql/18/main': No such file or directory
drwxr-xr-x 5 t7920 t7920 4096  8月 27 16:56 /data
```

**nofail 的处理：保留现有 fstab，不把它视为配置错误。** 在 systemd 下，nofail 允许开机流程不等待该挂载成功就继续；它不是“不自动挂载”，也不代表数据库可以忽略数据盘状态。[S29]

本项目后续应在目标实例 `postgresql@18-main.service` 上单独配置挂载依赖和挂载点检查，使数据库等待 `/data` 并在条件不满足时拒绝启动。仅依赖系统开机流程或目录存在性不够；依赖配置、磁盘实际身份与读写状态仍须在初始化/启动前核对。**这些保护尚未配置；本轮也不卸载数据盘、不重启服务器做故障演练。** [S30]

**该次结论：挂载/路径只读检查通过；后续 4.3.4 管理工具安装现已完成。** 不重复这三项已完成检查，不创建数据库目录、不安装服务端、不创建集群；其他部署方式和维护边界仍由用户在后续服务安装前确认。

### 4.3.3 自定义目录安装顺序（分阶段状态）

以下为分阶段方案：安装、初始化、挂载保护、HBA 文本、语法修复和服务启动均已完成。4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，实际运行参数/HBA 解析已通过，仅 SSH 隧道仍待确认；不为继续验收重复启动或修改配置。

| 顺序 | 用户后续手动操作 | 必须满足的结果 |
|---|---|---|
| 1 | 4.3.2 当前挂载、fstab 项及目标目录不存在已核对；适用维护边界仍由用户确认 | `/data` 当前为目标数据盘；这不替代初始化前复核和之后的启动保护 |
| 2 | **已完成**：独立模拟与实际安装管理包及必需依赖，见 4.3.4.1 | 此阶段安装 3 个包；后续又完成服务包安装（第 4 步） |
| 3 | **已完成**：备份配置，设置并回读 `create_main_cluster=off`，见 4.3.5.1 | 备份路径已记录，安装前再只读复核有效值，不重复修改 [S3] |
| 4 | **已完成 4.3.6**：实际新增 6 项，与模拟一致，见 4.3.6.1 | 两个版本化包 Installed=18.6-1.pgdg22.04+2；无集群数据行、无 5432 监听 |
| 5 | **已完成 4.3.7**：显式初始化 18/main，数据目录 /data/postgresql/18/main，报告 down | UTF8、en_US.UTF-8、Asia/Shanghai、页校验和已记录；manual/监听/权限及其余回读均已通过（4.3.8.1、4.3.8.3） [S3] |
| 6 | **配置与语法修复均已完成**：drop-in、HBA 文本、依赖守卫、单行引号修复和 -C 检查已通过 | 原语法故障已解决；备份为修复前状态，不能盲目整份恢复 |
| 7 | **已启动成功，4.3.12 已通过；当前只执行 4.3.13**：验证 Windows SSH 隧道可达性 | active(running)、online、127.0.0.1:5432、本地 SQL、运行参数和 HBA 文件解析已验收；开机策略和隧道仍待后续 |

**边界**：不把整个 `/data` 递归交给 postgres，不移动默认集群、不执行 `pg_dropcluster`，不为“清理”删除目录。`create_main_cluster = false` 会影响之后新服务包的自动建集群行为，需记录为运维配置；不默认在安装后改回。系统默认数据库的初始化仍属于本阶段，不创建业务库。[S3]

### 4.3.4 仅安装 PostgreSQL 管理工具包（已完成，保留操作方法）

**本节已由用户执行并回传，验收见 4.3.4.1；无需重复安装。** 只准备 `postgresql-common` 及必需依赖，不安装版本化数据库服务包、不初始化集群、不建业务库、不修改数据盘。管理包用于后续配置集群创建策略；安装管理包本身不等于数据库服务已部署。[S31]

这是用户手动实施的包安装，会修改系统包状态并可能创建管理配置、系统账号和服务管理文件，不是只读检查。`--no-install-recommends` 本次仅排除推荐依赖，不会省略必需依赖；模拟与实际安装保持相同选项。[S24]

#### 第一步：核对管理包的独立安装计划

**【服务器 Bash】**

```bash
sudo apt-get --simulate --no-install-recommends install postgresql-common
```

这不是重跑之前的 12 包模拟：本次请求的包集合和安装选项已改变。核对后再决定是否进行第二步：

- 只新增 `postgresql-common`、`postgresql-client-common` 及必要依赖；**不得出现版本化数据库服务包**，例如 `postgresql-18` 或其他 `postgresql-NN` 服务包，也不安装 `postgresql` 服务端元包。
- 预期没有已有包升级或移除；如有非预期升级/移除、proposed 来源、CUDA/NVIDIA 变更、签名错误或其他疑问，**停止，只回传模拟输出**，不执行第二步。
- 仍核对实际列出的来源；之前 common 候选为 PGDG 的 `293.pgdg22.04+1`，但不能据此断言本次实时事务必然相同。
- 推荐/建议列表不等于拟安装列表，不额外添加包；不执行 autoremove、upgrade，不加入 `-y`。

#### 第二步：仅在上述计划无异常且允许本次包变更时安装

```bash
sudo apt-get --no-install-recommends install postgresql-common
```

这是**真实安装管理工具包**。提示继续时再次核对摘要，只有与刚才审核的范围一致才输入 `Y`；若计划变化或有不认识的操作，输入 `n` 并回传。不要另行执行安装服务器包、`pg_createcluster`、`initdb` 或修改磁盘权限的命令。[S24]

#### 第三步：安装成功后只读回传结果，到这里停

```bash
apt-cache policy postgresql-common postgresql-18 postgresql-client-18
pg_lsclusters
sudo cat /etc/postgresql-common/createcluster.conf
```

预期管理包已有 Installed 版本，而两个版本化服务端/客户端包仍为 `(none)`；在当前新环境中 `pg_lsclusters` 应没有集群数据行，可能只有表头。若出现任何集群数据行，先停，不删除或停止它。若安装失败，不跳过错误继续下一步。[S3][S23]

**上述模拟、安装及第三步输出已全部回传，见 4.3.4.1。** 4.3.5 和 4.3.6 现也已完成，4.3.7 初始化现也已完成，4.3.8 回读也已完成，首次启动已失败，现已修复并 online，4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证；不重复安装、初始化或开关修改。[S3]

### 4.3.4.1 管理工具实际安装验收（用户已回传成功）

**补录日期：2026-09-17；命令精确执行时间未提供。** 已读取用户附件，原始文本按字节保存：[管理工具安装完整日志](records/4.3.4_管理工具安装_用户回传_2026-09-17.txt)。日志内容仅作为执行证据；其中的 autoremove 等提示不是本手册授权的操作。

| 核对项 | 实际结果 | 判断 |
|---|---|---|
| 管理包模拟及实际安装摘要 | 两次均为 `0 upgraded, 3 newly installed, 0 to remove and 112 not upgraded` | 实际计划与模拟一致，非仅模拟 |
| libjson-perl | `4.04000-1`，实际从 Ubuntu jammy 下载并完成 Setting up | 已安装 |
| postgresql-client-common | `293.pgdg22.04+1`，实际从 PGDG jammy-pgdg 下载并完成 Setting up | 已安装公共客户端管理层，不等于已装 psql 18 |
| postgresql-common | `293.pgdg22.04+1`，Setting up 完成，policy 中 Installed=Candidate | 管理工具已安装 |
| 下载量/耗时 | `374 kB in 7s (54.0 kB/s)`；APT 预估新增占用 891 kB | 保留日志值，不当成磁盘实测 |
| postgresql-18 / postgresql-client-18 | 两项 Installed 均为 `(none)`，Candidate 均为 `18.6-1.pgdg22.04+2` | 版本化服务端与客户端均尚未安装 |
| pg_lsclusters | 只有 `Ver Cluster Port Status Owner Data directory Log file` 表头 | 没有列出受管理集群；不外推为不存在容器/自定义部署 |
| 初始化配置文件 | 已创建并完整回读 `/etc/postgresql-common/createcluster.conf` | 可以进行下一步受控修改 |
| 当时的自动创建项（历史） | 管理包刚装好时主文件为注释 `#create_main_cluster = true` | 后续已设置并回读为 off，当前状态见 4.3.5.1 [S3] |
| 附加配置入口 | `include_dir '/etc/postgresql-common/createcluster.d'` | 后续不能只 grep 主文件某一行就判定有效值 |

关键安装摘要：

```text
0 upgraded, 3 newly installed, 0 to remove and 112 not upgraded.
Setting up postgresql-client-common (293.pgdg22.04+1) ...
Setting up libjson-perl (4.04000-1) ...
Setting up postgresql-common (293.pgdg22.04+1) ...
Ver Cluster Port Status Owner Data directory Log file
```

其他日志说明：

- policy 中虽然列出 `jammy-proposed` 的 `238ubuntu0.1`，但那是其他可用版本；本次 common 实际下载并安装的是 PGDG 的 `293.pgdg22.04+1`，不能把版本表中出现 proposed 误判为安装使用了 proposed。
- 本次发生了系统变更：包安装、`pg_config` diversion、postgres 用户加入 ssl-cert 组、初始化模板创建、词典构建及 `postgresql.service` 启用链接创建；不再写成“系统未变化”。
- 当时创建了总服务的 systemd 链接，**不代表已经存在运行中的数据库实例**；该阶段版本化包未安装。后续包已安装但仍无集群，最新状态见 4.3.6.1。
- 模板中的 `ssl = on` 不是运行中服务的参数回读，更不是可信证书或 TLS 已验收。
- `libjson-xs-perl` 仅出现在 Recommended packages，未列入这次 3 项实际安装清单。不为消除推荐或 autoremove 提示额外装包、清理包或升级系统。

- [x] 管理工具的独立模拟、真实安装和配置回读全部完成。
- [x] 当时确认版本化包未安装且无集群行；最新包已安装、仍无集群，见 4.3.6.1。
- [x] 关闭自动默认集群创建并验证有效值已完成，见 4.3.5.1。
- [x] 服务端新模拟已核对：0 升级/6 新装/0 移除，见 4.3.5.1。
- [x] 后续服务端实际安装已完成，见 4.3.6.1。
- [x] 自定义初始化现已完成（4.3.7.1）。
- [ ] 配置回读、启动保护及连通性验收尚未完成。

### 4.3.5 关闭默认集群自动创建并模拟服务端安装（已完成）

**用户已完成以下配置和模拟步骤，结果见 4.3.5.1；保留操作方法，不需重复备份或修改。** 这一步防止以后安装 PostgreSQL 18 服务包时，自动在根盘创建默认 `18/main`；并不创建数据库目录或初始化任何集群。[S3]

#### 第一步：备份、修改并回读有效值

使用管理包自带的 `pg_conftool` 修改一个参数，保留其他配置。主文件有 include_dir，所以使用工具解析后的值验收，不用“主文件出现 false”替代有效值检查。[S32][S33]

**【服务器 Bash，完整复制这一块】**

```bash
(
    set -eu
    CONF=/etc/postgresql-common/createcluster.conf
    sudo test -f "$CONF"
    BACKUP_DIR=$(sudo mktemp -d /root/ee-pg-init-config.XXXXXX)
    sudo cp -a "$CONF" "$BACKUP_DIR/createcluster.conf"
    printf '配置备份：%s/createcluster.conf\n' "$BACKUP_DIR"

    sudo pg_conftool "$CONF" set create_main_cluster false
    EFFECTIVE=$(sudo pg_conftool --boolean --short "$CONF" show create_main_cluster)
    printf 'create_main_cluster=%s\n' "$EFFECTIVE"
    if [ "$EFFECTIVE" != off ]; then
        printf '%s\n' '有效值不是 off，停止。请回传输出；不要安装服务包。' >&2
        exit 1
    fi
)
```

预期打印一个备份路径，以及：

```text
create_main_cluster=off
```

这里的 `off` 是工具把布尔值 false 规范化后的显示，表示关闭自动创建。[S32] 若有错误、输出不是 off、配置解析失败或附加配置导致覆盖，停止并保留备份，回传结果；不删除 include 文件、不批量覆盖配置，也不直接安装服务包。若确需撤回本次修改，后续根据实际备份路径单独处理，不自动回滚。

该设置只控制包安装时自动创建默认集群，不妨碍后续按手册显式初始化自定义目录。`start_conf`、`data_directory` 等模板当前先保持原样，后续创建时显式指定目录和初始 manual 策略。[S3]

#### 第二步：只有第一步成功后，模拟服务端与客户端安装

```bash
sudo apt-get --simulate install postgresql-18 postgresql-client-18
```

**第一步输出和第二步完整模拟计划已回传，见 4.3.5.1。** 管理工具已经安装，剩余包数量不应机械照搬以前的 12 项；继续核对实际版本、来源、升级/移除以及 proposed/CUDA 变更。这个模拟不执行包维护脚本，不能代替第一步的策略设置与后续实际安装验收。[S24]

**本节原暂停点及后续 4.3.6 软件包安装均已完成；初始化现也已完成（4.3.7.1），4.3.8 回读也已完成，4.3.9 配置脚本已完成，HBA/down/无监听也已回读，首次启动已失败，现已修复并 online，4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，不创建业务库。** 不重复管理工具安装、开关设置或本次模拟；实际安装时只读复核开关和事务计划，仍由用户确认适用维护边界。

### 4.3.5.1 自动创建开关与服务端新模拟验收（已通过）

**补录日期：2026-09-17；执行精确时间未提供。** 信息来自用户聊天回传，助手没有连接或修改服务器。聊天中的代码围栏和转义下划线按展示格式处理；终端已返回有效值 off，不据此误判配置块执行失败。

| 核对项 | 用户实际回传 | 判断 |
|---|---|---|
| 配置备份 | `/root/ee-pg-init-config.FA9b5O/createcluster.conf` | 备份路径已记录，保留用于回溯；未执行恢复 |
| 自动创建策略 | `create_main_cluster=off` | 通过 pg_conftool 布尔回读，已关闭自动创建默认集群 |
| 新模拟摘要 | `0 upgraded, 6 newly installed, 0 to remove and 112 not upgraded` | 仅拟新装 6 项，没有已有包升级或移除 |
| 模拟来源 | PGDG jammy-pgdg、Ubuntu jammy / security / updates | 本次未显示 proposed 来源或 CUDA/NVIDIA 包变更 |
| 实际服务包安装 | 本次只有 `--simulate` 输出 | **尚未执行**；Inst/Conf 均不能当作真实安装证据 |

新模拟中的六个拟安装包：

| 包 | 计划版本 | 模拟输出来源 |
|---|---|---|
| libpq5 | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| liburing2 | 2.1-2build1 | Ubuntu jammy |
| postgresql-client-18 | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| postgresql-18 | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| postgresql-18-jit | 18.6-1.pgdg22.04+2 | PGDG jammy-pgdg |
| sysstat | 12.5.2-2ubuntu0.2 | Ubuntu jammy-security / jammy-updates |

关键输出：

```text
配置备份：/root/ee-pg-init-config.FA9b5O/createcluster.conf
create_main_cluster=off
0 upgraded, 6 newly installed, 0 to remove and 112 not upgraded.
```

- 前次整体模拟是 12 项，后续仅安装了管理工具所需的 3 项；现在剩余事务为 6 项。模拟清单由当时已安装状态和依赖策略决定，不用总数相减推断还漏装哪些推荐包；以本次逐项清单为准，不补装之前仅推荐的 Perl 依赖。
- `libpq-oauth postgresql-doc-18 isag` 仍只是 Suggested packages，不在这六项中；不额外添加。autoremove 提示仍不执行，112 项待升级保留未动。
- 开关关闭只影响自动创建默认集群，不意味着数据目录已创建或服务器已可连接。[S3]
- 新模拟及后续软件包实际安装现均已完成，**无需重复执行 4.3.5 或 4.3.6**；4.3.7 初始化现也已完成，4.3.8 回读也已完成，4.3.9 配置脚本已完成，HBA/down/无监听也已回读，首次启动已失败，现已修复并 online，4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证。

### 4.3.6 实际安装 PostgreSQL 18 软件包（已完成，保留步骤）

**本节已由用户实际执行且安装后检查通过，见 4.3.6.1；不再执行以下安装块。** 以下保留原安装说明：保留 `create_main_cluster=off`，预期本次安装不会自动创建默认集群；安装后仍必须核对结果，不能仅凭开关就把“未创建集群”标为已验收。[S3]

这一步会安装系统软件包及相关管理文件/辅助服务，不是只读操作。请在允许本次软件变更、无人同时修改 PostgreSQL 初始化配置的情况下执行；已有容器/自定义部署和其他业务维护边界仍由你或管理员确认。**本轮不更改 fstab、UFW、SSH、/data 权限或已有服务配置，不创建业务库。**

#### 第一步：只读复核开关，然后执行实际安装

**【服务器 Bash，完整复制】**

```bash
(
    set -eu
    CONF=/etc/postgresql-common/createcluster.conf
    EFFECTIVE=$(sudo pg_conftool --boolean --short "$CONF" show create_main_cluster)
    printf 'create_main_cluster=%s\n' "$EFFECTIVE"
    if [ "$EFFECTIVE" != off ]; then
        printf '%s\n' '自动创建开关不是 off，停止安装；请回传输出。' >&2
        exit 1
    fi

    sudo apt-get install postgresql-18 postgresql-client-18
)
```

安装提示继续前，核对摘要仍是 **0 升级、6 新装、0 移除、112 项未升级**，六项名称/版本与 4.3.5.1 一致，再输入 `Y`。不加 `-y`。如果包列表、版本、升级/移除范围变化，输入 `n` 并回传，不自动接受新事务；不要额外运行全系统 upgrade 或 autoremove。[S24]

如果发生下载、签名、解包或配置错误，立即停止后续步骤，保留完整输出；不通过添加不明源、禁用签名或删除目录来解决。

#### 第二步：仅在安装成功后检查，到这里停止

```bash
apt-cache policy postgresql-18 postgresql-client-18
/usr/lib/postgresql/18/bin/psql --version
pg_lsclusters
sudo pg_conftool --boolean --short /etc/postgresql-common/createcluster.conf show create_main_cluster
sudo ss -lntp 'sport = :5432'
```

预期结果及边界：

- 两项 policy 的 Installed 变为实际安装版本；若按本次计划安装，应是 `18.6-1.pgdg22.04+2`。
- `psql --version` 能显示 18.x **客户端**版本；这不是已运行服务端的版本查询。
- `pg_lsclusters` 仍无集群数据行（可能只有表头）；因为本轮刻意不初始化。若出现任何集群，包括 down 状态，不启动、不删除、不迁移，先回传完整安装日志和该输出。[S3]
- 开关回读仍为 `off`。5432 预期没有新监听；若有监听，先核对进程来源，不擅自终止它，不直接开放网络。
- `/data/postgresql/18/main` 还未创建可以是预期状态；**软件包安装成功不等于数据库已启动或可以登录**。此时不要用 `pg_isready` 未就绪或缺少 `18/main` 来判定必须重装。

**完整实际安装输出及第二步结果已回传通过，见 4.3.6.1。** 初始化输出也已确认成功（4.3.7.1）；4.3.8 回读已完成，HBA/down/无监听也已回读，首次启动已失败，4.3.11 修复与启动现已成功，4.3.12 查询已通过，当前只执行 4.3.13 Windows SSH 隧道验证，不再修改配置或重复初始化。不创建业务库、schema、表或业务角色。

### 4.3.6.1 PostgreSQL 18 软件包安装验收（用户已回传成功）

**补录日期：2026-09-17；精确执行时间未提供。** 以用户最新附件的完整安装日志和安装后检查为准：[软件包安装完整日志](records/4.3.6_PostgreSQL18软件包安装_用户回传_2026-09-17.txt)。中间聊天曾截断于 Unpacking，不能据此判断失败；重复转贴也不能推断重复安装。助手没有执行服务器命令。

| 验收项 | 回传结果 | 结论 |
|---|---|---|
| 安装前开关 | `create_main_cluster=off` | 按既定策略执行 |
| 实际安装摘要 | 0 upgraded、6 newly installed、0 to remove、112 not upgraded | 与新模拟一致，确实已执行安装 |
| libpq5、postgresql-client-18、postgresql-18、postgresql-18-jit | `18.6-1.pgdg22.04+2`，从 PGDG 下载，均完成 Setting up | 四项均已安装 |
| liburing2 | `2.1-2build1`，Ubuntu jammy/main | 已安装 |
| sysstat | `12.5.2-2ubuntu0.2`，本次实际从 jammy-security/main 获取 | 已安装 |
| 下载与空间提示 | Fetched 20.8 MB in 50s (412 kB/s)；APT 预估新增占用 74.9 MB | 保留日志值，空间提示不是磁盘实测 |
| 两项 PostgreSQL 包 policy | Installed=Candidate=`18.6-1.pgdg22.04+2` | 服务端/客户端软件包安装已确认 |
| psql --version | `psql (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg22.04+2)` | 客户端可执行；不是运行中服务端 SQL 查询 |
| pg_lsclusters | 仅表头，无数据行 | 没有列出受管理集群；自动创建没有意外生成默认 18/main |
| 安装后开关回读 | `off` | 关闭策略保持 |
| TCP 5432 | ss 仅表头，无监听行 | 当前主机该端口无监听，符合未初始化/未启动的阶段预期 |

**该次安装后结论：软件包安装成功，当时集群尚未初始化。** 后续初始化已成功（4.3.7.1），当前集群为 down，仍未运行、不能登录；不需要重装或重复初始化。

补充说明：

- 本次实际变更包括 sysstat 配置、sar alternatives、sysstat service/timer 启用链接、psql 手册 alternatives、词典及 libc/man-db triggers；不声称“只下载了软件”或“系统完全没变化”。链接存在不单独证明相关服务/计时器当前运行状态，不在本任务中擅自更改它们。
- 本次实际下载来源未显示 proposed 或 CUDA/NVIDIA 包变更；不执行日志中的 autoremove 建议，不升级剩余 112 项，不额外安装 Suggested packages。
- 空的 pg_lsclusters 列表和无 5432 监听不排除其他端口、容器或自定义部署。初始化操作仍只针对已确认的新目录，不清理其他实例。
- 3.2 安装前“无包、无工具、目录不存在”的记录已成为历史，不能据其断言当前仍没有安装。

- [x] 软件包真实安装及安装后检查已完成。
- [x] 当前无受管理集群，自动创建保持关闭；无需重复安装。
- [x] 数据盘上的 18/main 初始化已成功，见 4.3.7.1；配置回读待 4.3.8。
- [ ] 实例挂载保护、认证加固、启动与本地 SQL/隧道验收：后续步骤，未完成。

### 4.3.7 在数据盘初始化 18/main（已成功，保持未启动）

**本节第一步已由用户手动执行并返回成功，见 4.3.7.1。不要重复初始化。** 下方保留原操作方法；第二步的配置/权限检查已随 4.3.8 全部回传，本次 HBA/down/无监听也已补齐，首次启动已失败，现已修复并 online，4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，无需重复提交之前的检查。本步骤会创建默认系统数据库（postgres/template0/template1）及实例管理配置，不创建业务库、业务表或业务角色；与第 0.1 节边界一致。[S3][S4]

#### 第一步：原初始化操作留档（含本次引号问题，禁止复用）

**2026-09-17 勘误**：本块为当时已执行的原始步骤，监听地址的管理工具写入方式没有保证配置字符串引号，后续暴露第 60 行语法错误。改为 text 围栏仅供追溯，不作为可复制的新部署方案；现有实例绝不能重复初始化，按 4.3.11 修复。未来新部署必须在启动前直接核对配置文件中的单引号并使用 PostgreSQL 自身 -C 检查，不能只依赖管理工具回读。

下面同一代码块会复核 `/data` 挂载点的 UUID/读写状态、受管理集群列表和目标路径。任何异常立即停止；目标已存在（包括符号链接）即停止，不复用、清空或递归改权限。这是写入前的必要保护，不是要求你重新回传全套已完成检查。执行期间请不要并行变更挂载或数据库目录。[S28][S34]

仅为新建的 `/data/postgresql` 和 `/data/postgresql/18` 设置 postgres 属主和 0700，不改变 `/data` 本身的 t7920 属主/0755；由 pg_createcluster 创建新的 main 数据目录。`/data` 的目录属主仍属于可信运维边界，本步骤不声称隔离了拥有该父目录写权限的系统管理员。[S3][S26]

初始化参数明确指定：18/main、5432、UTF8、已检测存在的 en_US.UTF-8 locale；`start.conf=manual` 且**不带启动参数**。配置监听仅 127.0.0.1，本地 socket 用 peer、TCP 用 scram-sha-256，避免隐含 trust；超级用户 TCP 拒绝规则仍需首次启动前按第 6.3 节补齐。locale 是此新实例的初始默认设置，业务库排序规则仍在下一阶段单独确定。[S3][S4][S11]

**【服务器 Bash，完整复制；不要把 Markdown 围栏一起粘贴】**

```text
(
    set -eu
    stop() { printf '%s\n' "$*" >&2; exit 1; }
    PGDATA=/data/postgresql/18/main

    UUID=$(sudo findmnt -rn --mountpoint /data -o UUID)
    [ "$UUID" = 7a36a8d0-78cb-4385-8660-ebd3522bfaf5 ] || stop '数据盘 UUID 不符，停止。'
    OPTIONS=$(findmnt -rn --mountpoint /data -o OPTIONS)
    case ",$OPTIONS," in
        *,rw,*) ;;
        *) stop '数据盘不是读写挂载，停止。' ;;
    esac

    CLUSTERS=$(pg_lsclusters --no-header)
    [ -z "$CLUSTERS" ] || stop '发现已有集群，停止；不要删除或重复初始化。'
    for TARGET in /data/postgresql /etc/postgresql/18/main; do
        if sudo test -e "$TARGET" || sudo test -L "$TARGET"; then
            stop "目标路径已存在，停止检查：$TARGET"
        fi
    done

    sudo install -d -o postgres -g postgres -m 0700 /data/postgresql /data/postgresql/18
    sudo pg_createcluster \
        --datadir="$PGDATA" \
        --port=5432 \
        --start-conf=manual \
        --locale=en_US.UTF-8 \
        --encoding=UTF8 \
        -o listen_addresses=127.0.0.1 \
        -o password_encryption=scram-sha-256 \
        18 main -- --auth-local=peer --auth-host=scram-sha-256
)
```

**这是新实例的一次性初始化，不是可反复重跑的修复命令。** 任一阶段失败，包括目录已建但初始化失败：保存完整输出并停下，不删除残留目录、不重跑绕过检查、不运行 initdb 或 pg_dropcluster。程序若输出建议的启动命令，本阶段也不要执行。

#### 第二步：仅在初始化成功后读取结果，到这里停

```bash
pg_lsclusters
sudo cat /etc/postgresql/18/main/start.conf
sudo pg_conftool 18 main show data_directory
sudo pg_conftool 18 main show listen_addresses
sudo cat /data/postgresql/18/main/PG_VERSION
sudo ls -ld /data/postgresql /data/postgresql/18 /data/postgresql/18/main
sudo ss -lntp 'sport = :5432'
```

预期：

- pg_lsclusters 新增 `18 main 5432 down postgres /data/postgresql/18/main`，其后可有日志路径列；**down 是预期状态，不是故障**。
- start.conf 的有效值为 `manual`；这用于限制自动启动，不代表数据库实例永远不能启动。
- pg_conftool 回读 data_directory 为已选路径、listen_addresses 为 127.0.0.1；这些是文件配置，不冒充运行中 SHOW 参数验收。
- PG_VERSION 内容为 `18`；三个专用目录属主均为 postgres，按本方案默认不向普通用户开放。当前数据目录的具体权限以实际输出核对。
- 5432 仍没有监听。若意外 online、有监听或路径/属主不同，先回传，不自行杀进程、停止未知实例或迁移数据。

**完整初始化输出已回传成功，未回传的初始化后检查请统一按 4.3.8 执行。当前不要执行第 5 节的启动命令，也不设置数据库密码。** 下一步才为 `postgresql@18-main` 配置 `/data` 挂载依赖及条件检查、核对 HBA/SSL 和本机监听，再受控启动。fstab 保留 `defaults,nofail`；这次执行时的挂载检查不等于永久服务挂载保护已建立。

### 4.3.7.1 自定义目录初始化结果（用户已回传成功）

**补录日期：2026-09-17；精确执行时间未提供。** 信息来自用户本次聊天回传。初始化输出已完整结束并给出集群状态；Markdown 围栏及转义下划线按聊天展示处理，不据此误判 Bash 命令执行失败。助手未登录服务器。

| 核对项 | 用户回传 | 结论与边界 |
|---|---|---|
| 集群 | `Creating new PostgreSQL cluster 18/main ...`，末尾列出 18/main | 自定义集群初始化成功 |
| 实际 initdb 目标 | `-D /data/postgresql/18/main`，末尾目录相同 | 数据文件初始化于选定目录，不是根盘默认路径 |
| 属主 | 日志说明归 postgres；末尾 Owner=postgres | 初始化时集群属主已记录；后续 sudo ls 已确认三个专用目录均 postgres:postgres、0700（4.3.8.1） |
| 编码/locale | `--encoding UTF8 --locale en_US.UTF-8`，日志确认 locale | 默认系统数据库初始化设置已记录，不代表业务库排序规则已最终确定 |
| 文本搜索 | 默认 english | 仅记录初始化默认值，不将其当成业务全文检索设计 |
| 数据页校验和 | `Data page checksums are enabled.` | 本次初始化确认启用，不是备份或恢复演练的替代 |
| 初始化默认参数 | max_connections=100、shared_buffers=128MB、time zone=Asia/Shanghai | initdb 选择值；未运行服务，不当成运行中 SHOW 回读，也不是性能调优建议 |
| 初始化流程 | 权限、子目录、配置、bootstrap、post-bootstrap、syncing data to disk 均 ok | 日志未显示失败；不重复初始化 |
| 最终状态 | `18 main 5432 down postgres /data/postgresql/18/main` | 已创建、未运行；down 符合本阶段不启动的计划 |
| 日志路径 | `/var/log/postgresql/postgresql-18-main.log` | 记录实际管理工具输出的日志位置 |
| 本次 ss 输出 | 仅表头，无监听行；出现在初始化命令之前 | 仅证明初始化前该端口状态；不冒充初始化后的检查 |

关键输出摘录：

```text
Creating new PostgreSQL cluster 18/main ...
/usr/lib/postgresql/18/bin/initdb -D /data/postgresql/18/main --no-instructions --encoding UTF8 --locale en_US.UTF-8 --auth-local=peer --auth-host=scram-sha-256
The database cluster will be initialized with locale "en_US.UTF-8".
The default text search configuration will be set to "english".
Data page checksums are enabled.
selecting default "max_connections" ... 100
selecting default "shared_buffers" ... 128MB
selecting default time zone ... Asia/Shanghai
creating configuration files ... ok
running bootstrap script ... ok
performing post-bootstrap initialization ... ok
syncing data to disk ... ok
Ver Cluster Port Status Owner    Data directory           Log file
18  main    5432 down   postgres /data/postgresql/18/main /var/log/postgresql/postgresql-18-main.log
```

**本节历史结论：初始化操作成功，当时尚未启动。后续首次启动已尝试但失败，见 4.3.10.1。** 前置保护没有报告停止，不等于永久服务挂载保护已经建立。manual/监听/权限回读见 4.3.8.1；password_encryption、HBA、SSL 路径与 sudo 集群属主也已回传，见 4.3.8.3。4.3.9 配置脚本已回传完成，HBA/down/无监听也已回读，首次启动已失败，现已修复并 online，4.3.12 本地 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证。

- [x] ~~18/main 初始化待执行~~ → 已成功，目录及 down 状态已回传。
- [x] start.conf、data_directory、listen_addresses、PG_VERSION 和数据目录权限已回传（4.3.8.1）。
- [x] ~~sudo 集群视图、剩余参数、HBA 与 systemd unit/drop-in 待回传~~ → 已回传，见 4.3.8.3。
- [x] 初始化后的独立 5432 检查已回传：仅表头，无监听行（4.3.8.1）。
- [x] 后续实例挂载配置、HBA 文本及完整属性守卫已完成（4.3.9～4.3.10.1）。
- [x] 初次失败后已修复并启动成功（4.3.11.1）。
- [ ] SQL/隧道与开机恢复仍未完成。

### 4.3.8 首次启动前的配置与服务文件回读（已完成）

**本节只读回传已完成，不再重复。** 基础配置、版本、权限和端口检查见 4.3.8.1；sudo 集群属主、HBA/SSL 参数与 systemd 文件见 4.3.8.3。4.3.9 手动配置脚本也已完成，HBA/down/无监听也已补齐，4.3.10 守卫通过但首次启动失败，修复与启动现已通过，4.3.12 本地 SQL 已通过，下一步仅执行 4.3.13 Windows SSH 隧道验证；不把文件回读通过当作服务运行验收。

### 4.3.8.1 基础回读结果与 Owner=<unknown> 说明（已回传）

**补录日期：2026-09-17；命令精确执行时间未提供。** 三个目录 ls 行中的“9月 17 18:48”是目录时间字段，不当作各检查命令的执行时间。助手只读取用户回传，未远程操作。

| 核对项 | 实际回传 | 状态 |
|---|---|---|
| 普通用户 pg_lsclusters | 18/main、5432、down、Owner=`<unknown>`，数据目录和日志路径正确 | 原样保留历史；sudo 已显示 postgres（4.3.8.3），不是实际属主丢失 |
| start.conf | 有效行 `manual` | 已确认；不自动启动 |
| data_directory | `/data/postgresql/18/main` | 文件配置回读正确 |
| listen_addresses | `127.0.0.1` | 文件配置为仅本机；尚无运行中 SHOW 回读 |
| PG_VERSION | `18` | 已确认数据目录主版本 |
| /data/postgresql | `drwx------ postgres postgres` | 属主/组正确，0700 |
| /data/postgresql/18 | `drwx------ postgres postgres` | 属主/组正确，0700 |
| /data/postgresql/18/main | `drwx------ postgres postgres` | 属主/组正确，0700 |
| 初始化后 ss 检查 | 仅表头，无 TCP 5432 监听行 | 已补齐，不再标记未回传 |

关键输出摘录：

```text
Ver Cluster Port Status Owner     Data directory           Log file
18  main    5432 down   <unknown> /data/postgresql/18/main /var/log/postgresql/postgresql-18-main.log

manual
data_directory = '/data/postgresql/18/main'
listen_addresses = 127.0.0.1
18

drwx------  3 postgres postgres 4096  9月 17 18:48 /data/postgresql
drwx------  3 postgres postgres 4096  9月 17 18:48 /data/postgresql/18
drwx------ 19 postgres postgres 4096  9月 17 18:48 /data/postgresql/18/main

State   Recv-Q    Send-Q       Local Address:Port       Peer Address:Port   Process
```

#### 为什么普通用户看到 Owner=<unknown>

- 普通用户 t7920 执行的 pg_lsclusters 与 sudo 执行的 ls 拥有不同访问权限；t7920 拥有 /data 不意味着能穿过归 postgres 且权限为 0700 的下层目录。[S27]
- 维护者实现中，PgCommon 的 cluster_info 对 data_directory 调用 stat 获取 owneruid/ownergid；pg_lsclusters 无法取得 owneruid 时显示 `<unknown>`。这与本次路径权限和普通用户输出吻合；源码核对并不等于在用户服务器复现；后续 sudo 输出已显示 postgres，见 4.3.8.3。[S33][S36]
- **实际目录属主已经由 sudo ls 显示为 postgres:postgres。** 因此不能把普通用户工具中的 unknown 当成“属主真的不存在”“必须重新 chown”或数据库损坏。
- **保留现有 0700，不改为 0755/0777，不给整个 /data 递归改属主，也不删除重建。** 管理查询使用 sudo pg_lsclusters；这只改变查看命令的权限，不改变文件权限。
- **后续 sudo pg_lsclusters 已显示 postgres（4.3.8.3），此项已解决。** 不再列为待确认；保留严格目录权限。

- [x] ~~manual/路径/监听地址/版本文件/目录权限待回传~~ → 均已回传。
- [x] ~~初始化后 5432 检查待回传~~ → 已确认无监听。
- [x] ~~sudo 集群视图、剩余参数、HBA、systemd unit/drop-in 待回传~~ → 已回传，见 4.3.8.3。

### 4.3.8.2 剩余启动前信息读取命令（已回传，仅留档）

**下列只读命令已执行并回传，结果见 4.3.8.3，不需要再次执行。** 当时不重复基础项，额外 sudo 集群视图用于核对普通用户显示的 unknown。

**【服务器 Bash，整组只读，可一起执行】**

```bash
sudo pg_lsclusters

for KEY in hba_file port password_encryption ssl ssl_cert_file ssl_key_file; do
    printf '\n[%s]\n' "$KEY"
    sudo pg_conftool 18 main show "$KEY"
done

sudo cat /etc/postgresql/18/main/pg_hba.conf
sudo systemctl cat postgresql@18-main.service --no-pager
```

回读目的与下一步边界：

1. sudo pg_lsclusters 预期显示 Owner=postgres、状态 down。若仍未知或有异常，原样回传，不改权限或停止未知进程。[S33][S36]
2. pg_conftool 回读 hba_file、port、password_encryption 和 SSL/证书**路径**；不读取私钥内容，也不冒充运行中 SHOW 验收。某项为空或报错也原样回传，不自行补参数。[S32]
3. pg_hba.conf 用于核对 peer/SCRAM、trust 或额外规则和匹配顺序，再确定 postgres TCP 拒绝规则的位置；不能在没看实际文件时盲目追加后宣称已加固。如果 hba_file 指向其他路径，先回传，不把默认文件当成实际配置。[S11]
4. systemctl cat 展示目标实例使用的 unit 模板与既有 drop-in，供后续只增加必要挂载依赖/条件，不覆盖现有服务配置；它显示磁盘文件，不证明 systemd 已重载未来修改。[S20][S35]

**本组已回传完成。** 4.3.9 配置脚本也已完成，HBA/down/无监听也已补齐，4.3.10 守卫通过但首次启动失败，修复与启动现已通过，4.3.12 本地 SQL 已通过，下一步仅执行 4.3.13 Windows SSH 隧道验证。不改 fstab/UFW/整盘权限，不设超级用户 TCP 密码，不开放网络端口，也不重复安装或初始化。

### 4.3.8.3 剩余回读验收：属主、HBA、SSL 与 systemd（已完成）

**补录日期：2026-09-17；命令精确执行时间未提供。** 依据用户附件，不代表助手远程验收。原始附件按字节归档：`records/4.3.8_启动前剩余回读_用户回传_2026-09-17.txt`。

| 核对项 | 用户实际输出 | 判断与边界 |
|---|---|---|
| sudo pg_lsclusters | 18/main、5432、down、postgres；数据目录和日志路径正确 | 普通用户 unknown 已闭环；保留 0700，不重复 chown |
| hba_file / port | /etc/postgresql/18/main/pg_hba.conf；5432 | 文件回读正确，尚非运行中 SHOW |
| password_encryption | scram-sha-256 | 文件配置符合计划；不表示设置了密码 |
| SSL | on；证书 /etc/ssl/certs/ssl-cert-snakeoil.pem；私钥 /etc/ssl/private/ssl-cert-snakeoil.key | 保留 on；只确认配置路径，实际可读性已在 4.3.9.1 回传通过；不读取私钥内容，不声称可信 TLS 验收 |
| HBA（修改前快照） | 下列六条有效规则，无有效 trust/include | 当时尚未增加 postgres TCP 拒绝；后续 4.3.9 写入脚本已完成，修改后内容待 4.3.9.2 回读 |
| systemctl cat（修改前快照） | 当时仅显示 /lib/systemd/system/postgresql@.service 模板，未显示 drop-in | 后续已新增专属 drop-in，其内容与加载路径已在 4.3.9.2 回传；不要把旧快照当现状 |

修改前回传的六条有效 HBA 规则（历史快照，修改后结果见后续 4.3.9.2）：

```conf
local   all             all                                     peer
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
local   replication     all                                     peer
host    replication     all             127.0.0.1/32            scram-sha-256
host    replication     all             ::1/128                 scram-sha-256
```

- [x] ~~sudo 集群属主/剩余配置/HBA/systemd 文件待回传~~ → 已补齐。
- [x] ~~普通用户 Owner=unknown 是否需要修复权限~~ → sudo 显示 postgres，无须放宽权限。
- [x] ~~4.3.9 配置脚本待执行回传~~ → 已执行到最后，含 snapd 静态警告，见 4.3.9.1。
- [x] ~~4.3.9.2 专属 drop-in 内容和加载路径待回传~~ → 已收到。
- [x] ~~HBA/集群/端口待补齐~~ → 已回传，见 4.3.9.3。
- [x] ~~完整属性精确匹配待回传~~ → 4.3.10 三项均已通过，见 4.3.10.1，不再追问截断输出。
- [ ] 首次启动后的 SQL、实际监听、HBA 解析及 SSH 隧道验收，后续进行。

### 4.3.9 备份、挂载保护与认证加固（脚本及 HBA/状态回读已完成）

**下方配置脚本已经由用户手动执行，结果见 4.3.9.1；仅留档，不再执行。** 修复与启动现已通过，4.3.12 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，不重复修复或启动。脚本只针对上节已确认、操作前仍 down 的 18/main；助手只编写和本机检查语法，没有连接服务器或执行这些服务器命令。

本步只做三件事：

1. 备份当前 postgresql.conf、pg_hba.conf、start.conf 和原 systemd unit 内容，实际目录由 mktemp 生成并输出，请保留。
2. 新增实例专属 `/etc/systemd/system/postgresql@18-main.service.d/20-ee-data-mount.conf`，不编辑公共模板：追加自定义数据目录挂载依赖；将服务与 data.mount 绑定并排序；启动时要求 /data 为真正的挂载点且可写。[S30]
3. 在现有 HBA 最前插入四条 postgres 回环 TCP 拒绝规则，分别覆盖 IPv4/IPv6 普通数据库连接和物理复制连接；保留原六条规则与注释。socket peer 管理不变，不创建密码或业务角色。HBA 按首条匹配生效；物理复制需单列 replication。[S11]

**边界**：保留 /data 的 fstab `defaults,nofail`、整个数据盘及专用目录权限、start.conf=manual、127.0.0.1 监听和现有 ssl=on；不改时区、不调优、不启动、不重启、不拔盘演练。RequiresMountsFor 依赖追加不清空原模板依赖。这个 drop-in 不在每次启动时另行核验 UUID，挂载源仍由既有 fstab 指定；BindsTo 不是运行中磁盘故障的数据安全保证。[S29][S30]

**【服务器 Bash：已执行，仅留档；不要重跑】**

```bash
(
    set -euo pipefail
    stop() { printf '%s\n' "$*" >&2; exit 1; }
    UNIT=postgresql@18-main.service
    CONF_DIR=/etc/postgresql/18/main
    HBA=$CONF_DIR/pg_hba.conf
    DROP_DIR=/etc/systemd/system/postgresql@18-main.service.d
    DROP=$DROP_DIR/20-ee-data-mount.conf

    STATE=$(sudo pg_lsclusters --no-header 18 main | awk '{print $4}')
    [ "$STATE" = down ] || stop '实例不是 down，停止；不要修改运行中的实例。'
    sudo test -f "$HBA" || stop 'HBA 文件不存在，停止。'
    if sudo test -L "$HBA" || sudo test -L "$DROP_DIR"; then
        stop '配置路径是符号链接，停止核对。'
    fi
    if sudo test -e "$DROP" || sudo test -L "$DROP"; then
        stop '挂载保护文件已存在，停止，避免覆盖或重复执行。'
    fi

    RULES=$(sudo awk 'NF && $1 !~ /^#/ { $1=$1; print }' "$HBA")
    EXPECTED='local all all peer
host all all 127.0.0.1/32 scram-sha-256
host all all ::1/128 scram-sha-256
local replication all peer
host replication all 127.0.0.1/32 scram-sha-256
host replication all ::1/128 scram-sha-256'
    [ "$RULES" = "$EXPECTED" ] || stop 'HBA 已不同于回传的六条规则，停止，不覆盖。'

    sudo -u postgres test -r /etc/ssl/certs/ssl-cert-snakeoil.pem || stop 'postgres 无法读取证书，停止；不要修改权限，先回传。'
    sudo -u postgres test -r /etc/ssl/private/ssl-cert-snakeoil.key || stop 'postgres 无法读取私钥，停止；不要输出私钥或放宽权限。'
    printf '%s\n' '证书和私钥文件对 postgres 可读（未输出文件内容）。'

    BACKUP_DIR=$(sudo mktemp -d /root/ee-pg-prestart.XXXXXX)
    printf '配置备份目录：%s\n' "$BACKUP_DIR"
    sudo cp -a "$CONF_DIR/postgresql.conf" "$HBA" "$CONF_DIR/start.conf" "$BACKUP_DIR/"
    sudo systemctl cat "$UNIT" --no-pager | sudo tee "$BACKUP_DIR/systemd-unit-before.txt" >/dev/null

    sudo awk 'BEGIN {
        print "# EE stage1: postgres administration via local peer only"
        print "host all postgres 127.0.0.1/32 reject"
        print "host all postgres ::1/128 reject"
        print "host replication postgres 127.0.0.1/32 reject"
        print "host replication postgres ::1/128 reject"
        print ""
    } { print }' "$HBA" | sudo tee "$BACKUP_DIR/pg_hba.conf.new" >/dev/null
    sudo chown --reference="$HBA" "$BACKUP_DIR/pg_hba.conf.new"
    sudo chmod --reference="$HBA" "$BACKUP_DIR/pg_hba.conf.new"

    if ! sudo test -d "$DROP_DIR"; then
        sudo install -d -o root -g root -m 0755 "$DROP_DIR"
    fi
    sudo sh -c 'umask 022; set -C; cat > "$1"' sh "$DROP" <<'EOF'
[Unit]
RequiresMountsFor=/data/postgresql/18/main
BindsTo=data.mount
After=data.mount
AssertPathIsMountPoint=/data
AssertPathIsReadWrite=/data
EOF

    sudo cp -p "$BACKUP_DIR/pg_hba.conf.new" "$HBA"
    sudo systemctl daemon-reload
    sudo systemd-analyze verify "$UNIT"
    printf '%s\n' '配置已写入并完成 systemd 静态检查；数据库尚未启动。'
)
```

脚本会核对仍为 down、HBA 仍与上次六条规则一致、专属 drop-in 尚不存在；否则停止，不覆盖未知修改。只检测 postgres 能否读取证书/私钥，不输出内容。**任何报错先停并回传完整报错和实际备份路径，不要直接重跑，不要放宽私钥/数据目录权限。** 脚本不是事务，报错前可能已经写入部分配置；即使静态校验失败也不代表前面的修改自动撤销。不要套用第 11 节的重启恢复块。

`systemctl daemon-reload` 让 systemd 重读 unit 配置，不启动或重启数据库。`systemd-analyze verify` 只检查 unit 等静态内容，不解析 HBA、不执行 SQL，也不替代真实启动/挂载异常演练；如有警告，保留全文回传，不自行忽略。[S35][S37]

### 4.3.9.1 配置脚本执行结果与 snapd 静态警告（已回传）

**补录日期：2026-09-17；命令精确执行时间未提供。** 本次依据用户聊天回传的四行结果，转存至 `records/4.3.9_配置脚本执行结果_用户回传_2026-09-17.txt`；这是聊天文本转存，不声称为附件原始字节归档。

```text
证书和私钥文件对 postgres 可读（未输出文件内容）。
配置备份目录：/root/ee-pg-prestart.nwMAWg
/lib/systemd/system/snapd.service:23: Unknown key name 'RestartMode' in section 'Service', ignoring.
配置已写入并完成 systemd 静态检查；数据库尚未启动。
```

**结论：配置脚本已执行到最后，含一条指向其他 unit 的静态警告；不要重跑。** 按所提供脚本的 set -euo pipefail 流程，末尾完成提示说明此前操作没有以导致脚本退出的错误中断。但它不替代修改后的独立回读，也不表示“全部零警告”或“数据库已启动”。

| 核对项 | 本次可以确认 | 尚未确认/处理边界 |
|---|---|---|
| 证书与私钥 | postgres 可读检查已通过 | 未输出秘密内容；不是可信 TLS/客户端身份校验验收 |
| 备份 | 实际目录 `/root/ee-pg-prestart.nwMAWg` 已回传，脚本完成了后续操作 | 保留这份备份，不混同早期 createcluster.conf 的备份 |
| drop-in/HBA/daemon-reload | 写入与重载所在脚本已走到完成提示 | 后续 drop-in 内容/加载路径已回传；HBA/集群/端口已在 4.3.9.3 补齐；完整属性也已由 4.3.10 守卫核对通过，但随后启动失败，第 60 行语法错误现已定位，修复见 4.3.11 |
| 静态检查 | 记录了一条 snapd.service:23 的 RestartMode 未知键警告，随后脚本结束提示仍输出 | 不是 PostgreSQL unit 路径上的报错；不得标为无警告通过 |
| 数据库运行（当时快照） | 本配置脚本没有启动/重启命令，当时未启动 | 后续首次启动已尝试但失败，见 4.3.10.1；不沿用旧 down 快照判断失败后进程状态 |

**这条警告如何处理：**

- `systemd-analyze verify` 除目标 unit 外，还会加载被引用的其他 unit；因此可输出其他服务的警告。已核对官方文档的这项行为，但没有分析本机完整依赖链，不能据此断言 PostgreSQL 直接依赖 snapd。[S37]
- 输出明确指向 `/lib/systemd/system/snapd.service` 第 23 行：本机校验器不认识 RestartMode，于是 ignoring。官方说明该选项从 systemd 254 引入；本机 systemd 精确版本未回传，不擅自把 Ubuntu 版本当实际 systemd 版本证明。[S38]
- 这不是本次新增 `/etc/systemd/system/postgresql@18-main.service.d/20-ee-data-mount.conf` 中的键；本次脚本未修改 snapd.service。**只作为本轮非 PostgreSQL unit 警告记录，不修改 snapd、不升级 systemd、不重启服务器，也不移除数据库挂载保护。** 如后续需要维护 snapd，由管理员在单独任务中核对其软件包/版本及服务状态；这条警告本身不足以判定 snapd 的运行健康状态。
- 当时进入 4.3.9.2 回读；后续 HBA/down/无监听已在 4.3.9.3 补齐。4.3.10 完整依赖与挂载守卫已通过但启动失败；4.3.11 修复与启动已完成，4.3.12 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，不重复初始化。

- [x] ~~配置脚本输出与实际备份目录待回传~~ → 已回传。
- [x] ~~postgres 对证书/私钥的可读性待确认~~ → 已通过。
- [x] ~~新增 drop-in 内容/加载路径待回传~~ → 已回传，见下一节。
- [x] ~~HBA 和配置后集群/端口待回传~~ → 已在 4.3.9.3 补齐。
- [x] ~~完整依赖属性的守卫结果待回传~~ → 已通过，见 4.3.10.1。

### 4.3.9.2 首批变更回读（历史记录；剩余结果已补齐至 4.3.9.3）

**补录日期：2026-09-17；精确执行时间未提供。** 先收到完整 systemctl cat 与截断的 show，关键摘录在 `records/4.3.9.2_变更回读部分结果_用户回传_2026-09-17.txt`。专属 drop-in 五项内容和 DropInPaths 正确，BindsTo=data.mount，After 可见 data.mount。最初缺少 HBA/集群/端口输出，现已补齐，见 4.3.9.3。

此前 show 漏加 --no-pager 已修正。后续回传仍含 `>` 截断，但不能因此判定配置出错，也不能把缺失的完整路径补成“已实测”。**不再要求反复粘贴整组输出**：4.3.10 已通过无分页、--value 的属性精确匹配并打印三项通过，见 4.3.10.1；后续启动失败另行诊断，不重复修改挂载保护。[S35]

### 4.3.9.3 HBA、集群状态和端口补充回读（已通过）

**补录日期：2026-09-17；命令精确执行时间未提供。** 原始聊天中的转义已还原，输出转存至 `records/4.3.9.3_HBA与状态回读_用户回传_2026-09-17.txt`；不是附件原始字节归档，show 的 `>` 截断保留，不补全。

| 核对项 | 用户实际结果 | 判定 |
|---|---|---|
| HBA | 十条有效规则：先四条 postgres TCP reject，再原有六条 peer/SCRAM | 文件文本与预期一致，无 trust；数据库解析及实际登录验证尚未进行 |
| 普通/物理复制限制 | IPv4 与 IPv6 各有 all/postgres 与 replication/postgres reject | 顺序正确，socket peer 保留 |
| sudo pg_lsclusters | 18/main、5432、down、postgres；数据目录 /data/postgresql/18/main；日志路径正确 | 配置后的独立集群状态已回传，尚未启动 |
| ss | 只有表头，没有监听行 | 本次 TCP 5432 无监听已确认 |
| systemd | DropInPaths 正确；After/RequiresMountsFor 仍有截断 | 已确认部分保留；完整属性由下一节在启动前精确校验，不冒充全量回读通过 |

- [x] ~~修改后的 HBA 文本待回传~~ → 十条规则及顺序已确认。
- [x] ~~修改后集群与 TCP 5432 状态待回传~~ → down/postgres，5432 无监听。
- [x] ~~完整 RequiresMountsFor/BindsTo/After 值匹配待回传~~ → 4.3.10 三项通过，截断问题已闭环。
- [ ] 首次启动、服务端 SQL、运行参数/HBA 解析及 SSH 隧道：尚未完成。

### 4.3.10 首次启动尝试（历史：守卫通过，因配置语法错误失败）

> 后续已按 4.3.11 修复并启动成功（4.3.11.1）。本节保留失败过程，下面的“未启动/不执行 SQL”等措辞属于当时的暂停边界；4.3.12 的统一 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证，不重跑启动或修复。

**本节第一步已经由用户执行：守卫通过，启动请求失败；第二步 SQL 不执行。** 结果见 4.3.10.1，4.3.11 修复与启动也已完成，4.3.12 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证。下方原启动/SQL 命令保留供排障后参考，现在不要重跑。助手没有连接或操作服务器；不修改 manual，不配置开机自启，不创建业务库/业务角色/schema/表。

#### 第一步：原启动命令（已尝试并失败，仅留档，不重跑）

启动前自动核对：实例仍为 down、/data 仍是已确认 UUID 的读写挂载，以及 systemd 当前属性包含完整自定义路径与 data.mount。属性通过命令替换读取，不经过分页器；用完整单项匹配避免把截断路径当通过。本步的 UUID 核对仅覆盖本次启动，不冒充已经配置每次启动自动核对 UUID 的永久机制。

**【服务器 Bash：本次已执行，仅留档；当前不要重试】**

```bash
(
    set -euo pipefail
    stop() { printf '%s\n' "$*" >&2; exit 1; }
    UNIT=postgresql@18-main.service

    STATE=$(sudo pg_lsclusters --no-header 18 main | awk '{print $4}')
    [ "$STATE" = down ] || stop '实例不是 down，停止；不要重复启动。'

    UUID=$(sudo findmnt -rn --mountpoint /data -o UUID) || stop '/data 未正确挂载，停止。'
    [ "$UUID" = 7a36a8d0-78cb-4385-8660-ebd3522bfaf5 ] || stop '数据盘 UUID 不符，停止。'
    OPTIONS=$(findmnt -rn --mountpoint /data -o OPTIONS)
    case ",$OPTIONS," in
        *,rw,*) ;;
        *) stop '数据盘不是读写挂载，停止。' ;;
    esac

    for PROP in RequiresMountsFor BindsTo After; do
        VALUE=$(sudo systemctl --no-pager show "$UNIT" --property="$PROP" --value)
        case "$PROP" in
            RequiresMountsFor) WANTED=/data/postgresql/18/main ;;
            *) WANTED=data.mount ;;
        esac
        case " $VALUE " in
            *" $WANTED "*) printf '%s 检查通过：%s\n' "$PROP" "$WANTED" ;;
            *) stop "$PROP 缺少完整预期值，停止：$VALUE" ;;
        esac
    done

    sudo systemctl start "$UNIT"
    sudo systemctl is-active "$UNIT"
    sudo systemctl --no-pager --full status "$UNIT"
    sudo pg_lsclusters
    sudo ss -lntp 'sport = :5432'
)
```

**成功预期**：打印三项属性检查通过；目标服务 active/running；sudo pg_lsclusters 为 18/main、5432、online、postgres；ss 只出现 `127.0.0.1:5432` 的 PostgreSQL TCP 监听。只看管理总入口 postgresql.service 的 active(exited) 不能证明实例可用。[S10][S35]

若 guard 报错、启动失败或监听不符合预期，**停止后续步骤并回传完整输出**。不要为了让检查通过删除 guard、重写 HBA、放宽监听或权限；不要重复初始化。脚本不是事务，启动后若状态读取失败，实例可能已经运行，不要盲目重跑或以为已自动回滚。

#### 第二步：原只读 SQL 示例（统一改按 4.3.12 执行，不重复）

使用操作系统 postgres 经 Unix socket/peer 连接默认 postgres 系统库，不设置密码。`-X` 不加载用户 psqlrc，`-w` 不进入密码提示，`-P pager=off` 关闭 SQL 分页，SQL 出错停止后续查询。以下均为 SELECT，不创建业务对象。[S11][S39]

```bash
sudo -u postgres /usr/lib/postgresql/18/bin/psql \
    -X -w -v ON_ERROR_STOP=1 -P pager=off \
    -h /var/run/postgresql -p 5432 -U postgres -d postgres <<'SQL'
SELECT current_setting('server_version') AS server_version,
       current_user, current_database();

SELECT name, setting, pending_restart
FROM pg_settings
WHERE name IN ('data_directory', 'config_file', 'hba_file',
               'server_encoding', 'listen_addresses', 'port',
               'password_encryption', 'TimeZone', 'log_timezone', 'ssl')
ORDER BY name;

SELECT sourcefile, sourceline, name, error
FROM pg_file_settings
WHERE error IS NOT NULL;

SELECT rule_number, type, database, user_name, address, auth_method, error
FROM pg_hba_file_rules
ORDER BY rule_number NULLS LAST, line_number;
SQL
```

核对标准：

- 服务端版本为 18.x；current_user/current_database 均为 postgres。服务端版本以 SQL 实测为准，不用客户端包版本代替。
- data_directory=/data/postgresql/18/main；config_file 与 hba_file 分别指向 /etc/postgresql/18/main 下相应文件；server_encoding=UTF8。
- listen_addresses=127.0.0.1、port=5432、password_encryption=scram-sha-256、ssl=on；保留初始化时区 Asia/Shanghai，相关 pending_restart=f。
- pg_file_settings 错误查询为 0 行；pg_hba_file_rules 十条规则顺序正确、error 均为 NULL/空白。注意：该 HBA 视图读取当前文件内容，不是最后加载规则的历史快照；不能代替真实账号/连接方式的认证测试。[S14][S15][S18]
- 系统默认库的本地 SELECT 成功不等于 Windows 隧道或业务账号已可登录；可信 TLS、业务角色与业务建库仍在后续阶段。

**原启动输出已回传失败，历史故障已按 4.3.11 修复并成功启动，4.3.12 的统一 SQL 已通过，当前只执行 4.3.13 Windows SSH 隧道验证 块，不重复本节步骤。** 保留 manual；启动原因查清并成功运行后再做本地 SQL、开机策略与 SSH 隧道，不直接编辑或重启试错。

### 4.3.10.1 首次启动失败记录（历史摘要；原因现见 4.3.11）

> 本节保留从汇总错误到截断日志的诊断经过；后续完整日志已定位主配置第 60 行语法错误。以 4.3.11 为当前结论，不再执行下面历史阶段的日志收集建议。

**补录日期：2026-09-17；精确执行时间未提供。** 用户聊天输出转存至 `records/4.3.10.1_首次启动失败_用户回传_2026-09-17.txt`，转义还原，不声称为附件原始字节归档。

```text
RequiresMountsFor 检查通过：/data/postgresql/18/main
BindsTo 检查通过：data.mount
After 检查通过：data.mount
Job for postgresql@18-main.service failed because the service did not take the steps required by its unit configuration.
See "systemctl status postgresql@18-main.service" and "journalctl -xeu postgresql@18-main.service" for details.
```

| 检查项 | 本次结论 | 边界 |
|---|---|---|
| 启动前 down/UUID/rw 守卫 | 脚本已走到后续属性检查并发起启动，前置判断没有中止 | 只覆盖当次启动前状态，不保证运行时磁盘永不故障 |
| RequiresMountsFor | 完整 /data/postgresql/18/main 匹配通过 | 之前展示截断的问题已闭环，不再追问整行输出 |
| BindsTo / After | 两项 data.mount 匹配通过 | 不需要重新加 drop-in 或反复 daemon-reload |
| systemctl start / 后续 status | 启动失败；status 确认 failed (Result: protocol)，故障时刻 2026-09-17 19:54:39 CST | PostgreSQL 底层错误正文仍被截断；不预判根因 |
| 后续状态/SQL | 启动块在 start 失败处中止；用户随后单独回传 failed status 与截断 journal，SQL 不执行 | 失败后的集群/端口尚未独立回读，不能沿用之前 down/无监听下结论 |

**不根据此摘要直接归因于权限、PID 文件、SSL、挂载或数据损坏。** 前一轮 snapd/RestartMode 警告指向其他 unit，现有信息也不足以把它当本次启动失败原因。先查看目标实例的 systemd 与 PostgreSQL 日志，再决定是否需要针对性修正；不为了试错修改通用 unit、数据目录权限、HBA 或删除重建。

- [x] ~~完整 systemd 属性与数据盘守卫待回传~~ → 已通过。
- [ ] 首次启动成功：本次失败，不能勾选。
- [x] ~~systemd 当前服务状态待回传~~ → 已确认 failed (Result: protocol)。
- [x] ~~完整底层错误待回传~~ → 已定位配置第 60 行语法错误，见 4.3.11。
- [ ] 具体第 60 行原文及修复后的进程/监听结果尚待回传。
- [ ] 本地 SQL、运行参数/HBA 解析、SSH 隧道：未验收。

#### 同轮补充：已收到 failed 状态，但关键日志正文仍截断

- 故障时间为 **2026-09-17 19:54:39 CST（UTC+08:00）**，不是读取命令的精确执行时间；不要将相对“5min ago”反推为精确查询时刻。PostgreSQL 行前缀的 11:54:39 GMT 与其为同一时刻，仅凭该前缀不能判断时区配置错误。
- `pg_ctl: could not start server` 和 `Examine the log output.` 已可见；前面的两条 PostgreSQL 原始错误仍只显示日期/PID 前缀。状态/日志关键摘录转存至 `records/4.3.10.1_失败状态与截断日志_用户回传_2026-09-17.txt`，保留截断，不补全错误内容。
- PID 警告出现在启动错误之后。**从日志顺序推断，它可能是启动未成功后的连带现象，而不是已证实的 PID 权限根因。** systemd 的 forking/PIDFile 机制会在启动后读取服务 PID；当前不能据此 mkdir/chown/chmod 或删除 PID 文件。[S42]
- `Loaded: ... disabled` 是启用状态，不是该服务无法手工启动的根因证明；本实例已选择 start.conf=manual，本来允许手动启动。不要为了试错执行 enable 或改 auto。[S3][S35]
- 只有完整 PostgreSQL 错误才能支持具体修复。官方启动故障指引也要求先查看服务端日志，本轮选择读取现有日志，而不是再额外启动一个前台进程。[S41]

### 4.3.10.2 日志补充方法（关键错误已补齐，仅留档，不重复）

**日志补充目标已完成**：用户后续已给出 PostgreSQL 第 60 行语法错误，见 4.3.11。不重复索要相同日志；下方只读命令留作后续新故障参考，不是当前必做步骤。[S40][S41]

**【服务器 Bash：两条均为只读，直接在正常提示符下执行】**

```bash
sudo tail -n 80 /var/log/postgresql/postgresql-18-main.log

sudo journalctl --no-pager --full -u postgresql@18-main.service -b -n 80 -o short-iso
```

如果仍停留在分页器，先按 q 退出；已有 shell 提示符则不需要。上面的命令关闭分页并保留完整行，终端正常换行不等于丢失内容。请复制完整输出，尤其是两条 PostgreSQL 日期行后面的错误正文；不要只截取最后的 PID 文件提示。[S40]

若实例日志文件不存在或某条命令报错，原样回传，不创建、删除或清空日志。不要执行 start/restart/reset-failed/enable，不修改 PID 文件/目录权限、数据目录、监听、HBA 或通用 unit，不重复初始化，不先做 SQL；是否存在残留进程/监听尚未独立确认，不据此猜测并停止其他进程。

日志中如意外出现密码/令牌/私钥内容先脱敏，不需要提供服务器登录凭据。**该故障现已按 4.3.11 修复、服务运行成功且 4.3.12 本地 SQL 已通过；当前只执行 4.3.13 Windows SSH 隧道验证，不重复日志收集。** 本阶段仍不创建业务库；保留数据、配置、挂载保护及备份。

### 4.3.11 配置语法错误定位与单行修复（已完成，仅留档）

> 服务已 online，下方原修复/启动脚本不再执行。其中“匹配后修改”“成功后启动”等是历史步骤，不是当前待办。修复前备份实际路径见 4.3.11.1。

**本节的修复与启动已由用户执行成功，验收见 4.3.11.1，不重复执行下方命令。当前入口为 4.3.12 的只读 SQL。** 下方保留故障定位与修复经过。 用户后续回传显示 PostgreSQL 在读取 `/etc/postgresql/18/main/postgresql.conf` 第 60 行时遇到 `.0` 附近语法错误，随后 FATAL 退出；关键日志存入 `records/4.3.11_配置语法错误定位_用户回传_2026-09-17.txt`。仍为 2026-09-17 19:54:39 CST 的同一次启动失败，重复日志不当作再次启动。

```text
LOG: syntax error in file "/etc/postgresql/18/main/postgresql.conf" line 60, near token ".0"
FATAL: configuration file "/etc/postgresql/18/main/postgresql.conf" contains errors
```

#### 已确认事实与待核对的具体写法

- **已确认**：阻止本次 PostgreSQL 启动的是主配置文件第 60 行的语法错误。PID 文件提示出现在其后；本轮先修配置，不据此 chown/chmod PID 目录或删除 PID 文件，不需要重装/重建数据库。
- **已由 4.3.11.1 原文确认**：修复前第 60 行确为 `listen_addresses = 127.0.0.1`；现已改为 `listen_addresses = '127.0.0.1'`，原注释保留，解析与启动通过。这是配置文件字符串引用问题。[S43]
- **对前序指引的纠正**：原初始化参考命令使用 `-o listen_addresses=127.0.0.1`，没有确保最终配置文件中该值被正确引用；此前 pg_conftool 回读和 systemd 静态检查也不等于 PostgreSQL 自身解析，遗漏了能提前发现此错误的检查。这是前序指引的问题，不能归咎于用户照步骤操作。
- 维护者 PgCommon 源码的自动引用逻辑将纯数字和点的序列当数字处理，能解释为何工具可能写出未加引号的 IP；未读取服务器本地管理工具源码，不把源码参考当作服务器版本实测。也不要简单把含单引号的值再交给管理工具，以免被再次转义。本次直接严格匹配文件原文、只补一处文本引号，再用 postgres -C 验证。[S33]
- 本节会打印并严格匹配第 60 行，**只有确实是该未加引号的本机地址才写入**；内容不符、已经修好、实例正在运行或配置文件为符号链接时均停止，不盲目替换。

#### 第一步：备份、仅补第 60 行引号，再由 PostgreSQL 自身解析

**【服务器 Bash：已执行，仅留档；服务已 online，不重复修复】**

```bash
(
    set -euo pipefail
    stop() { printf '%s\n' "$*" >&2; exit 1; }
    CONF=/etc/postgresql/18/main/postgresql.conf

    STATE=$(sudo pg_lsclusters --no-header 18 main | awk '{print $4}')
    [ "$STATE" = down ] || stop '实例不是 down，停止，不修改运行中的配置。'
    if ! sudo test -f "$CONF" || sudo test -L "$CONF"; then
        stop '配置文件不存在或是符号链接，停止核对。'
    fi

    LINE=$(sudo sed -n '60p' "$CONF")
    printf '修复前第 60 行：%s\n' "$LINE"
    printf '%s\n' "$LINE" | grep -Eq '^[[:space:]]*listen_addresses[[:space:]]*=[[:space:]]*127[.]0[.]0[.]1[[:space:]]*(#.*)?$' \
        || stop '第 60 行不是预期的未加引号监听地址，未修改；请回传这一行。'

    BACKUP_DIR=$(sudo mktemp -d /root/ee-pg-syntax-fix.XXXXXX)
    sudo cp -a "$CONF" "$BACKUP_DIR/postgresql.conf"
    printf '本次修复前备份：%s/postgresql.conf\n' "$BACKUP_DIR"

    sudo sed -i "60s/127[.]0[.]0[.]1/'127.0.0.1'/" "$CONF"
    sudo sed -n '60p' "$CONF"

    VALUE=$(sudo -u postgres /usr/lib/postgresql/18/bin/postgres \
        -D /data/postgresql/18/main \
        -c config_file="$CONF" -C listen_addresses)
    [ "$VALUE" = 127.0.0.1 ] || stop "解析得到的监听地址不符，停止：$VALUE"
    printf '%s\n' 'postgresql.conf 解析及监听地址检查通过；尚未启动。'
)
```

预期第 60 行变为 `listen_addresses = '127.0.0.1'`（原有空白/注释保留），并输出“postgresql.conf 解析及监听地址检查通过；尚未启动”。保留实际生成的 `/root/ee-pg-syntax-fix.XXXXXX/postgresql.conf` 备份路径；原 `/root/ee-pg-prestart.nwMAWg` 也不删除。

`postgres -C` 读取配置及本次命令行参数后输出指定值并退出，不是启动服务，也不代表正在运行实例的 SHOW 结果。这里用于发现配置读取/语法错误并确认监听地址；它不替代 HBA、证书、实际启动和 SQL 验收。[S44]

**任何不匹配或解析错误都停止，不执行第二步。** 回传打印的第 60 行、完整错误和已产生的实际备份路径即可；脚本中途失败不自动回滚。不要改其他行、HBA、挂载保护、权限或业务数据。

#### 第二步：原修复后启动命令（已成功，仅留档，不重跑）

保留已有 mount 保护与 start.conf=manual。只有上一块明确输出解析及监听地址检查通过，才执行此块；不是跳过修复再次盲目重试。

```bash
(
    set -euo pipefail
    sudo systemctl start postgresql@18-main.service
    sudo systemctl --no-pager --full status postgresql@18-main.service
    sudo pg_lsclusters
    sudo ss -lntp 'sport = :5432'
)
```

预期服务 active(running)、18/main 为 online/postgres、监听仅为 127.0.0.1:5432。若仍失败，先看新日志，不循环 start，不改 PID 权限试错。status/监听检查失败时服务也可能已经运行，不把脚本退出当作自动回滚。

**修复块、实际备份路径和启动结果已完整收到，见 4.3.11.1。** 现在只执行 4.3.12 的只读 SQL；不建业务库、不改 auto、不开放外网端口，不重复本节修复或启动。

- [x] ~~底层启动错误正文待补齐~~ → 已定位第 60 行语法错误。
- [x] ~~原第 60 行匹配、备份与单行修复待执行~~ → 已成功回传，见 4.3.11.1。
- [x] ~~PostgreSQL 自身 -C 解析及修复后启动待回传~~ → 解析通过，服务 online，见 4.3.11.1。
- [ ] 本地 SQL/HBA 数据库解析及 SSH 隧道：未验收。

### 4.3.11.1 单行修复、配置解析及服务启动验收（已通过）

**补录日期：2026-09-17。** 以用户完整附件为依据，原始文件按字节归档至 `records/4.3.11.1_语法修复与启动成功_用户回传_2026-09-17.txt`。本次修复命令的精确执行时刻未提供；systemd 显示成功启动时刻为 **2026-09-17 20:33:36 CST（UTC+08:00）**，不是泛指当前实时状态。助手未连接服务器。

| 验收项 | 用户回传结果 | 判断与边界 |
|---|---|---|
| 修复前第 60 行 | `listen_addresses = 127.0.0.1`，带原有注释 | 缺少单引号已由原文确认，不再只是推测 |
| 修复前备份 | `/root/ee-pg-syntax-fix.ihwbLk/postgresql.conf` | 已记录实际路径，备份保存的是修复前错误配置 |
| 修复后第 60 行 | `listen_addresses = '127.0.0.1'`，注释保留 | 预期单行修复已完成 |
| postgres -C 检查 | 脚本打印解析及监听地址检查通过 | 本次配置读取与监听值已核对；不能替代运行中 SQL/HBA 视图验收 |
| 服务状态 | active (running)；ExecStart status=0/SUCCESS；Main PID 1593662 | 本次启动成功，PID 为此次快照，不应硬编码到后续命令 |
| 集群 | 18/main、5432、online、postgres | 软件安装不再是唯一完成项，实例运行已通过 |
| 数据/配置路径 | 集群数据目录 /data/postgresql/18/main；进程参数 config_file=/etc/postgresql/18/main/postgresql.conf | 与计划相符，SQL 回读仍待下一节 |
| TCP 5432 | Local Address:Port 为 127.0.0.1:5432，进程 postgres | 当前仅回环监听；Peer Address 的 0.0.0.0:* 不是本机对所有网卡监听的证据 |
| systemd 启用状态 | loaded / disabled，专属 drop-in 仍存在 | 手动启动成功与自动启动是两件事；本步未调整 manual/auto，不因 disabled 重装或 enable |

关键结果：

```text
修复前第 60 行：listen_addresses = 127.0.0.1            # what IP address(es) to listen on;
本次修复前备份：/root/ee-pg-syntax-fix.ihwbLk/postgresql.conf
listen_addresses = '127.0.0.1'          # what IP address(es) to listen on;
postgresql.conf 解析及监听地址检查通过；尚未启动。
Active: active (running) since Thu 2026-09-17 20:33:36 CST
18 main 5432 online postgres /data/postgresql/18/main /var/log/postgresql/postgresql-18-main.log
LISTEN 0 200 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=1593662,fd=6))
```

**故障闭环**：首次失败的第 60 行语法错误现已修复，随后无需改 PID 权限即启动成功；此前 PID 提示不再作为本次待解决故障。保留失败日志与操作勘误，不删除历史。**不要重跑修复、初始化或启动，也不需为“清除 failed”额外 restart/reset-failed。**

**备份提醒**：`/root/ee-pg-syntax-fix.ihwbLk/postgresql.conf` 是修复前坏配置；更早的 `/root/ee-pg-prestart.nwMAWg/postgresql.conf` 也在修复之前备份，不当作验证通过的恢复基线，整份覆盖可能重新引入缺少引号的问题。保留作追溯，但不能盲目恢复。下一阶段确定备份/恢复策略另行处理，本轮不再写服务器文件。

- [x] ~~原第 60 行内容、修复前备份和单行修复待回传~~ → 已全部确认。
- [x] ~~postgres -C 解析及服务启动待回传~~ → 已通过，online 且回环监听。
- [x] 本地 socket SQL、实际版本/配置与 HBA 解析：4.3.12 已通过。
- [ ] 开机策略最终验收、整机恢复演练、SSH 隧道、业务账号登录：不因本次 SQL 验收提前勾选。

### 4.3.12 已通过：运行中的本地 SQL 与配置只读验收

**用户于 2026-09-17 手动执行了本节只读查询并完整回传；助手未连接服务器。** 保留现有 `manual`；查询使用系统 `postgres` 经 Unix socket/peer 连接默认 `postgres` 系统库，没有设置密码、开放 TCP 超级用户登录、编辑配置或创建业务库/账号。原查询命令用于留档，不需要重复执行。[S11][S39]

**【服务器 Bash：直接执行整块，只读】**

```bash
sudo -u postgres /usr/lib/postgresql/18/bin/psql \
    -X -w -v ON_ERROR_STOP=1 -P pager=off \
    -h /var/run/postgresql -p 5432 -U postgres -d postgres <<'SQL'
SELECT current_setting('server_version') AS server_version,
       current_user, current_database();

SELECT name, setting, pending_restart
FROM pg_settings
WHERE name IN ('data_directory', 'config_file', 'hba_file',
               'server_encoding', 'listen_addresses', 'port',
               'password_encryption', 'TimeZone', 'log_timezone', 'ssl')
ORDER BY name;

SELECT sourcefile, sourceline, name, error
FROM pg_file_settings
WHERE error IS NOT NULL;

SELECT rule_number, type, database, user_name, address, auth_method, error
FROM pg_hba_file_rules
ORDER BY rule_number NULLS LAST, line_number;
SQL
```

#### 实际验收结果

- 服务端版本为 `18.6 (Ubuntu 18.6-1.pgdg22.04+2)`；`current_user=postgres`、`current_database=postgres`，本地 socket/peer 管理路径可用。
- `config_file=/etc/postgresql/18/main/postgresql.conf`、`hba_file=/etc/postgresql/18/main/pg_hba.conf`、`data_directory=/data/postgresql/18/main`，与目标路径一致。
- `server_encoding=UTF8`、`listen_addresses=127.0.0.1`、`port=5432`、`password_encryption=scram-sha-256`、`ssl=on`、`TimeZone/log_timezone=Asia/Shanghai`。所查询的十项参数均为 `pending_restart=f`。
- `pg_file_settings` 的错误查询返回 0 行，说明服务端未报告当前配置文件解析错误。
- `pg_hba_file_rules` 成功解析十条规则，所有 `error` 字段为空：前四条拒绝 `postgres` 经 IPv4/IPv6 TCP 进行普通连接及物理复制；后六条为本地 peer 和回环地址 SCRAM。规则解析成功不等于已完成真实 TCP 密码认证测试。[S14][S15][S18]
- 结合 4.3.11.1 的 `ss` 结果，服务仍只监听 `127.0.0.1:5432`；没有新增内网或公网数据库入口。

本节已完成，但不代表 Windows SSH 隧道、GUI、业务账号、业务数据库、可信 TLS 或整机重启恢复已经验收。

### 4.3.13 当前下一步：Windows SSH 隧道与可达性验证（待用户执行）

**此步不再修改 Ubuntu 服务器的 PostgreSQL 配置，不重启、不建库、不建角色。** 在 Windows 按第 8.2 节建立仅绑定本机回环地址的 SSH 隧道，再按第 8.3 节执行 `Test-NetConnection` 和 `pg_isready`。

- 隧道应为 `127.0.0.1:15432` → SSH → 服务器 `127.0.0.1:5432`；不要把数据库 `5432` 直接对内网或公网开放。
- 预期 `Test-NetConnection -ComputerName 127.0.0.1 -Port 15432` 的 `TcpTestSucceeded=True`，以及 `pg_isready` 输出 `accepting connections`、退出码 `0`。
- `pg_isready` 通过只证明通路和服务器就绪，不证明账号密码认证成功。
- 当前 HBA 明确拒绝 `postgres` 通过 TCP 登录，所以**不要**尝试用 `postgres` 经隧道做成功密码登录测试，也不要临时加入 `trust` 或放开超级用户 TCP。后续创建专用非超级用户/应用角色后，再验证真实密码登录。
- `start.conf` 仍为 `manual`，`systemctl` 显示 `disabled` 不表示本次手动启动失败；当前不执行 `enable`、不改成 `auto`，整机重启恢复演练另行安排。

---
## 5. 识别实例，验证服务端 SQL

> **服务已修复并正常运行，4.3.12 的只读 SQL 已通过；当前统一入口为 4.3.13 的 Windows SSH 隧道验证。** 本节保留通用识别/SQL 示例供参考，不重复本节启动命令；不要为消除历史失败状态重启数据库。

### 5.1 查看集群

**【服务器 Bash】**

```bash
sudo pg_lsclusters
/usr/lib/postgresql/18/bin/psql --version
```

下方是**完成 4.3.3 自定义初始化和受控启动后**的预期示例，不是当前实际结果。数据目录必须为用户已确认的 `/data/postgresql/18/main`；用实际 `pg_lsclusters` 和 `SHOW data_directory` 验收，实例名称及端口也须一致：

```text
Ver  Cluster  Port  Status  Owner     Data directory
18   main     5432  online  postgres  /data/postgresql/18/main
```

- 若没有 `18 main`，先看安装日志和 `/etc/postgresql-common/createcluster.conf`，不要重复初始化。
- 若是 5433 或其他端口、其他 cluster 名称，停止核对原因。本手册的 `18/main/5432` 不能原样套用。
- 在 4.3.7 刚初始化且使用 manual 时，down 是预期状态，不是故障。只有实例挂载保护、认证规则和监听范围均核对完成后，才允许执行本节启动命令；出现未知错误或其他冲突则先停止核对。[S3][S10]

以下是启动命令的通用参考；**本实例按 4.3.10 的带守卫版本操作，不单独执行此块，也不在成功后重复启动**：

```bash
sudo systemctl start postgresql@18-main
systemctl is-active postgresql@18-main
sudo systemctl status postgresql@18-main --no-pager
```

预期 `active` / `active (running)`。`postgresql.service` 是集群管理入口，不能只看它的 `active (exited)` 就断言数据库已正常。

### 5.2 本地 socket 登录与只读查询

**【服务器 Bash】**

```bash
cd /tmp
sudo -u postgres /usr/lib/postgresql/18/bin/psql -X -v ON_ERROR_STOP=1 \
  -h /var/run/postgresql -p 5432 -d postgres \
  -c "SELECT version(), current_user, current_database();"
```

这里切换为系统用户 `postgres`，通过 Unix socket 执行只读 SQL；不会新建账号或库。peer 认证只适用于本地连接，不能拿它解释通过 TCP 隧道的密码认证。[S11]

预期：服务端版本是 18.x，用户和数据库都是 `postgres`。

核对真正使用的配置/数据位置与编码：

```bash
sudo -u postgres /usr/lib/postgresql/18/bin/psql -X -v ON_ERROR_STOP=1 \
  -h /var/run/postgresql -p 5432 -d postgres \
  -c "SHOW config_file; SHOW hba_file; SHOW data_directory; SHOW server_encoding;"
```

继续第 6 节前确认：

- `config_file` = `/etc/postgresql/18/main/postgresql.conf`。
- `hba_file` = `/etc/postgresql/18/main/pg_hba.conf`。
- `data_directory` = `/data/postgresql/18/main`，且 `/data` 确实挂载于已核对的数据盘，不能只核对路径字符串。
- `server_encoding` = `UTF8`。

路径不同就以实际配置另行调整，不要修改一个未被使用的同名文件。编码不符合预期时先停下，不尝试直接编辑系统表或销毁集群重建。[S4]

---

## 6. 备份配置，建立阶段一安全基线

**本节只适用于刚装好的、没有业务用户和数据的新实例。重启会断开连接，不得照搬到生产实例。**

### 6.1 备份

**【服务器 Bash】**

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/root/ee-pg-config-backups/$STAMP"
sudo install -d -m 0700 "$BACKUP_DIR"
sudo cp -a /etc/postgresql/18/main/postgresql.conf "$BACKUP_DIR/postgresql.conf"
sudo cp -a /etc/postgresql/18/main/pg_hba.conf "$BACKUP_DIR/pg_hba.conf"
sudo cp -a /etc/postgresql/18/main/start.conf "$BACKUP_DIR/start.conf"
sudo ls -l "$BACKUP_DIR"
printf '请记录本次配置备份路径：%s\n' "$BACKUP_DIR"
```

每条都成功后才编辑。把实际备份路径记下来；重新登录后 `$BACKUP_DIR` 不会自动保留。

备份目录仅供 root 读取，不要放到公开下载目录或提交到 Git。

这只是**配置备份**，不是数据库数据备份。下一阶段正式写业务数据前还需建立备份/恢复方案。

### 6.2 配置监听、默认时区与未来密码存储方式

**本实例当前不执行本节编辑命令。** 127.0.0.1、5432、SCRAM 已经由 4.3.8 回读确认，4.3.9 不重复改写这些参数，也不改时区。下方是需要修正配置时的参考。

**【服务器 Bash】**

```bash
sudoedit /etc/postgresql/18/main/postgresql.conf
```

找到对应设置，取消注释并修改；不要不断追加重复配置。若不熟悉默认编辑器且已有 nano，可以使用 `SUDO_EDITOR=nano sudoedit ...`；nano 中 `Ctrl+O` 保存、回车确认、`Ctrl+X` 退出。

**【配置文件内容】**

```conf
listen_addresses = '127.0.0.1'
port = 5432
password_encryption = 'scram-sha-256'
# 首次启动保留 initdb 选择的 Asia/Shanghai；不要仅为套用示例而改时区。
```

本阶段明确只监听 IPv4 本机地址，避免 `localhost` 的 IPv4/IPv6 解析差异。首次启动后记录 TimeZone/log_timezone 的实际值；如后续项目决定统一 UTC，再单独讨论实施，不在本次加固中悄悄修改。不要改 `data_directory`、默认内存参数、最大连接数、WAL 参数，不关闭 `fsync`/`full_page_writes`/`autovacuum` 来追求性能。

- 修改监听地址/端口需要重启实例。[S12]
- `password_encryption` 是以后设置密码时使用的存储方式，**不等于给 postgres 设置了密码，也不会自动转换既有密码**。[S7]
- 不因本阶段走 SSH 隧道而关闭已有 `ssl` 配置；也不把默认自签名证书当作已完成可信 TLS。独立 TLS 的处理边界见第 9 节。[S3][S13]

### 6.3 核对 pg_hba.conf

**【服务器 Bash】**

```bash
sudoedit /etc/postgresql/18/main/pg_hba.conf
```

**本实例按 4.3.9 的带备份脚本处理，不再单独重复编辑本节。** 下面展示最终有效规则的目标顺序；原文件注释仍保留。`include` 文件和更早的宽泛规则也必须检查；当前回传无有效 include/trust。[S11]

**【配置文件内容】**

```conf
# 本手册的加固默认：postgres 不通过回环 TCP / SSH 转发登录
host    all           postgres   127.0.0.1/32   reject
host    all           postgres   ::1/128        reject
host    replication   postgres   127.0.0.1/32   reject
host    replication   postgres   ::1/128        reject

# 以下保留现有六条；socket peer 管理保持不变
local   all           all                       peer
host    all           all        127.0.0.1/32   scram-sha-256
host    all           all        ::1/128        scram-sha-256
local   replication   all                       peer
host    replication   all        127.0.0.1/32   scram-sha-256
host    replication   all        ::1/128        scram-sha-256
```

说明：

- PostgreSQL 使用**第一条匹配规则**，不是所有规则合并；认证失败也不会自动尝试后面的规则。[S11]
- 上面的拒绝超级用户 TCP 登录是本手册的安全选择；管理方式保持第 5.2 节的 `sudo -u postgres + socket`。
- `host all all` 在这里仅限定回环 IP，且仍要数据库角色认证；不是允许任意外网连接。
- `all` 数据库规则不能替代物理复制的 `replication` 规则，因此对 postgres 单列两条 replication 拒绝。保留原有复制条目的 peer/SCRAM，不增加复制用户或外部复制入口；不允许留下 `trust`。[S11]
- 本阶段不启用 IPv6 TCP 监听，保留 `::1` 规则是防止以后启用时缺少相应限制。
- 不添加 `0.0.0.0/0`、`::/0`、整个公司网段或你电脑的公网 IP；隧道到达数据库时来源是服务器回环地址。[S1]

### 6.4 配置文件错误检查：区分首次启动与运行中变更

**本实例首次失败已修复并成功运行，当前使用 4.3.12 的 SQL 块统一验收，不重复本节查询。** 4.3.9 仅做离线文件回读与 systemd 静态核验，不能说 HBA 已通过数据库解析。首次启动须先完成挂载保护与认证配置，再按 4.3.10 校验并首次启动后执行只读检查；如果文件解析有误，停止后续登录/隧道验收并回传错误，不重建数据。

**【服务器 Bash】**：以下只适用于服务已经运行的情况；后续日常配置变更可在 reload/restart 之前用现有进程检查。

```bash
sudo -u postgres /usr/lib/postgresql/18/bin/psql -X -v ON_ERROR_STOP=1 \
  -h /var/run/postgresql -p 5432 -d postgres \
  -c "SELECT sourcefile, sourceline, name, error FROM pg_file_settings WHERE error IS NOT NULL;" \
  -c "SELECT line_number, error FROM pg_hba_file_rules WHERE error IS NOT NULL;"
```

预期没有语法/参数错误。`pg_file_settings` 检查磁盘上的配置，不代表它已经生效；被其他位置覆盖的设置可能没有 error，因此后面还要核对实际值。若只提示某设置需要重启，核实其确为本次预期变更；其他错误应先修复。[S14][S15][S18]

### 6.5 运行后回读；仅后续变更时重启指定实例

**服务已修复且运行成功，当前 SQL 统一按 4.3.12 执行，不执行本节 restart。** 下方命令仅供将来确有配置变更需要重启时参考；不要为套用示例额外重启。

**【服务器 Bash：仅后续需要重启的变更】**

```bash
sudo systemctl restart postgresql@18-main
systemctl is-active postgresql@18-main
sudo systemctl status postgresql@18-main --no-pager
```

不要重启所有数据库实例或整台服务器。然后执行：

```bash
sudo -u postgres /usr/lib/postgresql/18/bin/psql -X -v ON_ERROR_STOP=1 \
  -h /var/run/postgresql -p 5432 -d postgres \
  -c "SELECT name, setting, sourcefile, pending_restart FROM pg_settings WHERE name IN ('listen_addresses','port','password_encryption','TimeZone','log_timezone','ssl') ORDER BY name;" \
  -c "SELECT line_number, type, database, user_name, address, auth_method, error FROM pg_hba_file_rules ORDER BY rule_number;"
sudo ss -lntp 'sport = :5432'
```

预期：

- `listen_addresses=127.0.0.1`、`port=5432`、`password_encryption=scram-sha-256`。
- 首次启动保留初始化的 Asia/Shanghai 时区，记录 TimeZone/log_timezone 实际值；相关 `pending_restart` 不为 true。不因旧示例写 UTC 就擅自改动。
- 实际监听是 `127.0.0.1:5432`，**不是 `0.0.0.0:5432`、`[::]:5432` 或公网/内网地址**。
- HBA 文件解析正常，顺序符合第 6.3 节。

如果设置未生效，查 `sourcefile`、include 配置与数据目录里的 `postgresql.auto.conf` 是否覆盖；不要继续在主文件末尾盲目追加。[S14][S15]

### 6.6 确认开机启动策略

**【服务器 Bash】**

```bash
sudo cat /etc/postgresql/18/main/start.conf
systemctl is-enabled postgresql.service
```

本次自定义目录初始化计划在 4.3.3 中有意使用 `manual`，防止配置完成前自动启动；这不是故障。**只有持久挂载、目标实例挂载失败保护及本地验证完成后**，才将最终开机启动策略设为 `auto`。核实没有其他特殊运维意图后，用 `sudoedit /etc/postgresql/18/main/start.conf` 修改有效行为 `auto`，然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable postgresql.service
```

这是配置开机启动，不需要现在重启操作系统。实际整机重启验收须等维护窗口，未重启不能声称已做过重启恢复测试。[S3]

---

## 7. 服务端就绪检查（不需要数据库密码）

**【服务器 Bash】**

```bash
/usr/lib/postgresql/18/bin/pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres -t 5
printf 'exit_code=%s\n' "$?"
```

预期：`accepting connections`，退出码 `0`。[S5]

这里故意只探测服务状态：第 6.3 节已拒绝 postgres 通过 TCP 登录，因此它可能留下认证拒绝日志。**就绪探测仍可能返回 0，不矛盾；不要为消除这条预期日志而放开超级用户或 trust。** 成功执行 SQL 的证据来自第 5/6 节的本地 socket 查询，不来自本节。

退出码：`1` 表示服务器暂不接受（如启动中）；`2` 无响应；`3` 探测参数等问题。[S5]

---

## 8. Windows：建立 SSH 隧道并验证完整连接路径

### 8.1 先理解地址

本阶段的连接路径是：**你电脑的 `127.0.0.1:15432` → SSH 加密通道 → 数据库服务器自己的 `127.0.0.1:5432`**。[S1]

三个参数不要混淆：

| 参数 | 含义 |
|---|---|
| SSH 地址、端口 | Ubuntu 的可访问地址与 SSH 端口 |
| `15432` | Windows 本机空闲端口，特意不同于数据库默认端口 |
| `127.0.0.1:5432`（转发目标） | SSH 登录的那台 Ubuntu 自己的数据库入口 |

**如果 SSH 登录的是跳板机，而 PostgreSQL 在另一台机器上，这个命令不能原样使用。** 应让 SSH 最终登录数据库主机（必要时通过批准的 ProxyJump），或另行设计跳板到数据库段的加密；不能默认最后一跳也是安全的。[S1][S2]

### 8.2 在新 PowerShell 窗口建立隧道

保留现有 Ubuntu 管理窗口。新窗口重新填写参数，因为窗口之间不会共享变量。

**【本机 PowerShell，窗口 A】**

```powershell
$Server = "YOUR_SERVER_IP"
$SshUser = "t7920"
$SshPort = 22
if ($Server -eq "YOUR_SERVER_IP" -or $SshUser -eq "YOUR_SSH_USER") {
    throw "请先填写真实服务器地址；核对预填用户名 t7920 是否为你的实际 SSH 用户。"
}
Get-NetTCPConnection -State Listen -LocalPort 15432 -ErrorAction SilentlyContinue
```

如果已有进程监听 15432，不杀进程；改选空闲端口，并同步修改后续客户端命令。没有输出时可继续：

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:15432:127.0.0.1:5432 -p $SshPort "${SshUser}@${Server}"
```

沿用已核验的 SSH 身份和密钥；如登录命令需要 `-i`，这里也要使用同样的密钥。[S2][S6]

- `-N -T`：只转发，不打开交互终端。
- 本地绑定 `127.0.0.1`：不把你电脑变成向其他人开放的数据库代理。
- keepalive 参数用于发现连接中断，不代表自动重连。
- **窗口停在那里没有输出通常正常；保持窗口开启。** 手动 `Ctrl+C` 或网络断开会结束隧道。
- `ExitOnForwardFailure=yes` 可以发现建立转发入口失败，但不保证最终数据库地址一定可达；还必须执行下节探测。[S6]

### 8.3 在第二个窗口分层测试

**【本机 PowerShell，窗口 B】**

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 15432
```

`TcpTestSucceeded=True` 只说明本机转发入口能建立 TCP 连接，**还不足以证明远端 PostgreSQL 响应**。[S6]

#### 准备本机 pg_isready（已有则跳过下载）

```powershell
Get-Command pg_isready -ErrorAction SilentlyContinue
```

若没有客户端：通过 PostgreSQL 官方 Windows 下载页进入其明确链接的 EDB 二进制 ZIP 下载，选择适用的 64 位版本，完整解压到你自行选择的目录。**只运行客户端，不运行安装数据库服务或初始化集群的程序**；不要只拷出一个 exe 而遗漏依赖 DLL，不从陌生下载站获取。[S16]

官方入口见第 14 节 S16。示例解压后路径若为 `C:\Tools\pgsql\bin\pg_isready.exe`，执行以下命令；实际路径不同则替换：

```powershell
$PgIsReady = "C:\Tools\pgsql\bin\pg_isready.exe"
if (-not (Test-Path -LiteralPath $PgIsReady)) {
    throw "请填写实际 pg_isready.exe 路径，或先准备客户端。"
}
& $PgIsReady --version
& $PgIsReady -h 127.0.0.1 -p 15432 -U postgres -d postgres -t 5
$ProbeExitCode = $LASTEXITCODE
"exit_code=$ProbeExitCode"
```

若工具已在 PATH，直接使用 `pg_isready -h ...` 即可。

预期：`127.0.0.1:15432 - accepting connections` 且 `exit_code=0`。结合服务端实例身份、监听检查和 SSH 目标核对，可以确认本阶段连接通路。这里仍**没有认证成业务用户**，认证拒绝日志的含义同第 7 节。[S5]

不想现在准备本机客户端，也可以先完成前面的服务端验证，但验收单应标记“完整隧道协议探测待做”，不能只靠 TCP 测试就勾选通过。

### 8.4 为什么这时数据库 GUI 仍可能登录失败

本阶段尚未创建可登录的业务角色，而且显式禁止 postgres 通过 TCP 登录。因此 GUI 如果要求数据库用户名/密码，“测试连接”失败并不必然代表网络坏了。[S7][S11]

- 不使用 SSH 用户名/SSH 密码冒充数据库凭据。
- 不为了让 GUI 显示绿色而设置超级用户远程密码、放开超级用户 TCP 或改 trust。
- 下一阶段有数据库角色后，GUI 若使用外置隧道，数据库地址填 `127.0.0.1`，端口填 `15432`。
- 外置隧道与 GUI 自带 SSH 模式二选一，不能混填两套地址。
- 普通最终用户只登录我们的应用，不会直接连接 PostgreSQL。

---

## 9. 当前网络/TLS边界，以及以后如何让后端连接

### 9.1 当前阶段为什么不开放 5432

这是本项目的保守部署选择：管理访问经过既有 SSH 入口，数据库只在本机监听。SSH 可以保护客户端与数据库主机之间的网络流量；它不代替数据库权限与认证。[S1]

- 不需为这条通道在云安全组或 UFW 添加数据库入站规则。
- 本阶段只核对并保留已有 SSL 状态，不声称已完成独立 PostgreSQL TLS 证书部署。
- 若机器上有默认自签名/snakeoil 证书，不能仅凭 `ssl=on` 就声称客户端验证了服务器身份。[S3][S13]

### 9.2 后端位置不同，后续配置不同（本轮不执行）

| 后端位置 | 后续接入方式 | 本阶段是否具备条件 |
|---|---|---|
| 与数据库同一 Ubuntu 主机，非容器隔离 | 本地 socket 或 127.0.0.1 + 最小权限角色 | 服务就绪，尚缺业务库/角色 |
| 你的 Windows 开发电脑 | 开启 SSH 隧道后连接 127.0.0.1:15432 | 通路可验收，尚缺业务库/角色 |
| 另一台内网服务器 | 私网监听 + 限来源 + TLS + 角色授权 | **尚未配置** |
| Docker/虚拟机中的后端 | 先确认网络命名空间、网关和实际来源地址 | **不能照搬宿主机的 127.0.0.1** |

不要把依赖你个人电脑保持在线的交互 SSH 隧道当作生产服务的永久连接方案。

### 9.3 未来跨主机直接连接前必须完成的事项

这是下一阶段清单，不是现在就执行的开放操作：

1. 确认后端固定私网来源与数据库私网地址、DNS 名称。
2. 配置可信证书、私钥权限、证书更新机制；客户端信任对应 CA。
3. 数据库只增加必要私网监听；防火墙/安全组仅允许指定后端来源。
4. HBA 使用限定的库、角色、来源地址及 `hostssl ... scram-sha-256`。
5. 客户端采用 `sslmode=verify-full` 校验证书链和主机名；不能把仅加密但不充分验证身份当成等价方案。[S13]
6. 实际使用业务角色完成登录/授权测试，并验证未授权来源不能连接。

尚未确定服务器拓扑，所以本手册不提供可以误粘贴的公网放行命令。若公司要求即使 SSH 隧道也必须叠加独立 TLS，则需提前提供公司 CA 和证书规范，不能把本阶段标记为满足该额外要求。

---

## 10. 常见问题：按故障层次排查

| 现象 | 优先看什么 | 不要怎么做 |
|---|---|---|
| SSH timeout / refused | 地址、实际 SSH 端口、VPN/路由、云安全组、现有 ssh 服务 | 不开放数据库端口来解决 SSH 问题 |
| SSH Permission denied | SSH 用户、密钥路径、账号是否获授权 | 不把数据库密码拿来尝试 |
| SSH 主机指纹变化 | 可信控制台/管理员确认主机是否变更 | 不关闭主机身份验证 |
| apt 签名/TLS/404错误 | 系统时间、网络代理、发行版代号、源支持矩阵 | 不忽略签名，不硬改系统代号 |
| apt 锁定 | 是否有升级/包安装正在运行 | 不删锁文件、不强杀未知升级进程 |
| `pg_lsclusters` 无实例 | 安装日志、创建策略、已有数据目录 | 不重复 initdb/重装/删除目录 |
| 实例 down / restart 失败 | 指定实例日志、配置语法、磁盘、端口和文件权限 | 不对数据目录递归改成 777 |
| 服务 active 但 5432 不对 | 实际版本/cluster、port、listen_addresses | 不只相信总服务 active 状态 |
| 隧道 `Address already in use` | Windows 本地 15432 被占用 | 不随便终止占用者，换本地端口 |
| 隧道 `administratively prohibited` | SSH 账号是否允许目标端口转发、Match/authorized_keys 限制 | 不自行放宽全机 sshd 策略 |
| 隧道 `connect failed: Connection refused` | SSH 最终主机是不是数据库主机、服务器是否监听 127.0.0.1:5432 | 不改成全网监听碰运气 |
| TCP 测试成功但 pg_isready 无响应 | 最终转发目标、SSH 窗口日志、数据库状态 | 不把 TCP 入口成功等同于端到端成功 |
| TCP 登录 postgres 被拒绝 | 本手册的明确加固规则 | 不当成必须修复的错误 |
| `Peer authentication failed` | 是否确实 sudo 切到系统 postgres、是否用了本地 socket | 不把 peer 改 trust |
| 修改配置后值没变化 | SHOW/pg_settings.sourcefile、include/auto.conf、pending_restart | 不重复追加同名配置 |

### 10.1 服务器诊断命令（只读）

**【服务器 Bash】**

```bash
sudo pg_lsclusters
sudo systemctl status postgresql@18-main --no-pager
sudo journalctl -u postgresql@18-main -n 100 --no-pager
sudo tail -n 100 /var/log/postgresql/postgresql-18-main.log
sudo ss -lntp 'sport = :5432'
df -hT / /var/lib
```

日志文件位置以 `pg_lsclusters`/实际配置为准；不存在时不要创建一个假日志文件。日志可能包含用户、地址和 SQL，发送前脱敏。

### 10.2 SSH 不允许转发怎么办

由服务器管理员核对该用户的 `AllowTcpForwarding`、`DisableForwarding`、`PermitOpen`、Match 规则及密钥限制。需要授权时只允许必要的本地转发目标，而不是全局开放全部转发。本手册不修改或重启 SSH。[S17]

---

## 11. 配置失败时怎样恢复（不删除数据）

> **本次故障已修复，当前服务 online，不执行本章恢复或重启。** `/root/ee-pg-syntax-fix.ihwbLk/postgresql.conf` 保存的是修复前错误配置；更早 `/root/ee-pg-prestart.nwMAWg/postgresql.conf` 也不是已验证的修复后基线。保留作追溯，但不得盲目整份恢复，否则可能重引入第 60 行错误。任何将来恢复前需另行核对备份内容及变更范围。

**4.3.9 首次启动前配置发生错误时，不直接执行本节恢复/重启块。** 其本次实际备份为 `/root/ee-pg-prestart.nwMAWg`，包含三份配置和 `systemd-unit-before.txt`；新增的 `20-ee-data-mount.conf` 不在下面的三文件恢复范围内，复制旧配置不会自动撤销这个 drop-in。保持实例未启动，先回传错误、实际备份路径和当前 unit；核对部分变更后再确定针对性恢复，不直接重跑，不删除数据。

以下恢复块仅适用于你刚刚按第 6 节对已运行实例做的配置变更，并且确认期间没有别人继续改配置；它不自动覆盖 4.3.9 的恢复情形。

1. 保留备用 SSH 会话，记录错误日志。
2. 找到第 6.1 节记录的备份目录。
3. 先对比目标文件，只恢复本次备份，不移动/删除数据库数据目录。

**【服务器 Bash】**：把示例中的占位目录换成实际存在的备份目录。

```bash
BACKUP_DIR='/root/ee-pg-config-backups/REPLACE_WITH_ACTUAL_TIMESTAMP'
sudo test -f "$BACKUP_DIR/postgresql.conf"
sudo test -f "$BACKUP_DIR/pg_hba.conf"
sudo test -f "$BACKUP_DIR/start.conf"
sudo diff -u "$BACKUP_DIR/postgresql.conf" /etc/postgresql/18/main/postgresql.conf
sudo diff -u "$BACKUP_DIR/pg_hba.conf" /etc/postgresql/18/main/pg_hba.conf
sudo diff -u "$BACKUP_DIR/start.conf" /etc/postgresql/18/main/start.conf
```

`diff` 有差异时通常返回非零；这是对比结果，不是允许忽略备份不存在的理由。确认备份存在且就是要恢复的内容后，才执行：

```bash
(
    set -eu
    : "${BACKUP_DIR:?先设置并核对本次备份目录}"
    case "$BACKUP_DIR" in
        /root/ee-pg-config-backups/[0-9]*) ;;
        *) printf '%s\n' '备份路径不符合预期，停止。' >&2; exit 1 ;;
    esac
    sudo test -f "$BACKUP_DIR/postgresql.conf"
    sudo test -f "$BACKUP_DIR/pg_hba.conf"
    sudo test -f "$BACKUP_DIR/start.conf"
    sudo cp -a "$BACKUP_DIR/postgresql.conf" /etc/postgresql/18/main/postgresql.conf
    sudo cp -a "$BACKUP_DIR/pg_hba.conf" /etc/postgresql/18/main/pg_hba.conf
    sudo cp -a "$BACKUP_DIR/start.conf" /etc/postgresql/18/main/start.conf
    sudo systemctl daemon-reload
    sudo systemctl restart postgresql@18-main
)
```

恢复后重新执行服务、socket 查询、监听检查；不要因为能启动就略过安全范围核对。若失败的是包安装或证书/数据权限，不应靠来回复制配置解决，先查日志。

本章只恢复配置，不回滚 APT 软件源/包、不删除集群。要取消整个部署时另做资产和数据盘点，**本手册不提供清库或卸载清理命令**。

---

## 12. 阶段一验收单与给后续工作的交接信息

### 12.1 验收单

**记录状态**：第 60 行未引用的监听地址已原文确认、备份并修复，postgres -C 检查与启动成功，2026-09-17 20:33:36 CST 起服务 active(running)，18/main online，仅监听 127.0.0.1:5432。4.3.12 已确认服务端 PostgreSQL 18.6、本地 socket SQL、运行参数、配置无解析错误和十条 HBA 规则解析均通过。当前只执行 4.3.13 Windows SSH 隧道验证；可信 TLS、开机恢复、隧道和业务账号登录不因本地 SQL 成功提前勾选。

- [ ] 我通过可信渠道核对了 SSH 主机身份，并保留应急入口。
- [ ] 已确认 Ubuntu/架构受支持、sudo 可用、磁盘持久且容量已记录。
- [ ] 安装前已确认没有被覆盖或误改的既有数据库实例。
- [x] 数据目录已由用户确认为 `/data/postgresql/18/main`。
- [x] 当前读写挂载、fstab UUID/选项及目标专用目录不存在已回传。
- [x] 管理工具包及 PostgreSQL 18 服务端/客户端软件包已安装（4.3.6.1）。
- [x] 数据盘上的 18/main 已初始化成功，状态 down（4.3.7.1）。
- [x] manual、数据路径、监听地址、PG_VERSION、三个专用目录 postgres:postgres/0700 及初始化后无 5432 监听已回传（4.3.8.1）。
- [x] sudo 集群属主 postgres、剩余参数、六条 HBA 与原 systemd 模板已回传（4.3.8.3）。
- [x] 4.3.9 脚本完成并记录三配置文件及原 unit 的备份目录：/root/ee-pg-prestart.nwMAWg。
- [x] 4.3.9 专属 drop-in 文件内容及 systemd 加载路径已回读确认（4.3.9.2）。
- [x] HBA 文本十条规则及顺序正确；配置后 18/main 仍 down、postgres，5432 无监听（4.3.9.3）。
- [x] 4.3.10 启动前守卫已通过：目标盘 UUID/rw 与三项完整 systemd 属性已核对。
- [x] ~~底层原因待日志诊断~~ → 已定位 postgresql.conf 第 60 行语法错误。
- [x] 4.3.11 具体行匹配、单行修复及备份已确认；备份为 /root/ee-pg-syntax-fix.ihwbLk/postgresql.conf。
- [x] PostgreSQL -C 解析与修复后启动成功，18/main 已 online（4.3.11.1）。
- [x] postgres 对证书/私钥的可读性已回传通过（未输出内容、不代表可信 TLS）。
- [x] 自动默认集群创建已关闭并回读为 off，配置备份路径已记录（4.3.5.1）。
- [x] 关闭开关后的新服务包模拟已核对，6 项拟新装、0 升级/移除。
- [x] 初始化前目标路径/数据盘 UUID/rw 的保护检查随初始化成功通过（4.3.7.1）。
- [x] 数据库专属挂载保护已配置、回读并通过依赖守卫。
- [ ] 真实挂载故障/整机重启演练未进行，不把配置验收等同于演练。
- [x] 候选及原完整模拟计划已核对（4.3.1），没有把模拟当成实际安装；拆分安装后需核对新事务计划。
- [x] 软件包实际来源已核对，两项 PostgreSQL 包 Installed=18.6-1.pgdg22.04+2。
- [x] 初始化并启动后，通过 SQL 记录运行中服务端版本 `18.6`；不以 psql 客户端版本代替（4.3.12）。
- [x] `pg_lsclusters` 已确认目标为 `18/main/5432`，状态 online、属主 postgres（4.3.11.1）。
- [x] 配置文件/数据目录由运行中 `pg_settings` 回读确认，不仅依据默认路径（4.3.12）。
- [x] 默认 `postgres` 库的本地 socket SELECT 成功，服务端编码为 UTF8（4.3.12）。
- [x] 本次配置备份脚本已完成，实际路径 /root/ee-pg-prestart.nwMAWg 已记录（4.3.9.1）。
- [x] HBA 文件无解析错误，十条规则均已解析；未启用 trust，超级用户 TCP 登录保持拒绝（4.3.12）。
- [x] ss 已确认仅监听 `127.0.0.1:5432`，未新增外网/内网数据库入口（4.3.11.1）。
- [x] 修改后的配置已回读，所查询十项参数均无待重启状态（4.3.12）。
- [ ] 目标实例开机启动策略已检查；真实整机重启演练是否做过另行记录。
- [ ] Windows 隧道入口仅绑定 `127.0.0.1:15432`。
- [ ] Windows 的 `pg_isready` 经隧道探测返回 0；不以 TCP 测试替代。
- [ ] 清楚“服务可达”和“应用账号可登录”不是一回事。
- [ ] **没有创建业务数据库、业务角色、schema 或表，没有修改前后端连接串。**

本阶段全部勾选的含义是“基础安装和管理通路验收通过”，不是“已达到生产上线条件”。正式数据备份、恢复演练、业务权限和真实应用连接仍待后续完成。

### 12.2 可返回给助手的脱敏记录

```text
Ubuntu 版本/代号：Ubuntu 22.04.5 LTS / jammy（用户已回传）
CPU 架构：x86_64；包架构 amd64（用户已回传）
当前系统用户/终端主机名：t7920 / t7920
内存与交换空间：Mem 62Gi 总量 / 17Gi used / 1.1Gi free / 385Mi shared / 43Gi buff/cache / 44Gi available；Swap 2.0Gi 总量 / 401Mi used / 1.6Gi free
4.1 工具准备：已完成；ca-certificates=20260601~22.04.1，curl=7.81.0-1ubuntu1.27
4.1 APT 实际操作：0 升级/0 新装/0 移除，112 个待升级；ca-certificates 已标手动安装
APT 源注意项：jammy/proposed/security/updates=500，backports=100，CUDA/NVIDIA=600；优先级已回传，本次依赖模拟已核对且未显示 proposed 来源或 CUDA/NVIDIA 变更；不自动改源
工具候选：ca-certificates=20260601~22.04.1、curl=7.81.0-1ubuntu1.27，Installed=Candidate，版本表为 security/updates
4.2：已完成；pgdg.sources 内容已回传，jammy-pgdg InRelease 与 amd64 包索引获取成功，未显示签名/下载错误
4.3：先实际安装管理包 3 项，再实际安装服务包及依赖 6 项（各次均 0 升级/移除）；两个 PostgreSQL 包 Installed=Candidate=18.6-1.pgdg22.04+2（4.3.6.1），112 项未升级
PostgreSQL 软件包版本：18.6-1.pgdg22.04+2 已安装；psql 客户端显示 18.6；尚无运行中服务端 SQL 版本查询
安装前实例初筛（历史）：当时无工具路径、无已安装包行、0 loaded units、0 匹配 unit files、无主机 TCP 5432 监听行，两个默认目录不存在；现已安装管理工具，不能继续套用旧的包/目录不存在结论；其他安装方式仍待核对
集群列表最新证据：pg_createcluster 末尾报告 18 main 5432 down postgres /data/postgresql/18/main；不再是初始化前的空列表
systemctl is-active postgresql@18-main：
系统自动启动配置：
SHOW config_file / hba_file / data_directory：
server_encoding：
listen_addresses / port / password_encryption：
磁盘总量和剩余容量：/ 与 /var/lib 同属 /dev/sda2，首次 df 为 439G 总量 / 246G 可用；/data 补充 df 为 ext4、1.8T 总量 / 100G 已用 / 1.7T 可用 / 6%
数据库选盘及初始化：/data/postgresql/18/main 已创建并初始化成功（4.3.7.1），保持 down
当前挂载：/data → /dev/nvme0n1p1，ext4，rw,relatime
fstab：UUID=7a36a8d0-78cb-4385-8660-ebd3522bfaf5 → /data，ext4，defaults,nofail；保留不改
目录现状：/data 原有 t7920:t7920、0755 保留；三个专用目录均已由 sudo ls 回读为 postgres:postgres、0700（4.3.8.1），不为普通用户显示 unknown 放宽权限
开机实际恢复、数据库挂载失败保护和现有业务占用：尚未验收
管理工具安装（4.3.4）：已完成，0 升级/3 新装/0 移除/112 项未升级；postgresql-common / postgresql-client-common=293.pgdg22.04+1，libjson-perl=4.04000-1
集群最新状态：18/main、5432、online、postgres，/data/postgresql/18/main；服务 active(running)，成功启动时间 2026-09-17 20:33:36 CST，见 4.3.11.1；4.3.12 本地 SQL 已验证服务端版本 18.6
自动创建策略：已设置 false，并经 pg_conftool 布尔回读为 off（4.3.5.1）；实际安装前只读复核
初始化配置备份：/root/ee-pg-init-config.FA9b5O/createcluster.conf
服务端软件包安装（4.3.6）：已通过
集群初始化（4.3.7）：已成功，UTF8、en_US.UTF-8、Asia/Shanghai、页校验和 enabled，报告 down
基础回读（4.3.8.1）：manual；data_directory=/data/postgresql/18/main；listen_addresses=127.0.0.1；PG_VERSION=18；三个专用目录 postgres:postgres/0700；5432 无监听
普通用户 pg_lsclusters 历史显示 Owner=<unknown>；sudo 最新输出为 18/main、5432、down、postgres，已闭环，不改权限
剩余回读（4.3.8.3）：hba_file 正确、port=5432、SCRAM、ssl=on 和 snakeoil 路径；HBA 六条 peer/SCRAM；原 unit 无 /data 专属依赖
当前下一步（4.3.13）：仅 Windows SSH 隧道、Test-NetConnection 与 pg_isready 可达性验证；不改服务器配置、不重启、不改 manual、不建业务库/角色
4.3.9 配置备份目录：/root/ee-pg-prestart.nwMAWg（用户回传）
4.3.9 执行结果：证书/私钥对 postgres 可读，脚本最后完成提示已回传；snapd.service:23 的 RestartMode 为未知键，被 ignoring；非无警告通过
4.3.9.2 变更回读结果：专属 drop-in 内容与加载路径正确；BindsTo=data.mount、After 可见 data.mount；show 长行仍截断，不补全为实测值
4.3.9.3 补充回读：十条 HBA 及顺序正确；18/main/5432/down/postgres；TCP 5432 无监听
4.3.10 守卫：三项完整属性通过，之前的 down/UUID/rw 前置判断亦未中止；截断问题已解决
4.3.10 首次启动：2026-09-17 19:54:39 CST 失败，status=failed (Result: protocol)；后续日志已确认主配置第 60 行在 .0 附近语法错误，PID 提示在其后
4.3.10 SQL：未执行；日志补充已完成，不再索要同样日志
4.3.11 修复与启动：原第 60 行确为未引用地址；备份 /root/ee-pg-syntax-fix.ihwbLk/postgresql.conf；修复后 -C 解析通过；2026-09-17 20:33:36 CST 启动成功，18/main/5432/online/postgres，仅监听 127.0.0.1:5432
4.3.12 本地 SQL/运行参数/HBA 解析：已通过；服务端 18.6，current_user/current_database=postgres，config/hba/data 路径正确，十项运行参数 pending_restart=f，pg_file_settings 错误查询 0 行，十条 HBA 规则解析成功且 error 为空
系统时区/同步：Asia/Shanghai；synchronized=yes；NTP=active
locale：LANG=en_US.UTF-8，可用 en_US.utf8 / zh_CN.utf8 等
UFW 状态：已检测到命令，用户回传 Status: inactive；未启用，未做修改
其他主机/外部网络策略：待用户/管理员说明；不适用时明确注明
Windows 隧道 pg_isready 输出及退出码：
是否创建过业务库/角色（预期：否）：
后端预计位置（同机 / 其他内网主机 / Windows / 容器）：
待处理错误：
```

不需要把私钥、密码、完整公网信息、完整日志或云控制台截图发给我。服务器地址可以用“服务器 A”代替。**我可以根据这些输出帮助判断下一步，不需要获得服务器登录权限。**

---

## 13. 下一阶段再做什么（本手册到此停止）

1. 确认业务库名称、编码/排序规则、schema 及数据保留策略。
2. 建立业务库与角色，分离迁移/运行/只读账号；采用最小权限。
3. 确定后端实际部署位置，必要时配置受限私网连接及可信 TLS。
4. 用真实业务角色验证密码认证、库连接、读写边界和项目隔离。
5. 建立并演练数据备份/恢复，明确 RPO/RTO、补丁维护窗口、磁盘/归档告警。
6. 审核数据库设计和迁移脚本，按里程碑创建业务表与权限底座。
7. 最后配置后端密钥/连接池并联调；浏览器不持有数据库凭据。

**请不要在完成本手册后自行执行设计文档中的约束示意 SQL。它们不是已经准备好的完整迁移脚本。**

---

## 14. 官方资料与核验边界

本手册命令依据以下官方资料整理；安全取舍和阶段划分是本项目建议。核验日期为 2026-09-17，部署当天仍需复核软件源支持列表。资料核验不代表已经在你的服务器上验证过。

| 编号 | 资料 | 地址 |
|---|---|---|
| S1 | PostgreSQL：SSH 隧道及最后一跳边界 | `https://www.postgresql.org/docs/18/ssh-tunnels.html` |
| S2 | OpenSSH：ssh 命令、端口转发 | `https://man.openbsd.org/ssh` |
| S3 | Debian PostgreSQL：集群初始化/目录/start.conf | `https://manpages.debian.org/trixie/postgresql-common/pg_createcluster.1.en.html` |
| S4 | PostgreSQL：initdb 默认数据库与编码 | `https://www.postgresql.org/docs/18/app-initdb.html` |
| S5 | PostgreSQL：pg_isready 的状态与认证边界 | `https://www.postgresql.org/docs/18/app-pg-isready.html` |
| S6 | OpenSSH：ExitOnForwardFailure、保活与主机校验 | `https://man.openbsd.org/ssh_config` |
| S7 | PostgreSQL：密码认证与操作系统密码的区别 | `https://www.postgresql.org/docs/18/auth-password.html` |
| S8 | PostgreSQL：Ubuntu 软件源及手动安装 | `https://www.postgresql.org/download/linux/ubuntu/` |
| S9 | Ubuntu：防火墙与 UFW | `https://ubuntu.com/server/docs/how-to/security/firewalls/` |
| S10 | Debian PostgreSQL：实例管理 | `https://manpages.debian.org/trixie/postgresql-common/pg_ctlcluster.1.en.html` |
| S11 | PostgreSQL：HBA 顺序、peer/host/SCRAM/reject | `https://www.postgresql.org/docs/18/auth-pg-hba-conf.html` |
| S12 | PostgreSQL：监听与连接参数 | `https://www.postgresql.org/docs/18/runtime-config-connection.html` |
| S13 | PostgreSQL：TLS 与 verify-full | `https://www.postgresql.org/docs/18/libpq-ssl.html` |
| S14 | PostgreSQL：配置文件检查 | `https://www.postgresql.org/docs/18/view-pg-file-settings.html` |
| S15 | PostgreSQL：实际参数及 pending_restart | `https://www.postgresql.org/docs/18/view-pg-settings.html` |
| S16 | PostgreSQL：Windows 客户端二进制官方入口 | `https://www.postgresql.org/download/windows/` |
| S17 | OpenSSH：服务端转发限制 | `https://man.openbsd.org/sshd_config` |
| S18 | PostgreSQL：HBA 规则诊断视图 | `https://www.postgresql.org/docs/18/view-pg-hba-file-rules.html` |
| S19 | Debian dpkg-query：包状态缩写 | `https://manpages.debian.org/trixie/dpkg/dpkg-query.1.en.html` |
| S20 | systemctl：list-units 与 list-unit-files 的范围 | `https://manpages.debian.org/trixie/systemd/systemctl.1.en.html` |
| S21 | Ubuntu apt：update / upgrade / autoremove 的范围 | `https://manpages.ubuntu.com/manpages/jammy/man8/apt.8.html` |
| S22 | Ubuntu：预发布更新与 22.04 选择性安装 | `https://wiki.ubuntu.com/Testing/EnableProposed` |
| S23 | Ubuntu apt-cache：policy 源与包优先级 | `https://manpages.ubuntu.com/manpages/jammy/man8/apt-cache.8.html` |
| S24 | Ubuntu apt-get：模拟安装 | `https://manpages.ubuntu.com/manpages/jammy/man8/apt-get.8.html` |
| S25 | Ubuntu APT preferences：优先级与同优先级版本选择 | `https://manpages.ubuntu.com/manpages/jammy/man5/apt_preferences.5.html` |
| S26 | PostgreSQL：集群数据目录、权限与独立卷子目录 | `https://www.postgresql.org/docs/18/creating-cluster.html` |
| S27 | Linux man-pages：路径解析、绝对/相对路径及当前目录 | `https://man7.org/linux/man-pages/man7/path_resolution.7.html` |
| S28 | Ubuntu 22.04 findmnt：当前挂载与 fstab 定点查询 | `https://manpages.ubuntu.com/manpages/jammy/en/man8/findmnt.8.html` |
| S29 | Ubuntu 22.04 systemd.mount：fstab 与 nofail 启动语义 | `https://manpages.ubuntu.com/manpages/jammy/man5/systemd.mount.5.html` |
| S30 | Ubuntu 22.04 systemd.unit：挂载依赖与启动条件 | `https://manpages.ubuntu.com/manpages/jammy/man5/systemd.unit.5.html` |
| S31 | Debian postgresql-common：管理包职责（非本机候选版本证明） | `https://packages.debian.org/trixie/postgresql-common` |
| S32 | Debian pg_conftool：指定配置文件、set/show 及布尔回读 | `https://manpages.debian.org/trixie/postgresql-common/pg_conftool.1.en.html` |
| S33 | PostgreSQL common 维护者源码：配置读写及 include 解析（非服务器版本实测） | `https://salsa.debian.org/postgresql/postgresql-common/-/raw/master/pg_conftool`；`https://salsa.debian.org/postgresql/postgresql-common/-/raw/master/PgCommon.pm` |
| S34 | Debian pg_lsclusters：集群列表与 --no-header | `https://manpages.debian.org/trixie/postgresql-common/pg_lsclusters.1.en.html` |
| S35 | Ubuntu systemctl：cat 展示 unit 与 drop-in 文件 | `https://manpages.ubuntu.com/manpages/jammy/en/man1/systemctl.1.html` |
| S36 | PostgreSQL common 维护者源码：Owner 未知时的显示（结合 S33 的 cluster_info/stat） | `https://salsa.debian.org/postgresql/postgresql-common/-/raw/master/pg_lsclusters` |
| S37 | Ubuntu 22.04 systemd-analyze：verify 静态核验范围 | `https://manpages.ubuntu.com/manpages/jammy/en/man1/systemd-analyze.1.html` |
| S38 | systemd 官方：RestartMode 的语义及从 254 起提供 | `https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html` |
| S39 | PostgreSQL 18 psql：-X/-w、ON_ERROR_STOP 与 pager 输出选项 | `https://www.postgresql.org/docs/18/app-psql.html` |
| S40 | Ubuntu 22.04 journalctl：unit/boot 过滤、行数、完整行与禁用分页 | `https://manpages.ubuntu.com/manpages/jammy/en/man1/journalctl.1.html` |
| S41 | PostgreSQL 18：启动失败优先查看服务端日志 | `https://www.postgresql.org/docs/18/server-start.html` |
| S42 | Ubuntu 22.04 systemd.service：Type=forking/PIDFile 的启动跟踪语义 | `https://manpages.ubuntu.com/manpages/jammy/en/man5/systemd.service.5.html` |
| S43 | PostgreSQL 18：配置文件字符串参数的单引号规则 | `https://www.postgresql.org/docs/18/config-setting.html` |
| S44 | PostgreSQL 18 postgres：-C 读取参数后退出及其边界 | `https://www.postgresql.org/docs/18/app-postgres.html` |

**交付范围：只编写本地操作手册，没有通过 SSH 操作服务器，没有执行手册中的安装、配置或 SQL 命令。服务器实际结果以你手动执行后的验收记录为准。**
