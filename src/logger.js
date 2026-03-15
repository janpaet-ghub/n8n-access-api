//Version: 2026-02-27 12:38
/**
 * src/logger.js
 * Minimal structured logger (no dependencies).
 *
 * Features:
 * - LOG_LEVEL control (default: "info"): error | warn | info | debug
 * - JSON logs by default (good for services)
 * - child(context) to carry request-scoped metadata (e.g. requestId)
 * - safe error serialization (name/message/stack)
 *
 * Env:
 * - LOG_LEVEL=error|warn|info|debug
 * - LOG_FORMAT=json|pretty (default: json)
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function normalizeLevel(level) {
  const l = String(level || "info").toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(LEVELS, l) ? l : "info";
}

function normalizeFormat(fmt) {
  const f = String(fmt || "json").toLowerCase().trim();
  return f === "pretty" ? "pretty" : "json";
}

function safeError(err) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  // Sometimes libraries throw strings/objects
  return { message: String(err) };
}

function nowIso() {
  return new Date().toISOString();
}

function createLogger(baseContext = {}) {
  const minLevel = normalizeLevel(process.env.LOG_LEVEL);
  const format = normalizeFormat(process.env.LOG_FORMAT);

  function shouldLog(level) {
    return LEVELS[level] <= LEVELS[minLevel];
  }

  function emit(level, msg, fields) {
    if (!shouldLog(level)) return;

    const payload = {
      ts: nowIso(),
      level,
      msg: String(msg || ""),
      ...baseContext,
      ...(fields || {}),
    };

    if (format === "pretty") {
      // Human-readable, stable order for essentials
      const { ts, level, msg, ...rest } = payload;
      const tail = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
      const line = `${ts} ${level.toUpperCase()} ${msg}${tail}`;
      // eslint-disable-next-line no-console
      (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
      return;
    }

    // Default: JSON (one line)
    const line = JSON.stringify(payload);
    // eslint-disable-next-line no-console
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  }

  return {
    child(extraContext = {}) {
      return createLogger({ ...baseContext, ...extraContext });
    },

    error(fields, msg, err) {
      // allow signature: error(err, msg) too
      if (fields instanceof Error || typeof fields === "string") {
        const e = fields instanceof Error ? fields : undefined;
        const m = fields instanceof Error ? (msg || fields.message) : fields;
        return emit("error", m, { ...baseContext, err: safeError(e) });
      }
      return emit("error", msg, { ...fields, err: safeError(err) });
    },

    warn(fields, msg) {
      if (typeof fields === "string") return emit("warn", fields, {});
      return emit("warn", msg, fields);
    },

    info(fields, msg) {
      if (typeof fields === "string") return emit("info", fields, {});
      return emit("info", msg, fields);
    },

    debug(fields, msg) {
      if (typeof fields === "string") return emit("debug", fields, {});
      return emit("debug", msg, fields);
    },
  };
}

module.exports = createLogger({ service: "access-api" });
