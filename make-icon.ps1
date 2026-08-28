Add-Type -AssemblyName System.Drawing

$out = 'C:\Users\FreebuffController-src-placeholder\app.ico'
if ($args.Count -ge 1) { $out = $args[0] }

$sizes = 16, 24, 32, 48
$pngs = @()

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $r = [Math]::Max(2, [int]($s * 0.24))
  $d = $r * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($s - $d - 1, 0, $d, $d, 270, 90)
  $path.AddArc($s - $d - 1, $s - $d - 1, $d, $d, 0, 90)
  $path.AddArc(0, $s - $d - 1, $d, $d, 90, 90)
  $path.CloseFigure()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, `
    [System.Drawing.Color]::FromArgb(96, 149, 255), `
    [System.Drawing.Color]::FromArgb(37, 99, 235), 90)
  $g.FillPath($brush, $path)

  $fontSize = [int]($s * 0.62)
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, `
    [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $box = New-Object System.Drawing.RectangleF(0, (-$s * 0.03), $s, $s)
  $g.DrawString('F', $font, [System.Drawing.Brushes]::White, $box, $sf)

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,@($s, $ms.ToArray())

  $g.Dispose(); $bmp.Dispose(); $path.Dispose(); $brush.Dispose()
}

$msOut = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($msOut)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$pngs.Count)

$offset = 6 + 16 * $pngs.Count
foreach ($e in $pngs) {
  $s = $e[0]
  $byte = if ($s -ge 256) { 0 } else { [byte]$s }
  $bw.Write([byte]$byte)
  $bw.Write([byte]$byte)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$e[1].Length)
  $bw.Write([uint32]$offset)
  $offset += $e[1].Length
}
foreach ($e in $pngs) { $bw.Write($e[1]) }
$bw.Flush()

[System.IO.File]::WriteAllBytes($out, $msOut.ToArray())
Write-Output ("WROTE {0} ({1} bytes)" -f $out, (Get-Item $out).Length)
