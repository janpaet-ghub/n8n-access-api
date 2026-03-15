#Version: 2026-02-20 12:35
$body = @{
    comment = "lina commented the request of customer 40831."
} | ConvertTo-Json

Invoke-RestMethod `
  -Method PATCH `
  -Uri "http://127.0.0.1:3000/auftrag-details/40831/1/comment" `
  -Headers @{ "X-API-Key" = "lina-test-key-2026" } `
  -ContentType "application/json" `
  -Body $body
