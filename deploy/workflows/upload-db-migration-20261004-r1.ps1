$ErrorActionPreference = 'Stop'
$Script = 'E:/Git projects/TS-frontend/deploy/workflows/migrate_workflows_20261004_r1.py'
$Expected = '0e79f293d10199661203421de8e1d10b167d190261cdc62a5c324fe5634e6f4a'
$Remote = 't7920@192.168.64.3'
$Incoming = '/home/t7920/workflows-db-migration-20261004-r1-incoming'
if ((Get-FileHash -LiteralPath $Script -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
    throw 'STOP: local migration script checksum mismatch'
}
ssh.exe $Remote ('umask 077; mkdir ' + $Incoming)
if ($LASTEXITCODE -ne 0) { throw 'STOP: incoming directory not created; retain existing directory and report output' }
scp.exe $Script ($Remote + ':' + $Incoming + '/')
if ($LASTEXITCODE -ne 0) { throw 'STOP: upload failed; no migration performed' }
Write-Output 'MIGRATION_SCRIPT_UPLOADED: no database or service change performed'
