# Run by the user in Windows PowerShell. Upload only; no deployment.
$ErrorActionPreference = 'Stop'
$Source = Join-Path $PSScriptRoot 'cutover_frontend_workflows_20261004_r2.py'
$Expected = 'f92f35ec38752bb2b7090d001567e54d80bf4cffd6ad72ed2161e94134a7a7d7'
if ((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
    throw 'LOCAL_SCRIPT_HASH_MISMATCH: stop; do not upload'
}
$Remote = 't7920@192.168.64.3'
$Incoming = '/home/t7920/workflows-frontend-cutover-20261004-r2-incoming'
& ssh.exe -p 22 $Remote "umask 077; mkdir '$Incoming'"
if ($LASTEXITCODE -ne 0) {
    throw 'INCOMING_CREATE_FAILED: existing directory is NOT overwritten; return output for review'
}
& scp.exe -P 22 -p $Source "${Remote}:${Incoming}/"
if ($LASTEXITCODE -ne 0) {
    throw 'UPLOAD_FAILED: no service changed; retain incoming directory and return output'
}
Write-Output 'FRONTEND_SCRIPT_UPLOADED: no service change; server checksum and preflight required'
Write-Output "SHA256=$Expected"
