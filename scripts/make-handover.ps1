# Packs a clean copy of OneStop to give to someone else: dist/OneStop.zip (see launcher/README.md).
#
# Built from the last commit with `git archive`, so it contains exactly what is in the repository
# (OneStop.exe included) and none of this machine's private or bulky files: no `.env` (database
# URL, API keys, auth secret), no node_modules, no build output, no saved QR data. The recipient
# unzips it and double-clicks OneStop.exe; the launcher installs, builds and creates their own `.env`.
# Uncommitted changes are NOT included - commit first.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist 'OneStop.zip'

$dirty = git -C $root status --porcelain
if ($dirty) { Write-Warning 'You have uncommitted changes; they will NOT be in the zip (it is built from the last commit).' }

git -C $root archive --format=zip --prefix=OneStop/ -o $zip HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Wrote $zip ($mb MB). Send this file; the recipient unzips it and double-clicks OneStop\OneStop.exe."
