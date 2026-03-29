// =============================================================================
// CooldownManager.js — Gerenciador Centralizado de Cooldowns
// =============================================================================
// Arquitetura:
//   - Map centralizado: playerId:actionKey → expiresAt
//   - Limpeza automática no tick (evita memory leak)
//   - Suporte a cooldowns globais e específicos
// =============================================================================

export class CooldownManager {
  constructor() {
    /** @private */
    this._cooldowns = new Map(); // playerId:actionKey → expiresAt
    
    /** @private */
    this._globalCooldowns = new Map(); // actionKey → expiresAt (afeta todos)
  }

  // =============================================================================
  // COOLDOWNS INDIVIDUAIS
  // =============================================================================

  /**
   * Verifica se ação está em cooldown para um player.
   * @param {string} playerId
   * @param {string} actionKey - Ex: 'move', 'basicAttack', 'spell_fireball'
   * @param {number} [now=Date.now()]
   * @returns {boolean}
   */
  isOnCooldown(playerId, actionKey, now = Date.now()) {
    const key = `${playerId}:${actionKey}`;
    return (this._cooldowns.get(key) ?? 0) > now;
  }

  /**
   * Define cooldown para um player.
   * @param {string} playerId
   * @param {string} actionKey
   * @param {number} durationMs - Duração em milissegundos
   * @param {number} [now=Date.now()]
   */
  setCooldown(playerId, actionKey, durationMs, now = Date.now()) {
    const key = `${playerId}:${actionKey}`;
    this._cooldowns.set(key, now + durationMs);
  }

  /**
   * Remove cooldown de um player.
   * @param {string} playerId
   * @param {string} actionKey
   */
  clearCooldown(playerId, actionKey) {
    const key = `${playerId}:${actionKey}`;
    this._cooldowns.delete(key);
  }

  /**
   * Obtém tempo restante de cooldown (ms).
   * @param {string} playerId
   * @param {string} actionKey
   * @param {number} [now=Date.now()]
   * @returns {number} Tempo restante (0 se não está em cooldown)
   */
  getRemainingCooldown(playerId, actionKey, now = Date.now()) {
    const key = `${playerId}:${actionKey}`;
    const expiresAt = this._cooldowns.get(key) ?? 0;
    return Math.max(0, expiresAt - now);
  }

  /**
   * Obtém tempo decorrido desde o início do cooldown.
   * @param {string} playerId
   * @param {string} actionKey
   * @param {number} durationMs - Duração original do cooldown
   * @param {number} [now=Date.now()]
   * @returns {number} Tempo decorrido (ms)
   */
  getElapsedCooldown(playerId, actionKey, durationMs, now = Date.now()) {
    const remaining = this.getRemainingCooldown(playerId, actionKey, now);
    return Math.max(0, durationMs - remaining);
  }

  // =============================================================================
  // COOLDOWNS GLOBAIS (afetam todos os players)
  // =============================================================================

  /**
   * Verifica se ação está em cooldown global.
   * @param {string} actionKey
   * @param {number} [now=Date.now()]
   * @returns {boolean}
   */
  isOnGlobalCooldown(actionKey, now = Date.now()) {
    return (this._globalCooldowns.get(actionKey) ?? 0) > now;
  }

  /**
   * Define cooldown global.
   * @param {string} actionKey
   * @param {number} durationMs
   * @param {number} [now=Date.now()]
   */
  setGlobalCooldown(actionKey, durationMs, now = Date.now()) {
    this._globalCooldowns.set(actionKey, now + durationMs);
  }

  /**
   * Remove cooldown global.
   * @param {string} actionKey
   */
  clearGlobalCooldown(actionKey) {
    this._globalCooldowns.delete(actionKey);
  }

  // =============================================================================
  // LIMPEZA E MANUTENÇÃO
  // =============================================================================

  /**
   * Limpa cooldowns expirados de um player.
   * @param {string} playerId
   * @param {number} [now=Date.now()]
   * @returns {number} Quantidade de cooldowns removidos
   */
  tickPlayer(playerId, now = Date.now()) {
    let removed = 0;
    for (const [key, expiresAt] of this._cooldowns.entries()) {
      if (key.startsWith(`${playerId}:`) && expiresAt <= now) {
        this._cooldowns.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Limpa cooldowns expirados de todos os players.
   * @param {number} [now=Date.now()]
   * @returns {{ individual: number, global: number }}
   */
  tick(now = Date.now()) {
    let removedIndividual = 0;
    let removedGlobal = 0;

    // Limpa cooldowns individuais expirados
    for (const [key, expiresAt] of this._cooldowns.entries()) {
      if (expiresAt <= now) {
        this._cooldowns.delete(key);
        removedIndividual++;
      }
    }

    // Limpa cooldowns globais expirados
    for (const [key, expiresAt] of this._globalCooldowns.entries()) {
      if (expiresAt <= now) {
        this._globalCooldowns.delete(key);
        removedGlobal++;
      }
    }

    return {
      individual: removedIndividual,
      global: removedGlobal,
    };
  }

  /**
   * Limpa todos os cooldowns de um player (ex: logout).
   * @param {string} playerId
   * @returns {number} Quantidade de cooldowns removidos
   */
  clearPlayer(playerId) {
    let removed = 0;
    for (const [key] of this._cooldowns.entries()) {
      if (key.startsWith(`${playerId}:`)) {
        this._cooldowns.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Reset completo de todos os cooldowns.
   * @returns {{ individual: number, global: number }}
   */
  reset() {
    const individual = this._cooldowns.size;
    const global = this._globalCooldowns.size;
    this._cooldowns.clear();
    this._globalCooldowns.clear();
    return { individual, global };
  }

  // =============================================================================
  // ESTADO E DEBUG
  // =============================================================================

  /**
   * Obtém estado de cooldowns de um player.
   * @param {string} playerId
   * @param {number} [now=Date.now()]
   * @returns {Object} Mapa de actionKey → remainingMs
   */
  getPlayerState(playerId, now = Date.now()) {
    const state = {};
    for (const [key, expiresAt] of this._cooldowns.entries()) {
      if (key.startsWith(`${playerId}:`)) {
        const actionKey = key.replace(`${playerId}:`, '');
        const remaining = Math.max(0, expiresAt - now);
        if (remaining > 0) {
          state[actionKey] = remaining;
        }
      }
    }
    return state;
  }

  /**
   * Obtém estado de cooldowns globais.
   * @param {number} [now=Date.now()]
   * @returns {Object}
   */
  getGlobalState(now = Date.now()) {
    const state = {};
    for (const [key, expiresAt] of this._globalCooldowns.entries()) {
      const remaining = Math.max(0, expiresAt - now);
      if (remaining > 0) {
        state[key] = remaining;
      }
    }
    return state;
  }

  /**
   * Obtém estatísticas de cooldowns.
   * @returns {{ individual: number, global: number }}
   */
  getStats() {
    return {
      individual: this._cooldowns.size,
      global: this._globalCooldowns.size,
    };
  }
}

// =============================================================================
// INSTÂNCIA GLOBAL (singleton)
// =============================================================================

/** @type {CooldownManager} */
export const cooldownManager = new CooldownManager();

// =============================================================================
// LEGACY COMPATIBILITY (para migração gradual)
// =============================================================================

/**
 * @deprecated Use cooldownManager.isOnCooldown()
 */
export function isOnCooldown(playerId, key) {
  return cooldownManager.isOnCooldown(playerId, key);
}

/**
 * @deprecated Use cooldownManager.setCooldown()
 */
export function setCooldown(playerId, key, ms) {
  cooldownManager.setCooldown(playerId, key, ms);
}
