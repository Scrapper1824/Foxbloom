# Tests for Test-VendorHashes (VendorHashes.ps1): run by test.ps1 after the C# tests. Exits non-zero on a failure.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $here 'VendorHashes.ps1')

$script:passed = 0; $script:failed = 0
function Check([string]$name, [scriptblock]$body) {
  try { & $body; Write-Output "PASS  $name"; $script:passed++ }
  catch { Write-Output "FAIL  $name`n      $($_.Exception.Message)"; $script:failed++ }
}
function Throws([scriptblock]$body, [string]$contains) {
  try { & $body } catch { if ($_.Exception.Message -notlike "*$contains*") { throw "message <$($_.Exception.Message)> lacks <$contains>" }; return }
  throw "expected an error containing <$contains>"
}

$dir = Join-Path ([IO.Path]::GetTempPath()) ('foxbloom-vendor-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $dir | Out-Null
try {
  [IO.File]::WriteAllText((Join-Path $dir 'sdb.exe'), 'pretend sdb')
  [IO.File]::WriteAllText((Join-Path $dir 'ca.cer'), 'pretend ca')
  $sdbHash = (Get-FileHash (Join-Path $dir 'sdb.exe') -Algorithm SHA256).Hash.ToLower()
  $caHash = (Get-FileHash (Join-Path $dir 'ca.cer') -Algorithm SHA256).Hash.ToLower()
  $list = Join-Path $dir 'vendor.sha256'

  Check 'matching hashes pass (comments, blank lines and upper-case hex are fine)' {
    [IO.File]::WriteAllText($list, "# header`n`n$($sdbHash.ToUpper())  sdb.exe`n$caHash  ca.cer`n")
    Test-VendorHashes -Dir $dir -Files @('sdb.exe', 'ca.cer') -HashFile $list
  }
  Check 'a file with no entry fails and names the file' {
    [IO.File]::WriteAllText($list, "# header only`n$sdbHash  sdb.exe`n")
    Throws { Test-VendorHashes -Dir $dir -Files @('sdb.exe', 'ca.cer') -HashFile $list } 'ca.cer has no line in'
  }
  Check 'an empty list (as committed) fails for every file' {
    [IO.File]::WriteAllText($list, "# header only`n")
    Throws { Test-VendorHashes -Dir $dir -Files @('sdb.exe') -HashFile $list } 'sdb.exe has no line in'
  }
  Check 'a different file fails with both hashes' {
    [IO.File]::WriteAllText($list, "$caHash  sdb.exe`n$caHash  ca.cer`n")
    Throws { Test-VendorHashes -Dir $dir -Files @('sdb.exe', 'ca.cer') -HashFile $list } "sdb.exe does not match"
  }
  Check 'a missing list file fails' {
    Throws { Test-VendorHashes -Dir $dir -Files @('sdb.exe') -HashFile (Join-Path $dir 'nope.sha256') } 'not found'
  }
  Check 'a malformed line fails' {
    [IO.File]::WriteAllText($list, "not-a-hash sdb.exe`n")
    Throws { Test-VendorHashes -Dir $dir -Files @('sdb.exe') -HashFile $list } 'line 1'
  }
} finally { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }

Write-Output "`n$script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
