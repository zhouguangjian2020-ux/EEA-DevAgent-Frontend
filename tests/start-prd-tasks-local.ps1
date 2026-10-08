# Fresh localhost-only task-enabled preview. No upload, company DB or deployment.
param([switch]$Smoke)
$ErrorActionPreference = 'Stop'
$Backend = 'E:/Git projects/TS-backend'
$Python = Join-Path $Backend '.venv/Scripts/python.exe'
$Runner = Join-Path $Backend 'tests/run_prd_tasks_local.py'
foreach ($File in @($Python, $Runner)) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "LOCAL_FILE_MISSING: $File" }
}
# Resolve Node explicitly instead of assuming the caller's PowerShell PATH contains
# Codex's bundled runtime. The child Python harness uses shutil.which('node'), so
# the resolved directory must be added to PATH before the harness starts.
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCommand) {
    $NodeCandidates = @(
        (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'),
        (Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/node/bin/node.exe'),
        'C:/Program Files/nodejs/node.exe',
        'C:/Program Files (x86)/nodejs/node.exe'
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    $NodePath = $NodeCandidates | Select-Object -First 1
    if ($NodePath) {
        $NodeDir = Split-Path -Parent $NodePath
        $env:Path = $NodeDir + ';' + $env:Path
        $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    }
}
if (-not $NodeCommand) {
    throw 'NODE_NOT_FOUND: could not find Node.js in PATH or the bundled local runtime. Install Node.js or set PATH, then rerun this script.'
}
Write-Host ('NODE_OK: ' + $NodeCommand.Source)
foreach ($Port in @(3109, 8109, 8419, 7219, 56431)) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "LOCAL_PORT_IN_USE: $Port. Close your earlier preview window first; this script will not stop existing services."
    }
}
Write-Host 'LOCAL_ONLY: new disposable database, real frontend/backend, contract Mock Agent.'
Write-Host 'Login: engineer01 / change-me-before-demo'
Write-Host 'Wait for LOCAL_PREVIEW_READY, then open its full URL. Keep this window open; Ctrl+C stops owned preview services.'
Push-Location -LiteralPath $Backend
try {
    $Arguments = @($Runner, '--serve')
    if ($Smoke) { $Arguments += '--smoke' }
    & $Python @Arguments
    if ($LASTEXITCODE -ne 0) { throw "LOCAL_TASK_PREVIEW_FAILED: exit=$LASTEXITCODE; send the terminal output." }
} finally { Pop-Location }
