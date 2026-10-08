$ErrorActionPreference = 'Stop'
$Release = 'E:\Git projects\TS-frontend\tmp\workflow-release-20261003-r2'
$Remote = 't7920@192.168.64.3'
$Incoming = '/home/t7920/workflows-20261003-r2-incoming'

$Expected = '8207b93b3752c4861d3738425e6125a5c7a9b4984f562349c4023da7e616d59e'
if ((Get-FileHash -LiteralPath "$Release\SHA256SUMS" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
    throw 'STOP: local SHA256SUMS mismatch; do not upload'
}
$Names = @('SHA256SUMS')
foreach ($Line in Get-Content -LiteralPath "$Release\SHA256SUMS") {
    $Parts = $Line -split '  ', 2
    if ($Parts.Length -ne 2) { throw 'STOP: malformed checksum manifest' }
    $File = Join-Path $Release $Parts[1]
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Parts[0]) {
        throw "STOP: local file checksum mismatch: $($Parts[1])"
    }
    $Names += $Parts[1]
}
$Files = @($Names | ForEach-Object { Join-Path $Release $_ })
if ($Files.Count -ne 8) { throw 'STOP: unexpected release file count' }

ssh $Remote "umask 077; mkdir '$Incoming'"
if ($LASTEXITCODE -ne 0) { throw 'STOP: incoming directory not created; retain any existing directory and report output' }
scp @Files "${Remote}:${Incoming}/"
if ($LASTEXITCODE -ne 0) { throw 'STOP: upload failed; keep files for inspection, do not deploy' }
Write-Output 'UPLOAD_FINISHED: verify checksums on server next; no service changed'
