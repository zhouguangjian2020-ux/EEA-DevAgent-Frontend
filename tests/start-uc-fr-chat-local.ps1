$ErrorActionPreference = 'Stop'
$Backend = 'E:/Git projects/TS-backend'
$Frontend = 'E:/Git projects/TS-frontend'
$Python = Join-Path $Backend '.venv/Scripts/python.exe'
$Runner = Join-Path $Backend 'tests/run_uc_fr_chat_local.py'
$NodeDir = 'C:/Users/zhouguangjian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'
$Required = @(
    $Python, $Runner, (Join-Path $NodeDir 'node.exe'),
    (Join-Path $Frontend 'node_modules/next/dist/bin/next'),
    (Join-Path $Frontend 'tmp/metadata-pg18-r2/pgsql/bin/pg_ctl.exe')


)
foreach ($File in $Required) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
        throw ('LOCAL_DEPENDENCY_MISSING: '+$File)
    }
}
$OldPath = $env:PATH
$OldPythonIo = $env:PYTHONIOENCODING
Push-Location -LiteralPath $Backend
try {
    $env:PATH = $NodeDir+';'+$OldPath
    $env:PYTHONIOENCODING = 'utf-8'
    Write-Host 'LOCAL ONLY: 3109/8109/8419/56429; contract Mock Agent; no company services.'
    Write-Host 'Starts isolated services without running regression suites or prompting for a password.'
    Write-Host 'LOGIN: engineer01 / change-me-before-demo (local fixture only).'
    Write-Host 'Wait for LOCAL_PREVIEW_READY. Keep this window open; Ctrl+C stops owned services.'
    & $Python $Runner --serve
    if ($LASTEXITCODE -ne 0) { throw ('LOCAL_PREVIEW_FAILED: exit='+$LASTEXITCODE+'; paste the safe terminal output.') }
}
finally {
    $env:PATH = $OldPath
    $env:PYTHONIOENCODING = $OldPythonIo
    Pop-Location
}
