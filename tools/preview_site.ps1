param(
    [string]$HugoExecutable = 'hugo',
    [string]$PythonExecutable = 'python',
    [int]$Port = 1313,
    [switch]$IncludeDrafts
)
$ErrorActionPreference = 'Stop'
$previewRoot = Join-Path ([IO.Path]::GetTempPath()) ('nagakagachi-preview-' + [guid]::NewGuid().ToString('N'))
$buildArguments = @((Join-Path $PSScriptRoot 'build_site.py'), '--destination', $previewRoot, '--hugo', $HugoExecutable)
if ($IncludeDrafts) { $buildArguments += '--drafts' }
& $PythonExecutable @buildArguments
if ($LASTEXITCODE -ne 0) { throw "Site build failed with code $LASTEXITCODE" }
Write-Host "Preview: http://localhost:$Port/ (rebuild after editing)"
& $PythonExecutable -m http.server $Port --bind 127.0.0.1 --directory $previewRoot
if ($LASTEXITCODE -ne 0) { throw "Preview server exited with code $LASTEXITCODE" }
