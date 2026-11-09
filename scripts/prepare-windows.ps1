<#
.SYNOPSIS
Prepare pinned lib-native and retained SQLite without replacing unrelated global overrides.
#>
[CmdletBinding()]
param([string] $Clang = $env:SILK_CLANG, [string] $RuntimeDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
    $Silk = if ($env:SILK) { $env:SILK } else { 'silkc' }
    & $Silk check --manifest-path (Join-Path $Root 'examples/graphics-demo/app/silk.toml')
    if ($LASTEXITCODE -ne 0) { throw 'Silk dependency fetch/check failed.' }
    $Native = & node (Join-Path $PSScriptRoot 'dependency-root.mjs') lib-native
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve pinned lib-native checkout.' }
    $Arguments = @{}
    if ($Clang) { $Arguments.Clang = $Clang }
    if ($RuntimeDirectory) { $Arguments.RuntimeDirectory = $RuntimeDirectory }
    $Runtime = & (Join-Path $Native 'scripts/prepare-windows.ps1') @Arguments -Json | ConvertFrom-Json
    & (Join-Path $Root 'db/sqlite/scripts/windows.ps1') -Clang $Clang
    $RuntimePaths = @((Join-Path $Runtime.dawn 'bin'), $Runtime.dxc, (Join-Path $Runtime.glfw 'lib-vc2022'))
    $Cache = Join-Path $Root '.cache'
    New-Item -ItemType Directory -Path $Cache -Force | Out-Null
    $Utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $Cache 'windows-runtime.json'), ($RuntimePaths | ConvertTo-Json), $Utf8)
    $env:PATH = ($RuntimePaths -join ';') + ';' + $env:PATH
    if ($env:GITHUB_PATH) {
        [IO.File]::AppendAllText($env:GITHUB_PATH, ($RuntimePaths -join "`n") + "`n", $Utf8)
    }
} finally { Pop-Location }
