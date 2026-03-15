//Version: 2026-03-06 13:12
// =============================
// src/server.js
// =============================

const express = require("express");
const crypto = require("crypto");
const NonceCache = require("./security/nonce-cache");
const { verifyRequest, computeSignature } = require("./security/hmac");
const { updateOrderComment, readCustomerOrders } = require("./db/access_jpa");
//const { updateOrderComment, readCustomerOrders } = require("./db/access_fsp");
const logger = require("./logger");
const { error } = require("console");
//const logger = require("./logger_fsp");

const app = express();

//==============================
// Raw body capture (muss VOR den Routen passieren)
//==============================

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf; // Buffer mit originalen Bytes (UTF-8)
    },
  })
);

// =============================
// Request-scoped logger (requestId)
// =============================
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.log = logger.child({
    requestId,
    method: req.method,
    path: req.path,
  });

  res.setHeader("X-Request-Id", requestId);
  next();
});

// =============================
// ENV
// =============================

const API_KEY = process.env.LINA_API_KEY;
const HMAC_SECRET = process.env.LINA_HMAC_SECRET;
const SIGNATURE_MAX_SKEW_SEC = parseInt(process.env.SIGNATURE_MAX_SKEW_SEC || "300", 10);
const SKEW_SECONDS = Number(process.env.SKEW_SECONDS ?? 300);
const SIGNER_ALLOW_REMOTE = String(process.env.SIGNER_ALLOW_REMOTE || "false").toLowerCase() === "true";

const SIGN_RATE_LIMIT_MAX = Number(process.env.SIGN_RATE_LIMIT_MAX ?? 30);
const SIGN_RATE_LIMIT_WINDOW_MS = Number(process.env.SIGN_RATE_LIMIT_WINDOW_MS ?? 60_000);

const ALLOWED_SIGN_METHODS = new Set(["GET", "PATCH"]);

const SIGN_PATH_RULES = {
  GET: [
    /^\/customers\/[^/]+\/orders$/,
  ],
  PATCH: [
    /^\/customers\/[^/]+\/[^/]+\/comment$/,
  ],
};

const signRateLimit = new Map();

// =============================
// Signer helper functions
// =============================

function isLocalhostRequest(req) {
  const ra = req.socket?.remoteAddress || "";
  return (
    ra === "127.0.0.1" ||
    ra === "::1" ||
    ra === "::ffff:127.0.0.1"
  );
}

function isAllowedSignPath(method, path) {
  const rules = SIGN_PATH_RULES[method] || [];
  return rules.some((re) => re.test(path));
}

function getSignerClientKey(req) {
  return req.socket?.remoteAddress || "unknown";
}

function checkSignRateLimit(key) {
  const now = Date.now();
  const existing = signRateLimit.get(key);

  if (!existing || now > existing.resetAt) {
    const fresh = {
      count: 1,
      resetAt: now + SIGN_RATE_LIMIT_WINDOW_MS,
    };
    signRateLimit.set(key, fresh);
    return {
      allowed: true,
      remaining: SIGN_RATE_LIMIT_MAX - 1,
      resetAt: fresh.resetAt,
    };
  }

  if (existing.count >= SIGN_RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: SIGN_RATE_LIMIT_MAX - existing.count,
    resetAt: existing.resetAt,
  };
}

// =============================
// Signer endpoint for n8n (because n8n Code Node disallows crypto)
// POST /sign
// Body: { method: "GET|PATCH", path: "/customers/123/orders", bodyString?: "..." }
// Returns: { ok: true, headers: { ... }, canonical, bodyHashHex, expiresIn }
// Security: requires X-API-Key; optional remote restriction; method/path whitelist; rate-limit
// =============================

