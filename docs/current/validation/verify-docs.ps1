$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = 'E:\Git projects\TS-frontend'
$current = Join-Path $repo 'docs\current'
$legacy = Join-Path $repo 'docs\legacy'
$manifest = Get-Content -LiteralPath (Join-Path $legacy '归档清单.json') -Raw -Encoding utf8 | ConvertFrom-Json
$errors = [Collections.Generic.List[string]]::new()
$checkedArchive = 0
$checkedCopies = 0
foreach ($file in $manifest.files) {
    if ($file.storage -eq 'zip') {
        $zip = [IO.Compression.ZipFile]::OpenRead($file.archive_path)
        try {
            $entry = $zip.GetEntry($file.archive_entry)
            if ($null -eq $entry) { $errors.Add("Missing ZIP entry: $($file.archive_entry)"); continue }
            $stream = $entry.Open()
            try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) }
            finally { $stream.Dispose() }
            $length = $entry.Length
        } finally { $zip.Dispose() }
        if (-not (Test-Path -LiteralPath $file.expanded_copy_path -PathType Leaf)) {
            $errors.Add("Missing expanded copy: $($file.expanded_copy_path)")
        } elseif ((Get-FileHash -LiteralPath $file.expanded_copy_path -Algorithm SHA256).Hash -ne $file.sha256) {
            $errors.Add("Expanded copy hash mismatch: $($file.expanded_copy_path)")
        } else { $checkedCopies++ }
    } else {
        if (-not (Test-Path -LiteralPath $file.archive_path -PathType Leaf)) { $errors.Add("Missing archive file: $($file.archive_path)"); continue }
        $hash = (Get-FileHash -LiteralPath $file.archive_path -Algorithm SHA256).Hash
        $length = (Get-Item -LiteralPath $file.archive_path).Length
    }
    if ($hash -ne $file.sha256 -or $length -ne $file.bytes) { $errors.Add("Archive content mismatch: $($file.original_path)") }
    else { $checkedArchive++ }
    if ($file.action -eq 'move' -and (Test-Path -LiteralPath $file.original_path)) { $errors.Add("Moved original remains: $($file.original_path)") }
}
$source = Get-Content -LiteralPath (Join-Path $current '源码证据清单.json') -Raw -Encoding utf8 | ConvertFrom-Json
$checkedSource = 0
foreach ($file in $source.files) {
    if ((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash -ne $file.sha256) { $errors.Add("Source changed: $($file.path)") }
    else { $checkedSource++ }
}
$markdown = @(Get-ChildItem -LiteralPath $current -File -Filter '*.md')
$entrypoints = @((Join-Path $repo 'README.md'), (Join-Path $repo 'AGENTS.md'), (Join-Path $repo 'docs\README.md'), (Join-Path $legacy 'README.md'), 'C:\Users\zhouguangjian\Documents\ChatGPT\EE AGENT FRONTEND\artifacts\README.md')
$checkPaths = @($markdown.FullName) + $entrypoints
$linkCount = 0
$utf8 = [Text.UTF8Encoding]::new($false, $true)
foreach ($path in $checkPaths) {
    $text = [IO.File]::ReadAllText($path, $utf8)
    if ($text.Contains([char]0xFFFD)) { $errors.Add("Replacement character: $path") }
    if (([regex]::Matches($text, '(?m)^```').Count % 2) -ne 0) { $errors.Add("Unclosed code fence: $path") }
    foreach ($match in [regex]::Matches($text, '\]\(<([^>]+)>\)')) {
        $target = [Uri]::UnescapeDataString($match.Groups[1].Value)
        if ($target -match '^[A-Za-z]:[/\\]') {
            if (-not (Test-Path -LiteralPath $target)) { $errors.Add("Broken link in ${path}: $target") }
            $linkCount++
        }
    }
}
$oldReference = 'docs/(figma-tokens|figma-map|一期实施计划与进度|前端页面交互规则|标签页与左侧导航交互规范)\.md'
$agents = Get-Content -LiteralPath (Join-Path $repo 'AGENTS.md') -Raw -Encoding utf8
if ($agents -match $oldReference) { $errors.Add('AGENTS contains an obsolete active documentation reference') }
$unexpectedCode = @(Get-ChildItem -LiteralPath $legacy -Recurse -File | Where-Object { $_.Extension -in @('.ts', '.tsx', '.mts') })
if ($unexpectedCode.Count) { $errors.Add('Legacy contains unpacked TypeScript files included by current tsconfig') }
$results = [ordered]@{
    date = '2026-09-20'
    archive_original_files = $manifest.file_count
    archive_hashes_matched = $checkedArchive
    zip_expanded_copies_matched = $checkedCopies
    source_evidence_hashes_matched = $checkedSource
    current_markdown_files = $markdown.Count
    markdown_and_entrypoints_checked = $checkPaths.Count
    local_links_checked = $linkCount
    missing_or_changed_archive_files = $manifest.file_count - $checkedArchive
    errors = @($errors)
    passed = ($errors.Count -eq 0)
}
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $current 'validation\document-checks.json') -Encoding utf8
$results | ConvertTo-Json -Depth 6
if ($errors.Count) { exit 1 }
