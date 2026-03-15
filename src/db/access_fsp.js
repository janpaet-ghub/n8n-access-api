//Version: 2026-03-06 15:50
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
//const OLEDB_PROVIDER = "Microsoft.ACE.OLEDB.16.0";

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
  const p = (process.env.ACCESS_OLEDB_PROVIDER || "16.0").trim();
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
  const connection = ADODB.open(connStr, true);

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
  const kdNrText = String(kdNr ?? "").trim();
  if (!kdNrText) throw new Error("kdNr must be a non-empty string");

  const auftragsIdNum = Number(auftragsID);
  if (!Number.isFinite(auftragsIdNum)) throw new Error("auftragsID must be numeric");

  if (typeof comment !== "string") throw new Error("comment must be a string");

  const kdNrEsc = escapeAccessString(kdNrText);
  const commentEsc = escapeAccessString(comment);

  // Check if order exists
  const existsSql = `
SELECT COUNT(1) > 0 AS order_found
FROM tblAuftrag
WHERE [KdNr] = '${kdNrEsc}'
AND [AuftragsID] = ${auftragsIdNum};
`.trim();

  try {
    const rows = await connection.query(existsSql);
    const orderFound = Boolean(rows?.[0].order_found);

    if (!orderFound) {
      return {
        found: false, 
        updated: false, 
      };
    }
    
  // Update order comment
  const updateSql = `
UPDATE tblAuftrag
SET [voice_agent_comment] = '${commentEsc}'
WHERE [KdNr] = '${kdNrEsc}'
  AND [AuftragsID] = ${auftragsIdNum};
`.trim();

    await connection.execute(updateSql);

    return {
      found: true,
      updated: true,
    }

  } catch (err) {
    logDbError(err, { sql: existsSql, action: "updateOrderComment", log });
    throw err;
  }
}

/**
 * Read customer orders (as rows) for a given kdNr.
 * WHERE KdNr (Short Text) 
 *
 * @returns {Promise<Array<object>>}
 */
async function readCustomerOrders({ kdNr, log }) {
  const kdNrText = String(kdNr ?? "").trim(); // KdNr is "Kurzer Text"

  if (!kdNrText) {
    throw new Error("kdNr must be a non-empty string");
  }

  const kdNrEsc = escapeAccessString(kdNrText);

  const sql = `
    SELECT *
    FROM qryCustomerOrders
    WHERE [KdNr] = '${kdNrEsc}'
  `.trim();

  try {
    const rows = await connection.query(sql);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    logDbError(err, { sql, action: "readOrderComment", log });
    throw err;
  }
}

module.exports = { updateOrderComment, readCustomerOrders };