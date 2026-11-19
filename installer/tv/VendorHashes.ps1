# Test-VendorHashes: checks each vendor file against installer\tv\vendor.sha256 ("<sha256>  <file name>" per line,
# # comments). Throws a plain message on a missing list, a malformed line, a file with no line, or a mismatch.
# Dot-sourced by build.ps1; tested by tests\VendorHashes.Tests.ps1.
function Test-VendorHashes([string]$Dir, [string[]]$Files, [string]$HashFile) {
  if (-not (Test-Path $HashFile)) { throw "The vendor hash list $HashFile was not found." }
  $want = @{}
  $n = 0
  foreach ($line in [IO.File]::ReadAllLines($HashFile)) {
    $n++
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $m = [regex]::Match($t, '^([0-9A-Fa-f]{64})\s+\*?(\S.*)$')
    if (-not $m.Success) { throw "$(Split-Path -Leaf $HashFile) line ${n} is not ""<sha256>  <file name>"": $t" }
    $want[$m.Groups[2].Value.Trim()] = $m.Groups[1].Value.ToLower()
  }
  $problems = @()
  foreach ($f in $Files) {
    if (-not $want.ContainsKey($f)) { $problems += "  - $f has no line in $(Split-Path -Leaf $HashFile)"; continue }
    $have = (Get-FileHash (Join-Path $Dir $f) -Algorithm SHA256).Hash.ToLower()
    if ($have -ne $want[$f]) { $problems += "  - $f does not match: expected $($want[$f]), found $have" }
  }
  if ($problems.Count -gt 0) {
    throw ("Vendor files failed the SHA-256 check against $(Split-Path -Leaf $HashFile):`n" + ($problems -join "`n") +
      "`nCheck you have the right files, then record their hashes in installer\tv\vendor.sha256 (see its header).")
  }
}
