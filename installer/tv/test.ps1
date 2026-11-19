# Compiles and runs the TV installer's console tests (no NuGet, no test framework).
#   powershell -ExecutionPolicy Bypass -File installer\tv\test.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework 4 C# compiler (csc.exe) was not found.' }

$out = Join-Path ([IO.Path]::GetTempPath()) 'foxbloom-tv-tests'
New-Item -ItemType Directory -Force $out | Out-Null
$exe = Join-Path $out 'TvTests.exe'
# Each later sub-task adds its source here (Sdb.cs in 11c); tests/*.cs are picked up automatically.
$sources = @(@("TvDiscovery.cs", "SamsungCert.cs", "WgtSigner.cs", "Sdb.cs") | ForEach-Object { Join-Path $here $_ })
$sources += @(Get-ChildItem (Join-Path $here 'tests') -Filter *.cs | ForEach-Object { $_.FullName })
& $csc /nologo /target:exe /debug+ "/out:$exe" /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll /reference:System.Xml.dll /reference:System.IO.Compression.dll @sources
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
& $exe (Join-Path $here 'tests\fixtures')
exit $LASTEXITCODE
