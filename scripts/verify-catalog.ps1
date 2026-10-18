<#
.SYNOPSIS
  Verifies the built-in catalog against this Windows installation and its documentation.

.DESCRIPTION
  Never executes catalog commands. For every entry it checks:
    exe          - the program exists in System32; listed flags appear in its own "/?" help text
    cmd-builtin  - "help <name>" knows the command; listed flags appear in that help text
    cmdlet       - Get-Command finds it in Windows PowerShell; listed parameters exist
    sources      - each documentation URL resolves (HTTP 200), unless -SkipNetwork

  Run from the repo root:  powershell -NoProfile -File scripts/verify-catalog.ps1
  Exit code 0 = everything verified, 1 = at least one failure.
#>
param([switch]$SkipNetwork)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$system32 = Join-Path $env:SystemRoot 'System32'
$failures = New-Object System.Collections.Generic.List[string]
$checked = 0
$urlCache = @{}

function Get-HelpText([string]$file, [string[]]$arguments) {
    $out = [IO.Path]::GetTempFileName(); $err = [IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $file -ArgumentList $arguments -NoNewWindow -PassThru `
            -RedirectStandardOutput $out -RedirectStandardError $err
        if (-not $p.WaitForExit(15000)) { $p.Kill(); return $null }
        return (Get-Content -Raw $out) + (Get-Content -Raw $err)
    } finally { Remove-Item $out, $err -ErrorAction SilentlyContinue }
}

function Test-Flags([string]$text, [string[]]$flags, [string]$id, [string]$what) {
    foreach ($flag in $flags) {
        # Flag followed by a non-word character, case-insensitive (e.g. "/all", "-n", "/FS:").
        if ($text -notmatch ('(?i)' + [regex]::Escape($flag) + '(?![A-Za-z0-9])')) {
            $failures.Add("$id : flag '$flag' not found in help for $what")
        }
    }
}

function Test-Url([string]$url, [string]$id) {
    if ($urlCache.ContainsKey($url)) { $status = $urlCache[$url] }
    else {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -Method Get -MaximumRedirection 5 -TimeoutSec 30
            $status = [int]$r.StatusCode
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
        }
        $urlCache[$url] = $status
    }
    if ($status -ne 200) { $failures.Add("$id : source returned HTTP $status : $url") }
}

foreach ($file in Get-ChildItem (Join-Path $root 'catalog') -Filter *.json) {
    $catalog = Get-Content -Raw -Encoding UTF8 $file.FullName | ConvertFrom-Json
    foreach ($entry in $catalog.commands) {
        $checked++
        foreach ($program in $entry.programs) {
            $flags = @($program.flags | Where-Object { $_ })
            switch ($program.kind) {
                'exe' {
                    $path = Join-Path $system32 $program.name
                    if (-not (Test-Path -LiteralPath $path)) { $failures.Add("$($entry.id) : $path not found"); break }
                    if ($flags.Count -gt 0) {
                        $help = Get-HelpText $path @('/?')
                        if ($null -eq $help) { $failures.Add("$($entry.id) : '$($program.name) /?' timed out") }
                        else { Test-Flags $help $flags $entry.id "$($program.name) /?" }
                    }
                }
                'cmd-builtin' {
                    $help = Get-HelpText (Join-Path $system32 'cmd.exe') @('/d', '/c', "help $($program.name)")
                    if ($null -eq $help -or $help -match 'not supported by the help utility') {
                        $failures.Add("$($entry.id) : cmd does not know built-in '$($program.name)'")
                    } else { Test-Flags $help $flags $entry.id "help $($program.name)" }
                }
                'cmdlet' {
                    $cmd = Get-Command -Name $program.name -ErrorAction SilentlyContinue
                    if (-not $cmd) { $failures.Add("$($entry.id) : cmdlet $($program.name) not found"); break }
                    foreach ($param in @($program.parameters | Where-Object { $_ })) {
                        if (-not $cmd.Parameters.ContainsKey($param)) {
                            $failures.Add("$($entry.id) : $($program.name) has no parameter -$param")
                        }
                    }
                }
                default { $failures.Add("$($entry.id) : unknown program kind '$($program.kind)'") }
            }
        }
        if (-not $SkipNetwork) { foreach ($url in $entry.sources) { Test-Url $url $entry.id } }
    }
}

"Checked $checked entries ($($urlCache.Count) distinct source URLs) on Windows $([Environment]::OSVersion.Version), PowerShell $($PSVersionTable.PSVersion)."
if ($failures.Count -eq 0) { 'All checks passed.'; exit 0 }
"$($failures.Count) failure(s):"
$failures | ForEach-Object { "  - $_" }
exit 1
