// ═══════════════════════════════════════════════════════════════
// logger.js — Sistema de log com níveis e flag de debug
// ═══════════════════════════════════════════════════════════════
// Para ativar debug no console do browser: window.RPG_DEBUG = true; location.reload();

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const _config = {
  level: typeof window !== "undefined" && window.RPG_DEBUG ? "debug" : "warn",
  prefix: "[RPG]",
};

function _log(level, ...args) {
  if (LEVELS[level] > LEVELS[_config.level]) return;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`${_config.prefix}[${level.toUpperCase()}]`, ...args);
}

export const logger = {
  error: (...a) => _log("error", ...a),
  warn:  (...a) => _log("warn", ...a),
  info:  (...a) => _log("info", ...a),
  debug: (...a) => _log("debug", ...a),
  setLevel: (l) => { _config.level = l; },
};
