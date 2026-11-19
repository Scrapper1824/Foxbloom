# Builds installer\dist\FoxbloomTVSetup.exe with the C# compiler that ships with Windows (.NET Framework 4).
#   powershell -ExecutionPolicy Bypass -File installer\tv\build.ps1            (release build)
#   powershell -ExecutionPolicy Bypass -File installer\tv\build.ps1 -NoVendor  (development: without sdb.exe and Samsung's CA certificates)
#
# Embedded as resources:
#   Foxbloom.wgt   the UNSIGNED app: tv\dist + config.xml + icon.png, zipped (the installer signs it per TV)
#   sdb.exe        Samsung's Smart Development Bridge          } from installer\tv\vendor\ (not in git; see the README there)
#   SamsungCA.*    Samsung's two public CA certificates        }
# Without -NoVendor, missing vendor files stop the build. With it, the exe builds but says "this build can't install".
param([switch]$NoVendor)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Split-Path -Parent $here
$repo = Split-Path -Parent $installer
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework 4 C# compiler (csc.exe) was not found.' }

# --- vendor files -------------------------------------------------------------------------------------------------
$vendor = Join-Path $here 'vendor'
$vendorFiles = @(
  @{ File = 'sdb.exe'; Resource = 'sdb.exe'; From = "Samsung's Tizen SDK tools (Tizen Studio > tools\sdb.exe, or the Tizen Studio command-line tools download)" },
  @{ File = 'vd_tizen_dev_author_ca.cer'; Resource = 'SamsungCA.vd_tizen_dev_author_ca.cer'; From = "Samsung's Certificate Extension for Tizen Studio (its ca folder)" },
  @{ File = 'vd_tizen_dev_public2.crt'; Resource = 'SamsungCA.vd_tizen_dev_public2.crt'; From = "Samsung's Certificate Extension for Tizen Studio (its ca folder)" }
)
$resources = @()
if (-not $NoVendor) {
  $missing = @($vendorFiles | Where-Object { -not (Test-Path (Join-Path $vendor $_.File)) })
  if ($missing.Count -gt 0) {
    $lines = $missing | ForEach-Object { "  - $($_.File): from $($_.From)" }
    throw ("Cannot build FoxbloomTVSetup.exe: these files are missing from installer\tv\vendor\:`n" + ($lines -join "`n") +
      "`nSee installer\tv\vendor\README.md. For a development build that cannot install on a TV, run this script with -NoVendor.")
  }
  foreach ($v in $vendorFiles) { $resources += "/resource:$(Join-Path $vendor $v.File),$($v.Resource)" }
}

# --- the unsigned app package -------------------------------------------------------------------------------------
Push-Location $repo
try { & npm run build -w tv; if ($LASTEXITCODE -ne 0) { throw "npm run build -w tv failed ($LASTEXITCODE)" } } finally { Pop-Location }
$tvDist = Join-Path $repo 'tv\dist'
if (-not (Test-Path (Join-Path $tvDist 'index.html'))) { throw "tv\dist\index.html not found after the TV build." }

$stage = Join-Path ([IO.Path]::GetTempPath()) ('foxbloom-wgt-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage | Out-Null
try {
  Copy-Item (Join-Path $tvDist '*') $stage -Recurse -Force
  Copy-Item (Join-Path $repo 'tv\config.xml') (Join-Path $stage 'config.xml') -Force
  $icon = Join-Path $tvDist 'icon.png'
  if (-not (Test-Path $icon)) { $icon = Join-Path $repo 'tv\public\icon.png' }
  if (-not (Test-Path $icon)) { throw 'icon.png not found in tv\dist or tv\public.' }
  Copy-Item $icon (Join-Path $stage 'icon.png') -Force

  # Tizen loads the app from file://, where a crossorigin attribute makes script and stylesheet loads fail.
  $indexPath = Join-Path $stage 'index.html'
  $html = [IO.File]::ReadAllText($indexPath)
  $html = [regex]::Replace($html, '<(script|link)\b[^>]*>', { param($m) [regex]::Replace($m.Value, '\s+crossorigin(?:=("[^"]*"|''[^'']*''|[^\s>]+))?', '') })
  # The Samsung runtime script must have survived the Vite build exactly as written in tv\index.html.
  if ($html -notmatch '<script src="\$WEBAPIS/webapis/webapis\.js"></script>') {
    throw 'tv\dist\index.html lost the <script src="$WEBAPIS/webapis/webapis.js"></script> tag; the TV app would have no Samsung APIs. Check tv\index.html and the Vite build.'
  }
  [IO.File]::WriteAllText($indexPath, $html, (New-Object Text.UTF8Encoding($false)))

  Add-Type -AssemblyName System.IO.Compression
  $wgt = Join-Path $stage '..\Foxbloom-unsigned.wgt'
  $wgt = [IO.Path]::GetFullPath($wgt)
  if (Test-Path $wgt) { Remove-Item $wgt -Force }
  $fs = [IO.File]::Create($wgt)
  try {
    $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
    try {
      $root = (Resolve-Path $stage).Path.TrimEnd('\')
      foreach ($f in Get-ChildItem $stage -Recurse -File) {
        $name = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
        $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $es = $entry.Open()
        try { $b = [IO.File]::ReadAllBytes($f.FullName); $es.Write($b, 0, $b.Length) } finally { $es.Dispose() }
      }
    } finally { $zip.Dispose() }
  } finally { $fs.Dispose() }
  $resources += "/resource:$wgt,Foxbloom.wgt"

  # The Foxbloom fox icon is generated by the server installer's build; reuse it.
  $ico = Join-Path $installer 'mediarr.ico'
  if (-not (Test-Path $ico)) { & (Join-Path $installer 'build.ps1') | Out-Null }
  if (-not (Test-Path $ico)) { throw "Icon not found: $ico" }

  $dist = Join-Path $installer 'dist'
  New-Item -ItemType Directory -Force $dist | Out-Null
  $exe = Join-Path $dist 'FoxbloomTVSetup.exe'
  $sources = @('TvDiscovery.cs', 'SamsungCert.cs', 'WgtSigner.cs', 'Sdb.cs', 'FoxbloomTvSetup.cs') | ForEach-Object { Join-Path $here $_ }
  & $csc /nologo /target:winexe /optimize+ "/out:$exe" "/win32icon:$ico" "/win32manifest:$(Join-Path $here 'app.manifest')" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll /reference:System.Xml.dll /reference:System.IO.Compression.dll @resources @sources
  if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
  Write-Output "Built $exe$(if ($NoVendor) { ' (-NoVendor: cannot install on a TV)' })"
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path ([IO.Path]::GetTempPath()) 'Foxbloom-unsigned.wgt') -Force -ErrorAction SilentlyContinue
}
