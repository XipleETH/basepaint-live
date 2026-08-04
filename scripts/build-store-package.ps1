$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageDirectory = Join-Path $projectRoot "store\package"
$zipPath = Join-Path $packageDirectory "basepaint-live-rooms-v0.5.0.zip"

$runtimeFiles = @(
  "manifest.json",
  "extension/config.js",
  "extension/content.css",
  "extension/content.js",
  "extension/livekit-content.bundle.js",
  "extension/page-bridge.bundle.js",
  "extension/viewer.bundle.js",
  "extension/viewer.css",
  "extension/viewer.html",
  "extension/THIRD_PARTY_NOTICES.txt",
  "extension/icons/icon16.png",
  "extension/icons/icon32.png",
  "extension/icons/icon48.png",
  "extension/icons/icon128.png"
)

foreach ($relativePath in $runtimeFiles) {
  $absolutePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $absolutePath)) {
    throw "Missing store package file: $relativePath"
  }
}

New-Item -ItemType Directory -Force -Path $packageDirectory | Out-Null
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relativePath in $runtimeFiles) {
    $absolutePath = Join-Path $projectRoot $relativePath
    $entryName = $relativePath.Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $absolutePath,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
}
finally {
  $archive.Dispose()
}

$manifestEntry = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if (-not $manifestEntry.GetEntry("manifest.json")) {
    throw "The generated ZIP does not contain manifest.json at its root."
  }
}
finally {
  $manifestEntry.Dispose()
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath
[PSCustomObject]@{
  Package = $zipPath
  Size = (Get-Item -LiteralPath $zipPath).Length
  SHA256 = $hash.Hash
  Files = $runtimeFiles.Count
}
