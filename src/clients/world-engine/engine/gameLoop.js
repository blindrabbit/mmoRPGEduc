// =============================================================================
// gameLoop.js — mmoRPGEduc (ATUALIZADO PARA WORKER BRIDGE)
// Gerencia o loop de jogo usando WorkerBridge para background processing
// =============================================================================

import { createWorkerBridge } from "./WorkerBridge.js";
import { worldEvents, EVENT_TYPES } from "../../../core/events.js";

let _bridge = null;
let _initialized = false;
let _visibilityHidden = false;

// Configurações do game loop
export const GAME_CONFIG = {
  tickInterval: 100,
  enableWorker: true,
  fallbackToMain: true,
};

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

/**
 * Inicializa o game loop com WorkerBridge
 * @param {Object} options
 * @returns {Promise<boolean>}
 */
export async function initGameLoop(options = {}) {
  if (_initialized) return true;

  try {
    // Configurar bridge
    _bridge = createWorkerBridge({
      enableWorker: options.enableWorker ?? GAME_CONFIG.enableWorker,
      fallbackToMain: options.fallbackToMain ?? GAME_CONFIG.fallbackToMain,
      workerPath: options.workerPath,
    });

    // Configurar callbacks
    _bridge.onUpdate(_handleEngineUpdate);
    _bridge.onEvent(_handleEngineEvent);
    _bridge.onError(_handleEngineError);
    _bridge.onReady(_handleEngineReady);

    // Detectar visibilidade da tab para otimização
    document.addEventListener("visibilitychange", _handleVisibilityChange);

    // Inicializar bridge (não inicia o loop ainda)
    const result = await _bridge.init(
      {
        tickInterval: options.tickInterval || GAME_CONFIG.tickInterval,
        enableMonsterAI: options.enableMonsterAI ?? true,
        enableFieldSystem: options.enableFieldSystem ?? true,
        enableRegen: options.enableRegen ?? true,
      },
      options.initialState || {},
    );

    _initialized = result.success;
    return _initialized;
  } catch (error) {
    console.error("[GameLoop] Initialization failed:", error);
    worldEvents.emit(EVENT_TYPES.SYSTEM_LOG, {
      message: "GameLoop initialization failed",
      error: error.message,
      level: "error",
    });
    return false;
  }
}

// =============================================================================
// CONTROLE DO LOOP
// =============================================================================

export function startLoop() {
  if (_bridge && _initialized) {
    _bridge.start();
    worldEvents.emit(EVENT_TYPES.SYSTEM_LOG, {
      message: "Game loop started",
      mode: _bridge.getStatus()?.mode,
    });
  }
}

export function stopLoop() {
  if (_bridge) {
    _bridge.stop();
  }
}

export function destroyLoop() {
  if (_bridge) {
    _bridge.destroy();
    _bridge = null;
    _initialized = false;
  }
  document.removeEventListener("visibilitychange", _handleVisibilityChange);
}

// =============================================================================
// API PARA ENVIO DE AÇÕES
// =============================================================================

/**
 * Envia uma ação para processamento pelo engine
 * @param {Object} action
 * @returns {Promise}
 */
export async function sendGameAction(action) {
  if (!_bridge) {
    return { success: false, error: "Game loop not initialized" };
  }
  return await _bridge.sendAction(action);
}

/**
 * Sincroniza entidades com o engine
 * @param {Object} entities
 */
export function syncGameEntities(entities) {
  if (_bridge) {
    _bridge.syncEntities(entities);
  }
}

// =============================================================================
// HANDLERS DE EVENTOS DO ENGINE
// =============================================================================

function _handleEngineReady(info) {
  console.log(`[GameLoop] Engine ready in ${info.mode} mode`);
  worldEvents.emit(EVENT_TYPES.SYSTEM_LOG, {
    message: `Engine initialized (${info.mode})`,
    mode: info.mode,
  });
}

function _handleEngineUpdate(updates) {
  // Atualizar worldStore local com mudanças do engine
  _applyEngineUpdates(updates);

  // Emitir eventos para UI/render
  if (updates.events) {
    for (const event of updates.events) {
      worldEvents.emit(event.type, event.payload);
    }
  }
}

function _handleEngineEvent(event) {
  // Re-emitir eventos do engine para o sistema global
  worldEvents.emit(event.type, {
    ...event.payload,
    source: event.source || "engine",
  });
}

function _handleEngineError(error) {
  console.error("[GameLoop] Engine error:", error);
  worldEvents.emit(EVENT_TYPES.SYSTEM_LOG, {
    message: "Engine error",
    error: error.message || error,
    level: "error",
  });
}

function _handleVisibilityChange() {
  _visibilityHidden = document.hidden;

  // Otimização: reduzir frequência em background
  if (_bridge) {
    if (_visibilityHidden) {
      _bridge.setConfig({ tickInterval: 200 }); // Mais lento em background
    } else {
      _bridge.setConfig({ tickInterval: 100 }); // Normal quando visível
    }
  }
}

// =============================================================================
// APLICAÇÃO DE UPDATES NO WORLDSTORE
// =============================================================================

async function _applyEngineUpdates(updates) {
  // Import dinâmico para evitar circular deps
  const { applyMonstersLocal, applyPlayersLocal } =
    await import("../../../core/worldStore.js");

  // Atualizar monstros
  if (updates.monsters) {
    for (const [id, data] of Object.entries(updates.monsters)) {
      if (data.remove) {
        // Remover do store local
        // (implementar função de remoção se necessário)
      } else {
        applyMonstersLocal(id, data);
      }
    }
  }

  // Atualizar jogadores
  if (updates.players) {
    for (const [id, data] of Object.entries(updates.players)) {
      if (data.remove) {
        // Remover
      } else {
        applyPlayersLocal(id, data);
      }
    }
  }

  // Atualizar campos
  if (updates.fields) {
    // Implementar sync de campos se necessário
  }
}

// =============================================================================
// UTILITÁRIOS
// =============================================================================

export function getLoopStatus() {
  return {
    initialized: _initialized,
    bridge: _bridge?.getStatus?.() || null,
    visibilityHidden: _visibilityHidden,
  };
}

export function isLoopRunning() {
  return _initialized && _bridge?.getStatus?.()?.running;
}
