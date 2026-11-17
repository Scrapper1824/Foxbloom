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
    $g.ScaleTransform(($size / 64.0), ($size / 64.0))
    $Back = [System.Drawing.Color]::FromArgb(29, 36, 64)
    # Pink fox face on the tile (same shapes as web/src/components/Logo.tsx, on a 64-unit grid).
    $c = { param($r, $g2, $b) New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($r, $g2, $b)) }
    $pink = & $c 244 143 174; $shade = & $c 226 118 154; $dark = & $c 59 21 48; $cream = & $c 255 244 247; $white = & $c 255 255 255
    $poly = { param($brush, [float[]]$p) $pts = for ($k = 0; $k -lt $p.Length; $k += 2) { New-Object System.Drawing.PointF($p[$k], $p[$k + 1]) }; $g.FillPolygon($brush, [System.Drawing.PointF[]]$pts) }
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(0, 0, 32, 32, 180, 90); $tile.AddArc(32, 0, 32, 32, 270, 90); $tile.AddArc(32, 32, 32, 32, 0, 90); $tile.AddArc(0, 32, 32, 32, 90, 90)
    $tile.CloseFigure(); $g.FillPath((New-Object System.Drawing.SolidBrush $Back), $tile)
    & $poly $pink @(12, 4, 28, 18, 14, 26)
    & $poly $shade @(52, 4, 36, 18, 50, 26)
    & $poly $dark @(12, 4, 17.4, 8.8, 13.2, 11.6); & $poly $dark @(52, 4, 46.6, 8.8, 50.8, 11.6)
    & $poly $cream @(14.8, 12.4, 23.4, 19.2, 16, 23.4); & $poly $cream @(49.2, 12.4, 40.6, 19.2, 48, 23.4)
    $head = New-Object System.Drawing.Drawing2D.GraphicsPath
    $head.AddBezier(16, 18, 24, 14, 40, 14, 48, 18)
    $head.AddLines([System.Drawing.PointF[]]@((New-Object System.Drawing.PointF(48, 18)), (New-Object System.Drawing.PointF(52, 28)), (New-Object System.Drawing.PointF(60, 34)), (New-Object System.Drawing.PointF(50, 37)), (New-Object System.Drawing.PointF(45, 45)), (New-Object System.Drawing.PointF(32, 54)), (New-Object System.Drawing.PointF(19, 45)), (New-Object System.Drawing.PointF(14, 37)), (New-Object System.Drawing.PointF(4, 34)), (New-Object System.Drawing.PointF(12, 28)), (New-Object System.Drawing.PointF(16, 18))))
    $head.CloseFigure(); $g.FillPath($pink, $head)
    $brow = New-Object System.Drawing.Drawing2D.GraphicsPath
    $brow.AddLine(26.6, 16.8, 32, 22.6); $brow.AddLine(32, 22.6, 37.4, 16.8); $brow.AddBezier(37.4, 16.8, 34, 16, 30, 16, 26.6, 16.8)
    $brow.CloseFigure(); $g.FillPath($shade, $brow)
    $face = New-Object System.Drawing.Drawing2D.GraphicsPath
    $face.AddLine(5, 34, 14, 32.6); $face.AddBezier(14, 32.6, 19, 38.6, 25, 41.4, 32, 42.6); $face.AddBezier(32, 42.6, 39, 41.4, 45, 38.6, 50, 32.6)
    $face.AddLines([System.Drawing.PointF[]]@((New-Object System.Drawing.PointF(50, 32.6)), (New-Object System.Drawing.PointF(59, 34)), (New-Object System.Drawing.PointF(50, 37.6)), (New-Object System.Drawing.PointF(45, 45)), (New-Object System.Drawing.PointF(32, 54)), (New-Object System.Drawing.PointF(19, 45)), (New-Object System.Drawing.PointF(14, 37.6))))
    $face.CloseFigure(); $g.FillPath($cream, $face)
    $nose = New-Object System.Drawing.Drawing2D.GraphicsPath
    $nose.AddBezier(29.4, 49.4, 29.4, 47.8, 34.6, 47.8, 34.6, 49.4); $nose.AddBezier(34.6, 49.4, 34.6, 51, 33, 52.4, 32, 52.4); $nose.AddBezier(32, 52.4, 31, 52.4, 29.4, 51, 29.4, 49.4)
    $nose.CloseFigure(); $g.FillPath($dark, $nose)
    $g.FillEllipse($dark, 20.3, 26.8, 6.6, 7.6); $g.FillEllipse($dark, 37.1, 26.8, 6.6, 7.6)
    $g.FillEllipse($white, 23.55, 27.95, 2.5, 2.5); $g.FillEllipse($white, 40.35, 27.95, 2.5, 2.5)
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
