param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$SameSignerAs,
  [switch]$TrustTestCertificate
)
$ErrorActionPreference = 'Stop'
$files = @(Get-Item -Path $Path -ErrorAction Stop)
if ($files.Count -ne 1 -or $files[0].PSIsContainer) {
  throw "Expected exactly one executable: $Path"
}
$signature = Get-AuthenticodeSignature -LiteralPath $files[0].FullName
if ($TrustTestCertificate) {
  # Test certificates are trusted only on disposable GitHub-hosted dry-run runners.
  if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Test certificate trust is restricted to GitHub-hosted Actions runners.'
  }
  $certificate = $signature.SignerCertificate
  if (!$certificate -or $certificate.Subject -ne $certificate.Issuer) {
    throw 'Expected the self-signed SignPath test certificate.'
  }
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($certificate)
  } finally { $store.Close() }
  $signature = Get-AuthenticodeSignature -LiteralPath $files[0].FullName
}
if ($signature.Status -ne 'Valid' -or !$signature.SignerCertificate -or !$signature.TimeStamperCertificate) {
  throw "Missing valid, timestamped Authenticode signature: $($files[0].Name) ($($signature.Status))"
}
if ($SameSignerAs) {
  $reference = Get-AuthenticodeSignature -LiteralPath $SameSignerAs
  if ($reference.Status -ne 'Valid' -or $reference.SignerCertificate.Thumbprint -ne $signature.SignerCertificate.Thumbprint) {
    throw 'Installer and application must have the same signing certificate.'
  }
}
Write-Host "Verified $($files[0].Name): $($signature.SignerCertificate.Subject)"
