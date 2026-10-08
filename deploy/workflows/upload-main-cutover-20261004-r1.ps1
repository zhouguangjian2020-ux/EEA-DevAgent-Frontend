$ErrorActionPreference = 'Stop'
$Script = 'E:/Git projects/TS-frontend/deploy/workflows/cutover_main_workflows_20261004_r1.py'
$Expected = 'f9581695b96dd8d5f89f40347eb3d700fce513cc63e0437c9cb54c1d4bd4484e'
$Remote = 't7920@192.168.64.3'
$Incoming = '/home/t7920/workflows-main-cutover-20261004-r1-incoming'
if ((Get-FileHash -LiteralPath $Script -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
    throw 'STOP: local script checksum mismatch'
}
$Prepare = 'umask 077; mkdir ' + $Incoming
ssh.exe $Remote $Prepare
if ($LASTEXITCODE -ne 0) { throw 'STOP: new incoming directory not created; retain existing files and report output' }
$Destination = $Remote + ':' + $Incoming + '/'
scp.exe $Script $Destination
if ($LASTEXITCODE -ne 0) { throw 'STOP: upload failed; no deployment performed' }
Write-Output 'MAIN_CUTOVER_SCRIPT_UPLOADED: server checksum and execution still required'
