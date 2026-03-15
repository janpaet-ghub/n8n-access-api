//Version: 2026-02-27 14:45
/**
 * simulate_n8n_request.js
 * macOS-friendly n8n-like request simulator for your Access API.
 *
 * Usage:
 *   export LINA_API_KEY="..."
 *   export LINA_HMAC_SECRET="..."
 *   export LINA_API_BASE_URL="http://127.0.0.1:3000"   # optional
 *
 *   node simulate_n8n_request.js --kdNr 40831 --auftragsID 1 --comment "n8n simulated request"
 *
 * Notes:
 * - Builds the same canonical string as the PowerShell test:
 *     METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(bodyHex)
 * - Uses UTF-8 for body bytes, SHA256 body hash in lowercase hex
 * - Uses HMAC-SHA256 and Base64 for X-Signature
 */

const crypto = require("crypto");
const { URL } = require("url");

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ENV ${name}`);
    process.exit(2);
  }
  return v;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex"); // lowercase hex
}

function hmacSha256Base64(secret, data) {
  return crypto
    .createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(data, "utf8")
    .digest("base64");
}

function jsonStable(obj) {
  // For this payload shape, JSON.stringify is stable and matches ConvertTo-Json -Compress output.
  return JSON.stringify(obj);
}

async function main() {
  const baseUrl = process.env.LINA_API_BASE_URL || "http://192.168.178.32:3000";
  const apiKey = requireEnv("LINA_API_KEY");
  const hmacSecret = requireEnv("LINA_HMAC_SECRET");

  const kdNr = String(getArg("kdNr", "40831"));
  const auftragsID = String(getArg("auftragsID", "1"));
  const comment = String(getArg("comment", `n8n simulated request @ ${new Date().toISOString()}`));

  // Path must match server-side canonicalization: no host, no query
  const path = `/customers/${encodeURIComponent(kdNr)}/${encodeURIComponent(auftragsID)}/comment`;

  // Body must be exactly what we hash and send
  const bodyJson = jsonStable({ comment });
  const bodyBytes = Buffer.from(bodyJson, "utf8");
  const bodyHashHex = sha256Hex(bodyBytes);

  const method = "PATCH";
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`;
  const signatureB64 = hmacSha256Base64(hmacSecret, canonical);

  const url = new URL(baseUrl);
  const uri = new URL(path, url).toString();

  console.log("PATCH", uri);
  console.log("X-Timestamp:", timestamp);
  console.log("X-Nonce:", nonce);
  console.log("Body:", bodyJson);
  console.log("BodyHash(SHA256 hex):", bodyHashHex);
  console.log("Canonical (\\n-separated):\n" + canonical);
  console.log("X-Signature (base64):", signatureB64);
  console.log("");

  // Node 18+ has global fetch. If not available, exit with a helpful message.
  if (typeof fetch !== "function") {
    console.error("This script requires Node.js 18+ (global fetch). Please upgrade Node or adapt to use axios.");
    process.exit(3);
  }

  const resp = await fetch(uri, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Timestamp": String(timestamp),
      "X-Nonce": nonce,
      "X-Signature": signatureB64,
    },
    body: bodyJson,
  });

  const text = await resp.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  console.log("HTTP", resp.status, resp.statusText);
  console.log(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));

  process.exit(resp.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err?.stack || String(err));
  process.exit(1);
});
