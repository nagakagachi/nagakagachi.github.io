param(
    [string]$HugoExecutable = 'hugo',
    [int]$Port = 1313,
    [switch]$IncludeDrafts
)
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$previewRoot = Join-Path ([IO.Path]::GetTempPath()) ('nagakagachi-preview-' + [guid]::NewGuid().ToString('N'))
$hugoArguments = @('server', '--source', (Join-Path $repositoryRoot 'site'), '--destination', $previewRoot, '--cacheDir', (Join-Path $previewRoot 'cache'), '--noBuildLock', '--bind', '127.0.0.1', '--port', $Port, '--disableFastRender')
if ($IncludeDrafts) { $hugoArguments += '--buildDrafts' }
& $HugoExecutable @hugoArguments
if ($LASTEXITCODE -ne 0) { throw "Hugo exited with code $LASTEXITCODE" }
