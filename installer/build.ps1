# Builds installer\dist\FoxbloomSetup.exe with the C# compiler that ships with Windows (.NET Framework 4).
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework 4 C# compiler (csc.exe) was not found.' }

# The Foxbloom mark (same as the tray icon and the web logo), at the sizes Windows uses.
$ico = Join-Path $here 'mediarr.ico'
if (-not (Test-Path $ico)) {
  Add-Type -AssemblyName System.Drawing
  $pngs = @()
  foreach ($size in 16, 24, 32, 48, 64, 128, 256) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.ScaleTransform(($size / 32.0), ($size / 32.0))
    $Back = [System.Drawing.Color]::FromArgb(242, 167, 195)
    # Rounded tile, then the fox face with rose eyes and a five-petal bloom (same shapes as web/src/components/Logo.tsx).
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 9
    $tile.AddArc(1, 1, $r, $r, 180, 90); $tile.AddArc(31 - $r, 1, $r, $r, 270, 90)
    $tile.AddArc(31 - $r, 31 - $r, $r, $r, 0, 90); $tile.AddArc(1, 31 - $r, $r, $r, 90, 90)
    $tile.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $Back), $tile)
    $plum = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(42, 16, 36))
    $fox = New-Object System.Drawing.Drawing2D.GraphicsPath
    $fox.AddLine(6, 6, 13.5, 12.5); $fox.AddLine(13.5, 12.5, 18.5, 12.5); $fox.AddLine(18.5, 12.5, 26, 6); $fox.AddLine(26, 6, 24.6, 17)
    $fox.AddBezier(24.6, 17, 24.1, 22.6, 20.3, 26.4, 16, 27.5); $fox.AddBezier(16, 27.5, 11.7, 26.4, 7.9, 22.6, 7.4, 17)
    $fox.CloseFigure()
    $g.FillPath($plum, $fox)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $Back), 10.8, 18.85, 3.2, 2.3)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $Back), 18.0, 18.85, 3.2, 2.3)
    $petal = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(247, 198, 216))
    foreach ($a in 0, 72, 144, 216, 288) {
      $rad = ($a - 90) * [Math]::PI / 180
      $g.FillEllipse($petal, (16 + [Math]::Cos($rad) * 1.55 - 1.15), (16.2 + [Math]::Sin($rad) * 1.55 - 1.15), 2.3, 2.3)
    }
    $g.FillEllipse($plum, 15.25, 15.45, 1.5, 1.5)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs += , @($size, $ms.ToArray())
    $bmp.Dispose()
  }
  # ICO file: header, one directory entry per image, then the PNGs.
  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $out
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$pngs.Count)
  $offset = 6 + 16 * $pngs.Count
  foreach ($p in $pngs) {
    $dim = if ($p[0] -ge 256) { 0 } else { $p[0] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$p[1].Length); $w.Write([UInt32]$offset)
    $offset += $p[1].Length
  }
  foreach ($p in $pngs) { $w.Write([byte[]]$p[1]) }
  $w.Flush()
  [System.IO.File]::WriteAllBytes($ico, $out.ToArray())
}

$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$exe = Join-Path $dist 'FoxbloomSetup.exe'
& $csc /nologo /target:winexe /optimize+ "/out:$exe" "/win32icon:$ico" "/win32manifest:$(Join-Path $here 'app.manifest')" `
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Management.dll (Join-Path $here 'MediarrSetup.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Output "Built $exe"
