# A new disposable localhost database only; never company SSH/DB or old previews.
$ErrorActionPreference = 'Stop'
$Backend = 'E:/Git projects/TS-backend'
$Python = Join-Path $Backend '.venv/Scripts/python.exe'
$Runner = Join-Path $Backend 'tests/run_prd_creation_local.py'
foreach ($File in @($Python, $Runner)) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "LOCAL_FILE_MISSING: $File" }
}
foreach ($Port in @(3109, 8109, 8419, 56429)) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "LOCAL_PORT_IN_USE: $Port; existing services were not stopped. Close your previous local preview window first."
    }
}
Write-Host 'LOCAL_ONLY: new disposable database and contract Mock Agent. No company service will be accessed.'
Write-Host 'Local login: engineer01 / change-me-before-demo'
Write-Host 'Keep this window open; wait for LOCAL_PREVIEW_READY. Ctrl+C stops only owned local services.'
Push-Location -LiteralPath $Backend
try {
    & $Python $Runner --serve
    if ($LASTEXITCODE -ne 0) { throw "LOCAL_PRD_PREVIEW_FAILED: exit=$LASTEXITCODE; please send the safe terminal output." }
} finally { Pop-Location }
