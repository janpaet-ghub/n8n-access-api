//Version: 2026-03-01 11:12
/**
 * simulate_n8n_request_read.js
 * macOS-friendly n8n-like READ request simulator for your Access API.
 *
 * Endpoint:
 *   GET /auftrag/:kdNr/comment
 *
 * Usage:
 *   export LINA_API_KEY="..."
 *   export LINA_HMAC_SECRET="..."
 *   export LINA_API_BASE_URL="http://127.0.0.1:3000"   # optional
 *
 *   node simulate_n8n_request_read.js --kdNr 40831
 *
 * Canonical String Format:
 *   METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(bodyHex)
 *
 * Notes:
 * - GET has NO body → SHA256("") must be used
 * - UTF-8 encoding
 * - HMAC-SHA256 → Base64 for X-Signature
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
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function hmacSha256Base64(secret, data) {
  return crypto
    .createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(data, "utf8")
    .digest("base64");
}

async function main() {
  const baseUrl = process.env.LINA_API_BASE_URL || "http://127.0.0.1:3000";
  //const baseUrl = process.env.LINA_API_BASE_URL;
  const apiKey = requireEnv("LINA_API_KEY");
  const hmacSecret = requireEnv("LINA_HMAC_SECRET");

  const kdNr = String(getArg("kdNr", "40831"));

  const path = `/customers/${encodeURIComponent(kdNr)}/orders`;

  const method = "GET";
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  // GET → empty body
  const bodyBytes = Buffer.from("", "utf8");
  const bodyHashHex = sha256Hex(bodyBytes);

  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`;
  const signatureB64 = hmacSha256Base64(hmacSecret, canonical);

  const url = new URL(baseUrl);
  const uri = new URL(path, url).toString();

  console.log("GET", uri);
  console.log("X-Timestamp:", timestamp);
  console.log("X-Nonce:", nonce);
  console.log("BodyHash(SHA256 hex):", bodyHashHex);
  console.log("Canonical (\n-separated):\n" + canonical);
  console.log("X-Signature (base64):", signatureB64);
  console.log("");

  if (typeof fetch !== "function") {
    console.error("This script requires Node.js 18+ (global fetch).");
    process.exit(3);
  }

  const resp = await fetch(uri, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      "X-Timestamp": String(timestamp),
      "X-Nonce": nonce,
      "X-Signature": signatureB64,
    },
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
