//Version: 2026-02-27 12:38
// =============================
// src/server_fsp.js
// =============================

const express = require("express");
const crypto = require("crypto");
const NonceCache = require("./security/nonce-cache");
const { verifyRequest } = require("./security/hmac");
const { updateOrderComment } = require("./db/access_fsp");
const logger = require("./logger_fsp");

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

// =============================
// Simple Nonce Cache (in-memory)
// =============================

const nonceCache = new NonceCache({
  ttlMs: 10 * 60 * 1000, // 10 Minuten
  maxSize: 50_000,
});

// =============================
// Route(s)
// =============================

app.patch("/auftrag/:kdNr/:auftragsID/comment", async (req, res) => {
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
    await updateOrderComment({ kdNr, auftragsID, comment, log });

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
