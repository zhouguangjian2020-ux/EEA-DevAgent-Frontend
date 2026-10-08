# 三条UC跨测试项目复制：只读预检（2026-10-05 r1）

## 用户授权
复制测试项目1中的3条UC到新项目，由用户自行确认。复制不是移动，原项目不改；目标必须新对象ID、新编号、新版本，保持待确认；不复制原确认状态、FR或分配关系。
来源：10d4c8a0-ff3a-56c3-abf6-18dc3b531e62 / 功能29fe01ea-f727-58cf-a326-b75294ba4dbb。
目标：bf8f4d08-d086-44bf-9cbe-f31abc67ee03 / DVR功能3bb1333a-1ebf-428c-831f-c26dcd66cfa3。

## 已核对的现有行为
UC生成读取当前已确认PRD，不以已有UC为禁用条件，也不覆盖已有UC。参考app/services/uc_generation.py的read_confirmed_prd及app/api/routes/agent.py的request_uc_generation。重复生成仍可能产生与已有UC相似的候选。

## 当前交付与停止点
这里只完成复制前只读工具，尚未复制公司数据。按既有公司操作规则，先由用户执行并回传源UC身份/当前头版本、目标已确认PRD和摘要；之后准备通过既有创建逻辑生成待确认副本的写入步骤，不提前写库。
计划复制原工作空间当前显示的头版本；报告显式区分头版本与已确认版本。源PRD与目标PRD正文不一致、目标已有UC、源数量不是3、范围不符或内容无法无损经过现有创建契约时，停止并复核。不截断分支/异常，不携带跨项目PRD引用。
预检在当前主后端容器内使用既有只读连接，验证事务只读与可重复读。仅SHOW/SELECT；不输出正文、DSN或凭证，不调用Agent，不修改容器或数据库。7018业务写开关维持false。

## 本地验证
16项离线模拟数据库测试通过；Python编译、Bash语法、PowerShell解析、UTF-8无BOM及LF检查通过。不代表公司数据库或复制步骤已验证。

## 本地Windows PowerShell：完整上传并执行只读检查
下段只进行上传、哈希检查和只读检查；已有传入目录会拒绝覆盖。回传完整输出后再准备复制。
```powershell
& {
    $ErrorActionPreference = 'Stop'
    $LocalPython = 'E:/Git projects/TS-frontend/deploy/workflows/inspect_uc_copy_20261005_r1.py'
    $LocalRun = 'E:/Git projects/TS-frontend/deploy/workflows/run-uc-copy-preflight-20261005-r1.sh'
    $PythonHash = 'b4a850c1794750d99e63c6150dd2f52c1d4013fb6ed6854559884caee2d9b06d'
    $RunHash = '129a0f635c0f151c96e73fb618c2060442549227f7f6814ec6defbdb1532abb7'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/uc-copy-preflight-20261005-r1-incoming'
    $RemotePython = "$Incoming/inspect_uc_copy_20261005_r1.py"
    $RemoteRun = "$Incoming/run-uc-copy-preflight-20261005-r1.sh"

    if ((Get-FileHash -LiteralPath $LocalPython -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PythonHash) { throw 'LOCAL_PYTHON_CHECKSUM_FAILED' }
    if ((Get-FileHash -LiteralPath $LocalRun -Algorithm SHA256).Hash.ToLowerInvariant() -ne $RunHash) { throw 'LOCAL_RUN_CHECKSUM_FAILED' }
    Write-Host 'LOCAL_CHECKSUMS_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) { throw 'CREATE_DIRECTORY_FAILED: stop; do not overwrite existing files' }

    scp.exe -P 22 $LocalPython $LocalRun "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemotePython' '$RemoteRun'; echo '$PythonHash  $RemotePython' | sha256sum -c -; echo '$RunHash  $RemoteRun' | sha256sum -c -; bash '$RemoteRun'"
    if ($LASTEXITCODE -ne 0) { throw 'READ_ONLY_PREFLIGHT_NOT_PASSED: paste output; do not copy or modify data yet' }

    Write-Host 'READ_ONLY_INSPECTION_FINISHED: no UC copied or confirmed'
}
```
