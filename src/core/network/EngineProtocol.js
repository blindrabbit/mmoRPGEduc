// =============================================================================
// EngineProtocol.js — mmoRPGEduc
// Protocolo de mensagens padronizado para comunicação Engine ↔ Ambiente
//
// Usado por:
// • WorkerBridge (client-side)
// • WorldEngineServer (server-side futuro)
// • Qualquer transporte: postMessage, WebSocket, etc.
// =============================================================================

// =============================================================================
// TIPOS DE MENSAGEM
// =============================================================================

export const MESSAGE_TYPE = Object.freeze({
  // Inicialização
  INIT: "engine:init",
  INIT_RESPONSE: "engine:initResponse",

  // Controle
  START: "engine:start",
  STOP: "engine:stop",
  SET_CONFIG: "engine:setConfig",

  // Estado
  SYNC_ENTITIES: "engine:syncEntities",
  STATE_SNAPSHOT: "engine:stateSnapshot",
  STATE_UPDATE: "engine:stateUpdate",

  // Ações
  ACTION: "engine:action",
  ACTION_RESULT: "engine:actionResult",

  // Eventos
  EVENT: "engine:event",

  // Sistema
  HEARTBEAT: "engine:heartbeat",
  ERROR: "engine:error",
});

// =============================================================================
// SERIALIZAÇÃO
// =============================================================================

/**
 * Serializa mensagem para transporte
 * @param {string} type - Tipo da mensagem
 * @param {Object} payload - Dados
 * @param {Object} meta - Metadados opcionais
 * @returns {Object} Mensagem serializada
 */
export function serializeMessage(type, payload, meta = {}) {
  return {
    type,
    payload: payload ?? {},
    meta: {
      timestamp: Date.now(),
      version: "1.0.0",
      ...meta,
    },
  };
}

/**
 * Desserializa mensagem recebida
 * @param {Object|string} raw - Mensagem bruta
 * @returns {Object} Mensagem parseada
 */
export function deserializeMessage(raw) {
  try {
    const msg = typeof raw === "string" ? JSON.parse(raw) : raw;

    // Validação básica — verifica contra os VALORES do enum, não as chaves
    if (!msg.type || !Object.values(MESSAGE_TYPE).includes(msg.type)) {
      console.warn("[EngineProtocol] Unknown message type:", msg.type);
      return null;
    }

    return {
      type: msg.type,
      payload: msg.payload ?? {},
      meta: msg.meta ?? {},
    };
  } catch (error) {
    console.error("[EngineProtocol] Failed to deserialize:", error);
    return null;
  }
}

// =============================================================================
// HELPERS PARA TIPOS COMUNS DE MENSAGEM
// =============================================================================

export const MessageBuilder = {
  init: (config, initialState) =>
    serializeMessage(MESSAGE_TYPE.INIT, { config, initialState }),

  initResponse: (success, error = null) =>
    serializeMessage(MESSAGE_TYPE.INIT_RESPONSE, { success, error }),

  start: () => serializeMessage(MESSAGE_TYPE.START),
  stop: () => serializeMessage(MESSAGE_TYPE.STOP),

  setConfig: (config) => serializeMessage(MESSAGE_TYPE.SET_CONFIG, { config }),

  syncEntities: (entities) =>
    serializeMessage(MESSAGE_TYPE.SYNC_ENTITIES, { entities }),

  stateSnapshot: (snapshot) =>
    serializeMessage(MESSAGE_TYPE.STATE_SNAPSHOT, { snapshot }),

  stateUpdate: (updates) =>
    serializeMessage(MESSAGE_TYPE.STATE_UPDATE, { updates }),

  action: (action) => serializeMessage(MESSAGE_TYPE.ACTION, { action }),

  actionResult: (actionId, result) =>
    serializeMessage(MESSAGE_TYPE.ACTION_RESULT, { actionId, result }),

  event: (eventType, payload) =>
    serializeMessage(MESSAGE_TYPE.EVENT, { eventType, payload }),

  heartbeat: () => serializeMessage(MESSAGE_TYPE.HEARTBEAT),

  error: (message, details = {}) =>
    serializeMessage(MESSAGE_TYPE.ERROR, { message, details }),
};

// =============================================================================
// VALIDAÇÃO DE MENSAGENS
// =============================================================================

export const MessageValidator = {
  isValidAction: (action) => {
    return (
      action &&
      typeof action.type === "string" &&
      ["attack", "spell", "move", "use", "chat"].includes(action.type)
    );
  },

  isValidEntityUpdate: (update) => {
    return update && typeof update === "object";
  },

  isAuthorized: (message, context) => {
    // Placeholder para autenticação/autorização
    // Implementar quando migrar para server-side
    return true;
  },
};

// =============================================================================
// CONSTANTS PARA CONFIGURAÇÃO
// =============================================================================

export const ENGINE_CONFIG_DEFAULTS = Object.freeze({
  tickInterval: 100,
  maxEntitiesPerTick: 50,
  enableMonsterAI: true,
  enableFieldSystem: true,
  enableRegen: true,
  maxActionQueueSize: 100,
  heartbeatInterval: 5000,
});

// =============================================================================
// UTILITÁRIOS PARA DEBUG/LOG
// =============================================================================

export function logMessage(msg, direction = "→") {
  // Compatível com browser, worker e Node.js
  const isProd =
    typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  if (!isProd) {
    const prefix = direction === "→" ? "[SEND]" : "[RECV]";
    console.debug(`${prefix} ${msg.type}`, msg.payload);
  }
}
