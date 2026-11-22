# Link this repo's plugins into a career-ops checkout as directory junctions.
# Usage: .\scripts\install.ps1 -CareerOps C:\path\to\career-ops
# Junctions need no admin rights, and edits in this repo show up in career-ops at once.
param(
    [Parameter(Mandatory = $true)][string]$CareerOps
)
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $CareerOps "plugins.mjs"))) {
    throw "Not a career-ops checkout: $CareerOps"
}

$localDir = Join-Path $CareerOps "plugins.local"
New-Item -ItemType Directory -Force -Path $localDir | Out-Null

Get-ChildItem -Directory (Join-Path $repo "plugins") | ForEach-Object {
    $target = Join-Path $localDir $_.Name
    if (Test-Path $target) {
        Write-Host "skip (exists): $target"
    } else {
        New-Item -ItemType Junction -Path $target -Target $_.FullName | Out-Null
        Write-Host "linked: $target -> $($_.FullName)"
    }
}
