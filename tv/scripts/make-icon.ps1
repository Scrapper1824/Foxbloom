# Draws tv/public/icon.png (512x512): the Foxbloom fox from web/src/components/Logo.tsx on a 64-unit grid.
# Run: powershell -NoProfile -File tv/scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing
$size = 512
$k = $size / 64.0
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

function Brush($hex) { New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function Pt($x, $y) { New-Object System.Drawing.PointF ([float]($x * $k)), ([float]($y * $k)) }
function Poly($hex, [double[]]$p) {
  $pts = for ($i = 0; $i -lt $p.Length; $i += 2) { Pt $p[$i] $p[$i + 1] }
  $g.FillPolygon((Brush $hex), [System.Drawing.PointF[]]$pts)
}

# Midnight-blue rounded tile (rx 16)
$tile = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = 32 * $k
$tile.AddArc(0, 0, $d, $d, 180, 90); $tile.AddArc($size - $d, 0, $d, $d, 270, 90)
$tile.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $tile.AddArc(0, $size - $d, $d, $d, 90, 90)
$tile.CloseFigure()
$g.FillPath((Brush '#1d2440'), $tile)

# Ears
Poly '#f48fae' 12,4, 28,18, 14,26
Poly '#e2769a' 52,4, 36,18, 50,26
Poly '#3b1530' 12,4, 17.4,8.8, 13.2,11.6
Poly '#3b1530' 52,4, 46.6,8.8, 50.8,11.6
Poly '#fff4f7' 14.8,12.4, 23.4,19.2, 16,23.4
Poly '#fff4f7' 49.2,12.4, 40.6,19.2, 48,23.4

# Head: M16 18 C24 14 40 14 48 18 L52 28 L60 34 L50 37 L45 45 L32 54 L19 45 L14 37 L4 34 L12 28 Z
$head = New-Object System.Drawing.Drawing2D.GraphicsPath
$head.AddBezier((Pt 16 18), (Pt 24 14), (Pt 40 14), (Pt 48 18))
$head.AddLines([System.Drawing.PointF[]]@((Pt 48 18), (Pt 52 28), (Pt 60 34), (Pt 50 37), (Pt 45 45), (Pt 32 54), (Pt 19 45), (Pt 14 37), (Pt 4 34), (Pt 12 28)))
$head.CloseFigure()
$g.FillPath((Brush '#f48fae'), $head)

# Brow: M26.6 16.8 L32 22.6 L37.4 16.8 C34 16 30 16 26.6 16.8
$brow = New-Object System.Drawing.Drawing2D.GraphicsPath
$brow.AddLines([System.Drawing.PointF[]]@((Pt 26.6 16.8), (Pt 32 22.6), (Pt 37.4 16.8)))
$brow.AddBezier((Pt 37.4 16.8), (Pt 34 16), (Pt 30 16), (Pt 26.6 16.8))
$brow.CloseFigure()
$g.FillPath((Brush '#e2769a'), $brow)

# Cheeks and snout: M5 34 L14 32.6 C19 38.6 25 41.4 32 42.6 C39 41.4 45 38.6 50 32.6 L59 34 L50 37.6 L45 45 L32 54 L19 45 L14 37.6 Z
$face = New-Object System.Drawing.Drawing2D.GraphicsPath
$face.AddLine((Pt 5 34), (Pt 14 32.6))
$face.AddBezier((Pt 14 32.6), (Pt 19 38.6), (Pt 25 41.4), (Pt 32 42.6))
$face.AddBezier((Pt 32 42.6), (Pt 39 41.4), (Pt 45 38.6), (Pt 50 32.6))
$face.AddLines([System.Drawing.PointF[]]@((Pt 50 32.6), (Pt 59 34), (Pt 50 37.6), (Pt 45 45), (Pt 32 54), (Pt 19 45), (Pt 14 37.6)))
$face.CloseFigure()
$g.FillPath((Brush '#fff4f7'), $face)

# Nose: M29.4 49.4 C29.4 47.8 34.6 47.8 34.6 49.4 C34.6 51 33 52.4 32 52.4 C31 52.4 29.4 51 29.4 49.4 Z
$nose = New-Object System.Drawing.Drawing2D.GraphicsPath
$nose.AddBezier((Pt 29.4 49.4), (Pt 29.4 47.8), (Pt 34.6 47.8), (Pt 34.6 49.4))
$nose.AddBezier((Pt 34.6 49.4), (Pt 34.6 51), (Pt 33 52.4), (Pt 32 52.4))
$nose.AddBezier((Pt 32 52.4), (Pt 31 52.4), (Pt 29.4 51), (Pt 29.4 49.4))
$nose.CloseFigure()
$g.FillPath((Brush '#3b1530'), $nose)

# Eyes and sparkles
function Oval($hex, $cx, $cy, $rx, $ry) { $g.FillEllipse((Brush $hex), [float](($cx - $rx) * $k), [float](($cy - $ry) * $k), [float](2 * $rx * $k), [float](2 * $ry * $k)) }
Oval '#3b1530' 23.6 30.6 3.3 3.8
Oval '#3b1530' 40.4 30.6 3.3 3.8
Oval '#ffffff' 24.8 29.2 1.25 1.25
Oval '#ffffff' 41.6 29.2 1.25 1.25
Oval '#ffffff' 22.7 32.2 0.55 0.55
Oval '#ffffff' 39.5 32.2 0.55 0.55

# Small bloom by the ear
foreach ($c in @(@(20.6, 20.4), @(23.8, 22), @(23.2, 25.6), @(19.4, 25.8), @(18, 22.4))) { Oval '#ffffff' $c[0] $c[1] 2.3 2.3 }
Oval '#f2c94c' 20.9 23.3 1.5 1.5

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "Wrote $out"
