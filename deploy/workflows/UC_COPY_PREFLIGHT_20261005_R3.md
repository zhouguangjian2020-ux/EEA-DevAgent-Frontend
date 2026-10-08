# UC复制预检r3：读取规则对齐与安全错误定位

## 用户回执
r2确认容器启动引用和实际镜像ID均为已知4ca6143...，running=true、network=host；镜像校验已通过。随后只读检查抛出ProjectReadError。旧脚本未报告stage/code/status，因此实际根因尚不能确定；未复制、确认或修改任何UC。

## 已定位的脚本问题及修复
已比对冻结workflows-r2包：project_workspace.py、workflow_sources.py、projects.py、manual_work.py与本地逐字节一致。工作空间读取UC以项目可见性控制，r1复制预检额外强制源uc.read，可能误拦可通过现有接口读取源数据的账号。
r3复用现有项目可见性规则，并继续验证源/目标项目名称、功能归属、非归档状态与目标uc.create权限。不改服务器角色、授权、数据库登录或业务接口。不能把读取规则差异直接说成此次现场错误的已证实根因。
r3增加阶段标记和白名单错误码、HTTP状态、SQLSTATE。禁止输出异常message、SQL全文、DSN、密钥、Cookie或业务正文。只读/可重复读事务、数量/版本/来源摘要/目标已有UC/字段无损检查保持。
r2镜像身份校验函数原样复用；r1/r2交付文件不改。没有创建/更新/确认UC的代码，仍须回传只读检查结果后再准备实际复制。

## 本地验证
27项离线测试通过，覆盖原16项保护场景、源/目标不可见、目标创建权限不足、诊断不泄露秘密等。Python AST、Bash和PowerShell语法检查通过，文件UTF-8无BOM且LF。未连接公司服务，不视为公司预检通过。

## 本地Windows PowerShell：完整上传并执行
```powershell
& {
    $ErrorActionPreference = 'Stop'
    $LocalPython = 'E:/Git projects/TS-frontend/deploy/workflows/inspect_uc_copy_20261005_r3.py'
    $LocalRun = 'E:/Git projects/TS-frontend/deploy/workflows/run-uc-copy-preflight-20261005-r3.sh'
    $PythonHash = '57bde1e9a44112478b6e293411425069329c892b98a3b8fb95d7bb021461b007'
    $RunHash = 'f2165a5f788182ec92c6ddf5c2294e8360400f553370c3cd25966eff11d1f874'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/uc-copy-preflight-20261005-r3-incoming'
    $RemotePython = "$Incoming/inspect_uc_copy_20261005_r3.py"
    $RemoteRun = "$Incoming/run-uc-copy-preflight-20261005-r3.sh"

    if ((Get-FileHash -LiteralPath $LocalPython -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PythonHash) {
        throw 'LOCAL_PYTHON_CHECKSUM_FAILED'
    }
    if ((Get-FileHash -LiteralPath $LocalRun -Algorithm SHA256).Hash.ToLowerInvariant() -ne $RunHash) {
        throw 'LOCAL_RUN_CHECKSUM_FAILED'
    }
    Write-Host 'LOCAL_CHECKSUMS_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) {
        throw 'CREATE_DIRECTORY_FAILED: stop; do not overwrite existing files'
    }

    scp.exe -P 22 $LocalPython $LocalRun "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemotePython' '$RemoteRun'; echo '$PythonHash  $RemotePython' | sha256sum -c -; echo '$RunHash  $RemoteRun' | sha256sum -c -; bash '$RemoteRun'"
    if ($LASTEXITCODE -ne 0) {
        throw 'READ_ONLY_PREFLIGHT_NOT_PASSED: paste complete output including stage and error_code; no copying yet'
    }

    Write-Host 'READ_ONLY_INSPECTION_FINISHED: no UC copied or confirmed'
}
```
