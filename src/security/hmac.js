//Version: 2026-02-26 21:05
/**
 * Description:
 * src/security/hmac.js
 *
 * Option B (recommended):
 * Canonical String (PowerShell-compatible):
 *   METHOD \n PATH \n TIMESTAMP \n NONCE \n SHA256_HEX( rawBodyBytes )
 *
 * Signature:
 *   HMAC-SHA256(secret, canonical) -> Base64
 */
const crypto = require("crypto");

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function computeSignature({ method, path, timestamp, nonce, bodyBytes, secret }) {
  const bodyHashHex = sha256Hex(bodyBytes || Buffer.from("", "utf8"));

  const canonical = `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`;

  // PowerShell-compatible: Base64
  return crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("base64");
}

/**
 * Verifiziert die Security-Header (API key, timestamp window, nonce replay, signature)
 *
 * @param {object} req - Express request
 * @param {object} opts
 * @param {string} opts.apiKeyExpected
 * @param {string} opts.hmacSecret
 * @param {number} opts.maxSkewSec
 * @param {NonceCache} opts.nonceCache - Object mit isReplay(nonce)
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function verifyRequest(req, { apiKeyExpected, hmacSecret, maxSkewSec, nonceCache }) {
  const apiKey = req.header("X-API-Key");
  const timestamp = req.header("X-Timestamp");
  const nonce = req.header("X-Nonce");
  const signature = req.header("X-Signature");

  if (!apiKey || !timestamp || !nonce || !signature) {
    return { ok: false, message: "Missing authentication headers" };
  }

  if (!apiKeyExpected || !hmacSecret) {
    return { ok: false, message: "Server misconfigured env secrets" };
  }

  if (apiKey !== apiKeyExpected) {
    return { ok: false, message: "Invalid API key" };
  }

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, message: "Invalid timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxSkewSec) {
    return { ok: false, message: "Timestamp outside allowed window" };
  }

  if (nonceCache?.isReplay(nonce)) {
    return { ok: false, message: "Replay detected" };
  }

  // === Critical for Option B: sign RAW body bytes ===
  // This must be set by express.json({ verify: ... }) in server.cleaned.js
  const bodyBytes = req.rawBody ?? Buffer.from("", "utf8");

  // Path must match what PowerShell signs. Use originalUrl to include full path (+ query if present)
  const method = req.method || "";
  const path = req.originalUrl || req.url;

  const expectedSignature = computeSignature({
    method,
    path,
    timestamp,
    nonce,
    bodyBytes,
    secret: hmacSecret,
  });

  // timing-safe compare (string buffers; both are base64 strings)
  const sigA = Buffer.from(expectedSignature, "utf8");
  const sigB = Buffer.from(signature, "utf8");
  if (sigA.length !== sigB.length) {
    return { ok: false, message: "Invalid signature" };
  }

  const ok = crypto.timingSafeEqual(sigA, sigB);
  if (!ok) {
    return { ok: false, message: "Invalid signature" };
  }

  return { ok: true };
}

module.exports = { verifyRequest, computeSignature };