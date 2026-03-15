$url = "http://127.0.0.1:3000/debug/ip"
$response = Invoke-WebRequest -Uri $url
$response.Content
  