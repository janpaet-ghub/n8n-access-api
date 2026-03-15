//Version: 2026-02-27 12:38
/**
 * src/db/access_fsp.js
 * Minimal, fixed Access DB module for node-adodb on Windows (x64).
 *
 * Goal:
 * - Use a stable, pre-validated configuration (no provider/bitness fallback logic)
 * - Ensure the 64-bit ACE/Provider registration is actually used
 *
 * System assumption (validated separately via probe-adodb.ps1):
 * - Microsoft.ACE.OLEDB.16.0 works on the target machine (Windows 11 + Access Database Engine)
 * - 64-bit cscript works, 32-bit (SysWOW64) fails
 *
 * Therefore:
 * - Force x64 mode: ADODB.open(connStr, true)
 * - Use a fixed provider when building the connection string: Microsoft.ACE.OLEDB.16.0
 *
 * Env:
 * - ACCESS_CONN_STR (optional): Full connection string (used as-is)
 * - ACCESS_DB_PATH (required if ACCESS_CONN_STR is not set): Path to .accdb/.mdb
 */

const path = require("path");
const ADODB = require("node-adodb");
const logger = require("../logger_fsp");

// ADODB.debug = true;

// Fixed, pre-validated provider for the target system.
const OLEDB_PROVIDER = "Microsoft.ACE.OLEDB.16.0";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Escape JS string for Access SQL single-quoted literals.
 * Access uses '' inside strings to represent one '.
 */
function escapeAccessString(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function resolveDbPath(dbPathEnv) {
  return path.isAbsolute(dbPathEnv)
    ? dbPathEnv
    : path.resolve(process.cwd(), dbPathEnv);
}

function buildConnStrFromPath(dbPath) {
  return `Provider=${OLEDB_PROVIDER};Data Source=${dbPath};Persist Security Info=False;`;
}

function createConnection() {
  const connStrFromEnv = process.env.ACCESS_CONN_STR;
  let connStr;
  let meta;

  if (connStrFromEnv && connStrFromEnv.trim().length > 0) {
    // Intentionally use the supplied connection string as-is.
    // If you want to guarantee the provider, do not use ACCESS_CONN_STR.
    connStr = connStrFromEnv.trim();
    meta = { mode: "ACCESS_CONN_STR" };
  } else {
    const dbPathEnv = requireEnv("ACCESS_DB_PATH");
    const dbPath = resolveDbPath(dbPathEnv);
    connStr = buildConnStrFromPath(dbPath);
    meta = { mode: "ACCESS_DB_PATH", dbPath, provider: OLEDB_PROVIDER };
  }

  // IMPORTANT: Force x64 cscript (SysWOW64 32-bit mode is known to fail on the target machine)
  const connection = ADODB.open(connStr, true);

  // Attach a tiny bit of context for error logs (no secrets).
  connection.__meta = meta;
  return connection;
}

const connection = createConnection();

/**
 * Logs DB errors with useful context. Keeps secrets out of logs.
 */
function logDbError(err, { sql, action, log }) {
  const meta = connection.__meta || {};
  const useLog = log || logger;

  useLog.error(
    {
      action,
      mode: meta.mode,
      provider: meta.provider,
      dbPath: meta.dbPath,
      sql,
    },
    "DB operation failed",
    err
  );
}

/**
 * Update comment in tblAuftrag.voice_agent_comment
 * WHERE KdNr (Short Text) AND AuftragsID (Number)
 */
async function updateOrderComment({ kdNr, auftragsID, comment, log }) {
  const kdNrText = String(kdNr ?? "").trim(); // KdNr is "Kurzer Text"
  if (!kdNrText) throw new Error("kdNr must be a non-empty string");

  const auftragsIdNum = Number(auftragsID); // AuftragsID assumed numeric
  if (!Number.isFinite(auftragsIdNum)) throw new Error("auftragsID must be numeric");

  if (typeof comment !== "string") throw new Error("comment must be a string");

  const kdNrEsc = escapeAccessString(kdNrText);
  const commentEsc = escapeAccessString(comment);

  // Use [] around field names (safe for Access reserved words/special chars)
  const sql = `
UPDATE tblAuftrag
SET [voice_agent_comment] = '${commentEsc}'
WHERE [KdNr] = '${kdNrEsc}'
  AND [AuftragsID] = ${auftragsIdNum};
`.trim();

  try {
    return await connection.execute(sql);
  } catch (err) {
    logDbError(err, { sql, action: "updateOrderComment", log });
    throw err;
  }
}

module.exports = { updateOrderComment };
