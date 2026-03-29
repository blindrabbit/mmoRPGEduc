// =============================================================================
// logger.js — Logger com Níveis para mmoRPGGame
// =============================================================================
// Arquitetura:
//   - Níveis: error, warn, info, debug, trace
//   - Prefixo automático: [RPG][LEVEL]
//   - Controle por nível (ex: só mostra debug se LEVELS.debug >= currentLevel)
//   - Suporte a window.RPG_DEBUG para ativar debug no browser
// =============================================================================

// =============================================================================
// NÍVEIS DE LOG
// =============================================================================

export const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

// Nível atual (padrão: info)
let currentLevel = LEVELS.info;

// =============================================================================
// LOGGER
// =============================================================================

export const logger = {
  /**
   * Define nível de log.
   * @param {'error'|'warn'|'info'|'debug'|'trace'} level
   */
  setLevel(level) {
    if (typeof level === "string") {
      currentLevel = LEVELS[level.toLowerCase()] ?? LEVELS.info;
    } else if (typeof level === "number") {
      currentLevel = Math.max(0, Math.min(4, level));
    }
  },

  /**
   * Obtém nível atual.
   * @returns {number}
   */
  getLevel() {
    return currentLevel;
  },

  /**
   * Log de erro (sempre mostra).
   * @param  {...any} args
   */
  error(...args) {
    if (LEVELS.error >= currentLevel) {
      console.error("[RPG][ERROR]", ...args);
    }
  },

  /**
   * Log de aviso.
   * @param  {...any} args
   */
  warn(...args) {
    if (LEVELS.warn >= currentLevel) {
      console.warn("[RPG][WARN]", ...args);
    }
  },

  /**
   * Log de informação.
   * @param  {...any} args
   */
  info(...args) {
    if (LEVELS.info >= currentLevel) {
      console.log("[RPG][INFO]", ...args);
    }
  },

  /**
   * Log de debug (só mostra se nível >= debug).
   * @param  {...any} args
   */
  debug(...args) {
    if (LEVELS.debug >= currentLevel) {
      console.log("[RPG][DEBUG]", ...args);
    }
  },

  /**
   * Log de trace (detalhado, só mostra se nível >= trace).
   * @param  {...any} args
   */
  trace(...args) {
    if (LEVELS.trace >= currentLevel) {
      console.log("[RPG][TRACE]", ...args);
    }
  },

  /**
   * Log com contexto (ex: [RPG][Combat][DEBUG]).
   * @param {string} context - Contexto do log
   * @param {'error'|'warn'|'info'|'debug'|'trace'} level - Nível do log
   * @param  {...any} args
   */
  log(context, level, ...args) {
    const levelNum = LEVELS[level.toLowerCase()] ?? LEVELS.info;
    if (levelNum >= currentLevel) {
      const prefix = `[RPG][${context}][${level.toUpperCase()}]`;
      const logFn =
        console[
          level === "error" ? "error" : level === "warn" ? "warn" : "log"
        ];
      logFn(prefix, ...args);
    }
  },

  /**
   * Grupo de logs (para organizar output).
   * @param {string} label
   * @param {Function} fn - Função que gera logs dentro do grupo
   */
  group(label, fn) {
    console.group(`[RPG] ${label}`);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  },

  /**
   * Tabela de dados (para debug de objetos/arrays).
   * @param {any} data
   */
  table(data) {
    if (LEVELS.debug >= currentLevel) {
      console.table(data);
    }
  },

  /**
   * Performance (mede tempo de execução).
   * @param {string} label
   */
  time(label) {
    if (LEVELS.debug >= currentLevel) {
      console.time(`[RPG][TIME] ${label}`);
    }
  },

  /**
   * Performance (finaliza medição).
   * @param {string} label
   */
  timeEnd(label) {
    if (LEVELS.debug >= currentLevel) {
      console.timeEnd(`[RPG][TIME] ${label}`);
    }
  },
};

// =============================================================================
// AUTO-CONFIGURAÇÃO NO BROWSER
// =============================================================================

// No browser, permite ativar debug via window.RPG_DEBUG
if (typeof window !== "undefined") {
  // Verifica se RPG_DEBUG está ativo
  if (window.RPG_DEBUG === true || window.RPG_DEBUG === "true") {
    logger.setLevel("debug");
    logger.info("Debug mode ativado via window.RPG_DEBUG");
  }

  // Expõe logger globalmente para debug no console
  window.RPGLogger = logger;

  // Permite mudar nível dinamicamente:
  // window.RPGLogger.setLevel('debug')
  // window.RPGLogger.setLevel('warn')
}

// =============================================================================
// EXPORTS
// =============================================================================

export { LEVELS };
export default logger;
