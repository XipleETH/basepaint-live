param(
  [string]$ScreenshotPath = "C:\Users\Xiple\AppData\Local\Temp\codex-clipboard-8ddbf267-6133-4613-b033-0168044be830.png",
  [string]$SecondScreenshotPath = "C:\Users\Xiple\AppData\Local\Temp\codex-clipboard-47ca209b-7b37-44bc-b6f4-f1be8c0d2385.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$iconSourcePath = Join-Path $projectRoot "store\source\icon-transparent.png"
$socialSourcePath = Join-Path $projectRoot "assets\basepaint-live-social.png"
$iconDirectory = Join-Path $projectRoot "extension\icons"
$listingDirectory = Join-Path $projectRoot "store\listing"

New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $listingDirectory | Out-Null

if (-not (Test-Path -LiteralPath $iconSourcePath)) {
  throw "Missing transparent icon source: $iconSourcePath"
}

function Save-Png {
  param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-Icon128 {
  param([string]$SourcePath, [string]$OutputPath)
  $source = [System.Drawing.Bitmap]::FromFile($SourcePath)
  try {
    $bitmap = New-Object System.Drawing.Bitmap 128, 128, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None

        $blueBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#0647d9"))
        $inkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#06101c"))
        try {
          $graphics.FillRectangle($blueBrush, 16, 16, 96, 96)
          $graphics.FillRectangle($inkBrush, 20, 20, 88, 88)
        }
        finally {
          $blueBrush.Dispose()
          $inkBrush.Dispose()
        }

        $destination = New-Object System.Drawing.Rectangle 22, 22, 84, 84
        $sourceCrop = New-Object System.Drawing.Rectangle 249, 118, 900, 900
        $graphics.DrawImage($source, $destination, $sourceCrop, [System.Drawing.GraphicsUnit]::Pixel)
      }
      finally {
        $graphics.Dispose()
      }
      Save-Png -Bitmap $bitmap -Path $OutputPath
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $source.Dispose()
  }
}

function Resize-Icon {
  param([string]$SourcePath, [string]$OutputPath, [int]$Size)
  $source = [System.Drawing.Bitmap]::FromFile($SourcePath)
  try {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
        $graphics.DrawImage($source, (New-Object System.Drawing.Rectangle 0, 0, $Size, $Size))
      }
      finally {
        $graphics.Dispose()
      }
      Save-Png -Bitmap $bitmap -Path $OutputPath
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $source.Dispose()
  }
}

function Resize-Cover {
  param(
    [string]$SourcePath,
    [string]$OutputPath,
    [int]$Width,
    [int]$Height
  )
  $source = [System.Drawing.Bitmap]::FromFile($SourcePath)
  try {
    $sourceRatio = $source.Width / $source.Height
    $targetRatio = $Width / $Height
    if ($sourceRatio -gt $targetRatio) {
      $cropHeight = $source.Height
      $cropWidth = [int][Math]::Round($cropHeight * $targetRatio)
      $cropX = [int][Math]::Floor(($source.Width - $cropWidth) / 2)
      $cropY = 0
    }
    else {
      $cropWidth = $source.Width
      $cropHeight = [int][Math]::Round($cropWidth / $targetRatio)
      $cropX = 0
      $cropY = [int][Math]::Floor(($source.Height - $cropHeight) / 2)
    }

    $bitmap = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $destination = New-Object System.Drawing.Rectangle 0, 0, $Width, $Height
        $sourceCrop = New-Object System.Drawing.Rectangle $cropX, $cropY, $cropWidth, $cropHeight
        $graphics.DrawImage($source, $destination, $sourceCrop, [System.Drawing.GraphicsUnit]::Pixel)
      }
      finally {
        $graphics.Dispose()
      }
      Save-Png -Bitmap $bitmap -Path $OutputPath
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $source.Dispose()
  }
}

$icon128 = Join-Path $iconDirectory "icon128.png"
New-Icon128 -SourcePath $iconSourcePath -OutputPath $icon128
Resize-Icon -SourcePath $icon128 -OutputPath (Join-Path $iconDirectory "icon48.png") -Size 48
Resize-Icon -SourcePath $icon128 -OutputPath (Join-Path $iconDirectory "icon32.png") -Size 32
Resize-Icon -SourcePath $icon128 -OutputPath (Join-Path $iconDirectory "icon16.png") -Size 16
Copy-Item -LiteralPath $icon128 -Destination (Join-Path $listingDirectory "extension-icon-128.png") -Force

if (-not (Test-Path -LiteralPath $socialSourcePath)) {
  throw "Missing landing social image: $socialSourcePath"
}
Resize-Cover -SourcePath $socialSourcePath -OutputPath (Join-Path $listingDirectory "small-promo-440x280.png") -Width 440 -Height 280

if (Test-Path -LiteralPath $ScreenshotPath) {
  Resize-Cover -SourcePath $ScreenshotPath -OutputPath (Join-Path $listingDirectory "screenshot-1-1280x800.png") -Width 1280 -Height 800
}

if (Test-Path -LiteralPath $SecondScreenshotPath) {
  Resize-Cover -SourcePath $SecondScreenshotPath -OutputPath (Join-Path $listingDirectory "screenshot-2-1280x800.png") -Width 1280 -Height 800
}
else {
  Write-Warning "Actual product screenshot not found. Capture a 1280x800 screenshot before submission."
}

Get-ChildItem -LiteralPath $iconDirectory, $listingDirectory -File | Select-Object FullName, Length
