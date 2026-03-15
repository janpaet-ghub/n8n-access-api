#Version: 2026-02-27 14:30
$ErrorActionPreference = "Stop";

# =========================
# Konfiguration
# =========================
$baseUrl = "http://127.0.0.1:3000"
$kdNr = "40831"
$auftragsID = 1
$commentText = "n8n simulated request"

$apiKey = "lina-test-key-2026"
$hmacSecret = "N8N_LINA_HMAC_SECRET"

# =========================
# JSON Body
# 1. Erzeuge aus commentText ein Hashtable-Objekt @{ ... }.
# 2. Erzeuge ein Byte-Array der UTF8 codierten Zeichen von bodyJson.
# =========================
$bodyJson = (@{ comment = $commentText } | ConvertTo-Json -Compress)
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

# =========================
# SHA256(body)
# 1. Erzeuge einen SHA256-Hash aus bodyHashBytes.
# 2. Wandle jedes Element aus bodyHashBytes in ein mind. 2-stellinges hex-Zeichen um und konkateniere diese.
# =========================
$sha = [System.Security.Cryptography.SHA256]::Create()
$bodyHashBytes = $sha.computeHash($bodyBytes)
$bodyHashHex = -join ($bodyHashBytes | ForEach-Object { $_.ToString("x2") })

# =========================
# Canonical String
# 1. nonce als zufällige 128-Bit Kennung (Format: 8-4-4-4-12 Hex-Zeichen).
# 2. canonical als Konkatenation aus Method, Path, Timestamp nonce und bodyHashHex.
# =========================
$method = "PATCH"
$path = "/auftrag/$kdNr/$auftragsID/comment"
$timestamp = [int][System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$nonce = [guid]::NewGuid().ToString()

$canonical = "$method`n$path`n$timestamp`n$nonce`n$bodyHashHex"

# =========================
# HMAC-SHA256 Base64
# =========================
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($hmacSecret)
$sigBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))
$signatureB64 = [Convert]::ToBase64String($sigBytes)

# =========================
# The request
# =========================
$uri = "$baseUrl$path"

$headers = @{
    "X-API-Key"     = $apiKey
    "X-Timestamp"   = "$timestamp"
    "X-Nonce"       = $nonce
    "X-Signature"   = $signatureB64
}   

Write-Host "Sending simulated n8n request ..."
Write-Host "Canonical:"
Write-Host $canonical
Write-Host ""

# =========================
# Send request to access-api via Invoke-RestMethod
# =========================
$response = Invoke-RestMethod `
-Method Patch `
-Uri $uri `
-Headers $headers `
-ContentType "application/json" `
-Body $bodyJson

$response | ConvertTo-Json -Depth 10