# Compiles launcher/OneStopLauncher.cs into OneStop.exe at the repository root (see launcher/README.md).
#
# Uses the C# compiler that ships with every Windows 10/11 install (.NET Framework 4.x), so nothing
# has to be installed or paid for. Run it after editing the launcher:  npm run build:launcher
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework C# compiler (csc.exe) was not found. It ships with Windows 10/11.' }

$icon = Join-Path $root 'launcher\onestop.ico'
$source = Join-Path $root 'launcher\OneStopLauncher.cs'
$out = Join-Path $root 'OneStop.exe'

& $csc /nologo /target:winexe /optimize+ /platform:anycpu `
  "/out:$out" "/win32icon:$icon" "/resource:$icon,OneStop.ico" `
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
  $source
if ($LASTEXITCODE -ne 0) { throw 'Compiling the launcher failed (see the errors above).' }
Write-Host "Built $out"
