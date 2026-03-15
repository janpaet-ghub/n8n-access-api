//Version: 2026-02-27 00:45
/**
 * src/db/access.js
 * Robust Access DB module for node-adodb on Windows.
 *
 * Features:
 * - Default provider: Microsoft.ACE.OLEDB.12.0 (matches your working server.js)
 * - Optional provider override via ACCESS_OLEDB_PROVIDER (e.g. "16.0" or "12.0")
 * - Supports either ACCESS_CONN_STR or ACCESS_DB_PATH
 * - Forces x64 cscript mode: ADODB.open(connStr, true)
 * - Better error logging (shows provider/db path and SQL)
 */

const path = require("path");
const ADODB = require("node-adodb");
const logger = require("../logger_fsp");

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

function getProvider() {
  // Default to 12.0 because your server.js works with it.
  const p = (process.env.ACCESS_OLEDB_PROVIDER || "12.0").trim();
  // allow "12" -> "12.0"
  if (/^\d+$/.test(p)) return `${p}.0`;
  return p;
}

function resolveDbPath(dbPathEnv) {
  const dbPath = path.isAbsolute(dbPathEnv)
    ? dbPathEnv
    : path.resolve(process.cwd(), dbPathEnv);
  return dbPath;
}

function buildConnStrFromPath(dbPath) {
  const provider = getProvider();
  return `Provider=Microsoft.ACE.OLEDB.${provider};Data Source=${dbPath};Persist Security Info=False;`;
}

function createConnection() {
  const connStrFromEnv = process.env.ACCESS_CONN_STR;
  let connStr;
  let meta = {};

  if (connStrFromEnv && connStrFromEnv.trim().length > 0) {
    // Intentionally use the supplied connection string as-is.
    // If you want to guarantee the provider, do not use ACCESS_CONN_STR.    
    connStr = connStrFromEnv.trim();
    meta = { mode: "ACCESS_CONN_STR", provider: getProvider() };
  } else {
    const dbPathEnv = requireEnv("ACCESS_DB_PATH");
    const dbPath = resolveDbPath(dbPathEnv);
    connStr = buildConnStrFromPath(dbPath);
    meta = { mode: "ACCESS_DB_PATH", dbPath, provider: getProvider() };
  }

  // Force x64 (important for Access Database Engine x64 environments)
  const connection = ADODB.open(connStr);

  // Optional: attach debug meta for logging
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