app.post("/sign", (req, res) => {
  const log = req.log || logger;

  if (!SIGNER_ALLOW_REMOTE && !isLocalhostRequest(req)) {
    log.warn({ remoteAddress: req.socket?.remoteAddress }, "Signer blocked non-local request");
    return res.status(403).json({ error: "Signer endpoint is localhost-only" });
  }

  const apiKey = req.header("X-API-Key");
  if (!apiKey || apiKey !== API_KEY) {
    log.warn("Signer unauthorized (missing/invalid API key)");
    return res.status(401).json({ error: "Invalid API key" });
  }

  const clientKey = getSignerClientKey(req);
  const rateLimit = checkSignRateLimit(clientKey);
  if (!rateLimit.allowed) {
    log.warn({ clientKey }, "Signer rate limit exceeded");
    return res.status(429).json({
      error: "Too many signing requests",
      retryAfterMs: Math.max(0, rateLimit.resetAt - Date.now()),
    });
  }

  const { method, path, bodyString } = req.body || {};
  const normalizedMethod = String(method || "").toUpperCase().trim();

  if (!ALLOWED_SIGN_METHODS.has(normalizedMethod)) {
    return res.status(400).json({
      error: "Missing or invalid 'method' (allowed: GET, PATCH)",
    });
  }

  if (typeof path !== "string" || !path.startsWith("/")) {
    return res.status(400).json({
      error: "Missing or invalid 'path' (string, must start with /)",
    });
  }

  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    return res.status(400).json({ error: "Invalid path" });
  }

  if (!isAllowedSignPath(normalizedMethod, path)) {
    return res.status(403).json({ error: "Path not allowed for signing" });
  }

  if (typeof bodyString !== "string") {
    return res.status(400).json({
      error: "Missing or invalid 'bodyString' (must be string)",
    });
  }

  if (normalizedMethod === "GET" && bodyString !== "") {
    return res.status(400).json({
      error: "GET requests must use empty bodyString",
    });
  }

  if (normalizedMethod === "PATCH") {
    try {
      const parsed = JSON.parse(bodyString);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return res.status(400).json({
          error: "PATCH bodyString must be a JSON object",
        });
      }
    } catch (_err) {
      return res.status(400).json({
        error: "PATCH bodyString must be valid JSON",
      });
    }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();

  const bodyBytes = Buffer.from(bodyString, "utf8");
  const bodyHashHex = crypto.createHash("sha256").update(bodyBytes).digest("hex");

  const canonical = `${normalizedMethod}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`;

  const signatureB64 = computeSignature({
    method: normalizedMethod,
    path,
    timestamp,
    nonce,
    bodyBytes,
    secret: HMAC_SECRET,
  });

  return res.json({
    ok: true,
    headers: {
      "X-API-Key": API_KEY,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signatureB64,
      "Content-Type": "application/json",
    },
    canonical,
    bodyHashHex,
    expiresIn: SKEW_SECONDS,
  });
});

// =============================
// Simple Nonce Cache (in-memory)
// =============================

const nonceCache = new NonceCache({
  ttlMs: 10 * 60 * 1000, // 10 Minuten
  maxSize: 50_000,
});

// =============================
// Endpoint: Read customer orders (rows) by kdNr
// =============================

app.get("/customers/:kdNr/orders", async (req, res) => {
  const log = req.log || logger;

  const verification = verifyRequest(req, {
    apiKeyExpected: API_KEY,
    hmacSecret: HMAC_SECRET,
    maxSkewSec: SIGNATURE_MAX_SKEW_SEC,
    nonceCache,
  });

  if (!verification.ok) {
    log.warn({ reason: verification.message }, "Unauthorized request");
    return res.status(401).json({ error: verification.message });
  }

  const { kdNr } = req.params;

  if (typeof kdNr !== "string" || kdNr.trim().length === 0) {
    log.warn("Invalid kdNr in path");
    return res.status(400).json({ error: "Missing or invalid 'kdNr (string) in path" });
  }

  try {
    const rows = await readCustomerOrders({ kdNr, log });

    log.info({ kdNr, rowCount: Array.isArray(rows) ? rows.length : 0 }, "Customer orders read");

    return res.json({
      ok: true,
      kdNr,
      rows,
    });
  } catch (err) {
    log.error({ kdNr }, "DB read failed", err);
    return res.status(500).json({
      error: "DB read failed",
      details: String(err?.message || err),
    });
  }
});

// =============================
// Endpoint: Write to database
// =============================

app.patch("/customers/:kdNr/:auftragsID/comment", async (req, res) => {
  const log = req.log || logger;

  const verification = verifyRequest(req, {
    apiKeyExpected: API_KEY,
    hmacSecret: HMAC_SECRET,
    maxSkewSec: SIGNATURE_MAX_SKEW_SEC,
    nonceCache,
  });

  if (!verification.ok) {
    log.warn({ reason: verification.message }, "Unauthorized request");
    return res.status(401).json({ error: verification.message });
  }

  const { kdNr, auftragsID } = req.params;

  if (typeof kdNr !== "string" || kdNr.trim().length === 0) {
    log.warn("Invalid kdNr in path");
    return res.status(400).json({ error: "Missing or invalid 'kdNr (string) in path" });
  }

  const auftragsIdNum = Number(auftragsID);

  if (!Number.isFinite(auftragsIdNum)) {
    log.warn({ auftragsID }, "Invalid auftragsID in path");
    return res.status(400).json({ error: "auftragsID must be numeric" });
  }

  const { comment } = req.body || {};

  if (typeof comment !== "string" || comment.trim().length === 0) {
    log.warn("Invalid comment in body");
    return res.status(400).json({ error: "Missing or invalid 'comment (string) in JSON body" });
  }

  try {
    const result = await updateOrderComment({ kdNr, auftragsID, comment, log });

    if (!result?.found) {
      log.warn({ kdNr, auftragsID }, "Order not found");
      return res.status(404).json({
        error: "Order not found for given kdNr and auftragsID",
        kdNr,
        auftragsID,
      });
    }

    log.info({ kdNr, auftragsID }, "Order comment updated");

    return res.json({
      ok: true,
      kdNr,
      auftragsID,
      updated: true,
    });
  } catch (err) {
    log.error({ kdNr, auftragsID }, "DB update failed", err);
    return res.status(500).json({
      error: "DB update failed",
      details: String(err?.message || err),
    });
  }
});

// =============================
// Start Server
// =============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, `Access API (cleaned) running on port ${PORT}`);
});