#Version: 2026-02-26 23:14
<#
Test-Client für Lina Access API (PATCH comment) inkl. HMAC-Signatur (Timestamp + Nonce).

Erwartete ENV Variablen:
  - LINA_API_KEY
  - LINA_HMAC_SECRET

Optional:
  - LINA_API_BASE_URL  (Default: http://127.0.0.1:3000)
#>

$ErrorActionPreference = "Stop"

# --- Konfiguration ---
$baseUrl = if ($env:LINA_API_BASE_URL) { $env:LINA_API_BASE_URL } else { "http://127.0.0.1:3000" }
$kdNr = "40831"
$auftragsID = 1
$commentText = "lina commented something."

$apiKey = $env:LINA_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "Missing ENV LINA_API_KEY"
}

$hmacSecret = $env:LINA_HMAC_SECRET
if ([string]::IsNullOrWhiteSpace($hmacSecret)) {
  throw "Missing ENV LINA_HMAC_SECRET"
}

# --- Payload (raw JSON string, stabil für Signatur) ---
$bodyObj = @{ comment = $commentText }
$bodyJson = $bodyObj | ConvertTo-Json -Compress
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

# --- Hash(body) = SHA256 hex (lowercase) ---
$sha = [System.Security.Cryptography.SHA256]::Create()
$bodyHashBytes = $sha.ComputeHash($bodyBytes)
$bodyHashHex = -join ($bodyHashBytes | ForEach-Object { $_.ToString("x2") })

# --- Canonical String wie in server.js ---
$method = "PATCH"
$path = "/auftrag/$kdNr/$auftragsID/comment"  # ohne Host, ohne Query
$timestamp = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$nonce = [guid]::NewGuid().ToString()

$canonical = "$method`n$path`n$timestamp`n$nonce`n$bodyHashHex"
$canonicalBytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)

# --- HMAC-SHA256 Base64 ---
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($hmacSecret)
$sigBytes = $hmac.ComputeHash($canonicalBytes)
$signatureB64 = [Convert]::ToBase64String($sigBytes)

# --- HTTP Request ---
$uri = "$baseUrl$path"
$headers = @{
  "X-API-Key"    = $apiKey
  "X-Timestamp"  = "$timestamp"
  "X-Nonce"      = $nonce
  "X-Signature"  = $signatureB64
}

Write-Host "PATCH $uri"
Write-Host "X-Timestamp: $timestamp"
Write-Host "X-Nonce: $nonce"
Write-Host "Body: $bodyJson"

$response = Invoke-RestMethod `
  -Method Patch `
  -Uri $uri `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $bodyJson

$response | ConvertTo-Json -Depth 10
