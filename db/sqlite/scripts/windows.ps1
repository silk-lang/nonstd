<#
.SYNOPSIS
Build the manifest-pinned SQLite amalgamation and Silk shim, preserving unrelated native overrides.
#>
[CmdletBinding()]
param([string] $Clang = $env:SILK_CLANG)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or $env:VSCMD_ARG_TGT_ARCH -ne 'x64' -or -not $env:INCLUDE -or -not $env:LIB) {
    throw 'Run from an x64 Visual Studio developer PowerShell with the Windows SDK.'
}
$Package = Split-Path -Parent $PSScriptRoot
$Repo = Split-Path -Parent (Split-Path -Parent $Package)
$Out = Join-Path $Repo '.cache/db-sqlite/windows'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Manifest = [IO.File]::ReadAllText((Join-Path $Package 'silk.toml'))
$Archive = [regex]::Match($Manifest, '(?ms)^\[native\.archive\.sqlite\]\s*\n(.*?)(?=^\[|\z)').Groups[1].Value
$Url = [regex]::Match($Archive, '(?m)^url\s*=\s*"([^"]+)"').Groups[1].Value
$Hash = [regex]::Match($Archive, '(?m)^sha256\s*=\s*"([0-9a-f]{64})"').Groups[1].Value
if (-not $Url -or -not $Hash) { throw 'Missing pinned SQLite archive in silk.toml.' }
$Source = [regex]::Match($Manifest, '\{\s*c\s*=\s*"sqlite:sqlite3.c"[^}]+\}').Value
$Defines = @([regex]::Matches($Source, '"(-D[^"\r\n]+)"') | ForEach-Object { $_.Groups[1].Value })
if ($Defines.Count -eq 0) { throw 'Missing SQLite compile definitions in silk.toml.' }
function Invoke-Tool([string] $Program, [string[]] $Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with status $LASTEXITCODE" }
}
if (-not $Clang) { $Clang = 'clang.exe' }
$Clang = (Get-Command $Clang -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$Bin = Split-Path -Parent $Clang
$Stamp = Join-Path $Out 'sqlite.sha256'
if (-not (Test-Path $Stamp) -or [IO.File]::ReadAllText($Stamp).Trim() -ne $Hash -or -not (Test-Path "$Out/sqlite3.c") -or -not (Test-Path "$Out/sqlite3.h")) {
    $Temporary = Join-Path $Out ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Temporary | Out-Null
    try {
        $Download = Join-Path $Temporary 'sqlite.tar.gz'
        Invoke-WebRequest -Uri $Url -OutFile $Download
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Download).Hash.ToLowerInvariant() -ne $Hash) { throw 'SQLite archive SHA-256 mismatch.' }
        $Entries = @(& tar.exe -tf $Download)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot list SQLite archive.' }
        foreach ($Name in @('sqlite3.c', 'sqlite3.h')) {
            $Matches = @($Entries | Where-Object { $_ -match ('^[^/\\]+/' + [regex]::Escape($Name) + '$') -and $_ -notmatch '^\.\./' })
            if ($Matches.Count -ne 1) { throw "Expected one SQLite archive member for $Name." }
            Invoke-Tool 'tar.exe' @('-xf', $Download, '-C', $Temporary, '--strip-components=1', $Matches[0])
            Copy-Item -LiteralPath (Join-Path $Temporary $Name) -Destination (Join-Path $Out $Name) -Force
        }
        [IO.File]::WriteAllText($Stamp, "$Hash`n", $Utf8)
    } finally { Remove-Item -LiteralPath $Temporary -Recurse -Force }
}
$Flags = @('--target=x86_64-pc-windows-msvc', '-fms-runtime-lib=dll', '-O2', '-D_CRT_SECURE_NO_WARNINGS')
Invoke-Tool $Clang ($Flags + @('-w') + $Defines + @('-c', "$Out/sqlite3.c", '-o', "$Out/sqlite3.obj"))
Invoke-Tool $Clang ($Flags + @('-std=c11', '-Wall', '-Wextra', '-Werror', "-I$Out", '-c', "$Package/native/shim.c", '-o', "$Out/shim.obj"))
$Library = Join-Path $Out 'silksqlite.lib'
if (Test-Path $Library) { Remove-Item -LiteralPath $Library }
$Archiver = Join-Path $Bin 'llvm-lib.exe'
if (Test-Path $Archiver) { Invoke-Tool $Archiver @("/out:$Library", "$Out/sqlite3.obj", "$Out/shim.obj") }
else { Invoke-Tool (Join-Path $Bin 'llvm-ar.exe') @('rcs', $Library, "$Out/sqlite3.obj", "$Out/shim.obj") }
foreach ($Name in @('kernel32', 'ucrt', 'vcruntime')) {
    $Import = $null
    foreach ($Directory in ($env:LIB -split ';')) {
        if (-not $Directory) { continue }
        $Candidate = Join-Path $Directory "$Name.lib"
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) { $Import = $Candidate; break }
    }
    if (-not $Import) { throw "Cannot find $Name.lib in LIB." }
    Copy-Item -LiteralPath $Import -Destination (Join-Path $Out "$Name.lib") -Force
}
$HomePath = if ($env:SILK_HOME) { [IO.Path]::GetFullPath($env:SILK_HOME) } else { Join-Path $HOME '.silk' }
New-Item -ItemType Directory -Path $HomePath -Force | Out-Null
$Overrides = Join-Path $HomePath 'native-overrides.toml'
$Text = if (Test-Path $Overrides) { [IO.File]::ReadAllText($Overrides) } else { '' }
$Absolute = [IO.Path]::GetFullPath($Out).Replace('\', '/')
if ($Absolute.StartsWith('//')) { throw 'Silk native overrides require a local drive, not a UNC path.' }
$Encoded = ('/' + $Absolute) | ConvertTo-Json -Compress
$Parts = @('native', 'override', 'sqlite') | ForEach-Object { '(?:' + $_ + '|"' + $_ + '"|\x27' + $_ + '\x27)' }
$Header = '(?m)^[\t ]*\[[\t ]*' + ($Parts -join '[\t ]*\.[\t ]*') + '[\t ]*\][\t ]*(?:#[^\r\n]*)?\r?$'
$Match = [regex]::Match($Text, $Header)
if (-not $Match.Success) { $Text = $Text.TrimEnd("`r", "`n") + "`n`n[native.override.sqlite]`npath = $Encoded`n" }
else {
    $Start = $Match.Index + $Match.Length
    $Next = [regex]::Match($Text.Substring($Start), '(?m)^[\t ]*\[')
    $End = if ($Next.Success) { $Start + $Next.Index } else { $Text.Length }
    $Body = $Text.Substring($Start, $End - $Start)
    $PathLine = [regex]::new('(?m)^[\t ]*(?:path|"path"|\x27path\x27)[\t ]*=[^\r\n]*')
    if ($PathLine.IsMatch($Body)) { $Body = $PathLine.Replace($Body, [System.Text.RegularExpressions.MatchEvaluator] { param($m) "path = $Encoded" }) }
    else { $Body = "`npath = $Encoded`n" + $Body }
    $Text = $Text.Substring(0, $Start) + $Body + $Text.Substring($End)
}
$Pending = "$Overrides.$([Guid]::NewGuid().ToString('N')).tmp"
try {
    [IO.File]::WriteAllText($Pending, $Text, $Utf8)
    if (Test-Path $Overrides) { [IO.File]::Replace($Pending, $Overrides, [NullString]::Value) }
    else { [IO.File]::Move($Pending, $Overrides) }
} finally { if (Test-Path $Pending) { Remove-Item -LiteralPath $Pending -Force } }
Write-Host "Prepared SQLite and updated only its override in $Overrides"
