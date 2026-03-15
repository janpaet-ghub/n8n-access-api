//Version: 2026-02-27 13:50
// =============================
// server.cleaned.js
// =============================

const express = require("express");
const NonceCache = require("./security/nonce-cache");
const { verifyRequest } = require('./security/hmac');
const { updateOrderComment } = require("./db/access");

const app = express();

//==============================
// Raw body capture (muss VOR den Routen passieren)
//==============================

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // Buffer mit originalen Bytes (UTF-8)
  }
}));

// =============================
// ENV
// =============================

const API_KEY = process.env.LINA_API_KEY;
const HMAC_SECRET = process.env.LINA_HMAC_SECRET;
const SIGNATURE_MAX_SKEW_SEC = parseInt(process.env.SIGNATURE_MAX_SKEW_SEC || "300", 10);

// =============================
// Simple Nonce Cache (in-memory)
// =============================

const nonceCache = new NonceCache ({
  ttlMs: 10* 60 * 1000,               // 10 Minuten
  maxSize: 50_000
});

// =============================
// Route(s)
// =============================

app.patch("/auftrag/:kdNr/:auftragsID/comment", async (req, res) => {
  const verification = verifyRequest(req, {
    apiKeyExpected: API_KEY,
    hmacSecret: HMAC_SECRET,
    maxSkewSec: SIGNATURE_MAX_SKEW_SEC,
    nonceCache,
  });

  if (!verification.ok) {
    return res.status(401).json({ error: verification.message });
  }

  const { kdNr, auftragsID } = req.params;

  if (typeof kdNr !== "string" || kdNr.trim().length === 0) {
    return res.status(400).json({ error:"Missing or invalid 'kdNr (string) in path" });
  }
  
  const auftragsIdNum = Number(auftragsID);

  if (!Number.isFinite(auftragsIdNum)) {
    return res.status(400).json({ error: "auftragsID must be numeric" });
  }

  const { comment } = req.body || {};

  if (typeof comment !== "string" || comment.trim().length === 0) {
    return res.status(400).json({ error: "Missing or invalid 'comment (string) in JSON body" });
  }

  try {
    await updateOrderComment({ kdNr, auftragsID, comment });

    return res.json({
      ok: true,
      kdNr,
      auftragsID,
      updated: true,
    });
  } catch (err) {
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
  console.log(`Access API (cleaned) running on port ${PORT}`);
});