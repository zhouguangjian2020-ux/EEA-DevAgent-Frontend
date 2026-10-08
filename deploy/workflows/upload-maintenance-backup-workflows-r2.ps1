$ErrorActionPreference = 'Stop'
$Script = (Resolve-Path -LiteralPath 'E:/Git projects/TS-frontend/deploy/workflows/maintenance-backup-workflows-r2.sh').Path
$Remote = 't7920@192.168.64.3'
$Incoming = '/home/t7920/workflows-backup-20261003-r1-incoming'
$Expected = '7daf0be73a5d4acabab12348dd4ad15a003b271e0a9c676855d9362d24fd2078'

if ((Get-FileHash -LiteralPath $Script -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
    throw 'STOP: local script checksum mismatch'
}
ssh.exe $Remote "umask 077; mkdir '$Incoming'"
if ($LASTEXITCODE -ne 0) { throw 'STOP: upload directory not created; do not continue or overwrite' }
scp.exe $Script "${Remote}:${Incoming}/"
if ($LASTEXITCODE -ne 0) { throw 'STOP: upload failed; do not execute the server script' }
Write-Output 'UPLOAD_OK: no service stopped; verify and run on the server next'
