// =============================================================================
// events.js — mmoRPGEduc
// Sistema de eventos desacoplado para comunicação núcleo ↔ cliente
//
// Arquitetura:
//   • Núcleo EMITE eventos sobre o que ACONTECEU (source of truth)
//   • Cliente ESCUTA eventos e decide COMO mostrar (UI/UX)
//   • Zero dependências de UI no núcleo
//
// Dependências: NENHUMA
// =============================================================================

/**
 * Tipos de eventos padronizados do jogo
 * @enum {string}
 */
export const EVENT_TYPES = {
  // === COMBATE ===
  COMBAT_DAMAGE: "combat:damage",
  COMBAT_MISS: "combat:miss",
  COMBAT_CRITICAL: "combat:critical",
  COMBAT_KILL: "combat:kill",

  // === MAGIAS ===
  SPELL_CAST: "spell:cast",
  SPELL_EFFECT: "spell:effect",
  FIELD_CREATED: "field:created",
  FIELD_TICK: "field:tick",
  FIELD_REMOVED: "field:removed",

  // === MOVIMENTO ===
  PLAYER_MOVE: "player:move",
  MONSTER_MOVE: "monster:move",
  MAP_TRANSITION: "map:transition",

  // === PROGRESSÃO ===
  PROGRESSION_XP_GAIN: "progression:xpGain",
  PROGRESSION_LEVEL_UP: "progression:levelUp",
  PROGRESSION_STAT_ALLOCATED: "progression:statAllocated",
  PROGRESSION_STATS_RECALCULATED: "progression:statsRecalculated",

  // === ENTIDADES ===
  ENTITY_SPAWN: "entity:spawn",
  ENTITY_DESPAWN: "entity:despawn",
  ENTITY_UPDATE: "entity:update",

  // === ITENS E INVENTÁRIO ===
  ITEM_PICKED_UP: "item:pickedUp", // Jogador pegou item do chão
  ITEM_DROPPED: "item:dropped", // Jogador soltou item no chão
  ITEM_EQUIPPED: "item:equipped", // Jogador equipou item
  ITEM_UNEQUIPPED: "item:unequipped", // Jogador desequipou item
  ITEM_MOVED: "item:moved", // Item movido entre slots de inventário
  ITEM_USED: "item:used", // Item consumível usado
  INVENTORY_UPDATED: "inventory:updated", // Inventário do jogador atualizado

  // === DRAG & DROP UI ===
  ITEM_DRAG_START: "item:dragStart", // Iniciou drag de item (UI)
  ITEM_DRAG_END: "item:dragEnd", // Terminou drag de item (UI)
  ITEM_DROP_VALID: "item:dropValid", // Drop zone válida (feedback visual)
  ITEM_DROP_INVALID: "item:dropInvalid", // Drop zone inválida (feedback visual)
  ITEM_DROP_PREVIEW: "item:dropPreview", // Preview da melhor zona durante drag

  // === SISTEMA ===
  WORLD_STATE_CHANGE: "world:stateChange",
  CHAT_MESSAGE: "chat:message",
  SYSTEM_LOG: "system:log",
};

/**
 * Payload base para todos os eventos
 * @typedef {Object} EventPayload
 * @property {string} type - Tipo do evento (EVENT_TYPES)
 * @property {number} timestamp - Quando ocorreu (ms)
 * @property {string} [source] - Quem emitiu (opcional)
 */

/**
 * Dispatcher de eventos simples e eficiente
 * Implementação minimalista para evitar dependências externas
 */
export class EventDispatcher {
  constructor() {
    /** @private @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** @private @type {Map<string, Array>} */
    this._history = new Map();
    this._historySize = 10; // Últimos N eventos por tipo para late-join
  }

  /**
   * Registra um listener para um tipo de evento
   * @param {string} eventType - Tipo do evento (EVENT_TYPES)
   * @param {Function} callback - Função a ser chamada quando o evento ocorrer
   * @param {Object} [options] - Opções adicionais
   * @param {boolean} [options.immediate=false] - Dispara evento histórico ao registrar
   * @returns {Function} Função para remover o listener (unsubscribe)
   */
  subscribe(eventType, callback, options = {}) {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, new Set());
    }

    const listeners = this._listeners.get(eventType);
    listeners.add(callback);

    // Dispara eventos históricos se solicitado (para clientes que conectaram tarde)
    if (options.immediate && this._history.has(eventType)) {
      const history = this._history.get(eventType);
      for (const event of history) {
        try {
          callback(event);
        } catch (e) {
          console.error(e);
        }
      }
    }

    // Retorna função de cleanup
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this._listeners.delete(eventType);
      }
    };
  }

  /**
   * Emite um evento para todos os listeners registrados
   * @param {string} eventType - Tipo do evento
   * @param {Object} payload - Dados do evento
   * @param {Object} [options] - Opções
   * @param {boolean} [options.storeHistory=true] - Salvar no histórico para late-join
   */
  emit(eventType, payload, options = {}) {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      ...payload,
    };

    // Salva no histórico se configurado
    if (options.storeHistory !== false) {
      if (!this._history.has(eventType)) {
        this._history.set(eventType, []);
      }
      const history = this._history.get(eventType);
      history.push(event);
      if (history.length > this._historySize) {
        history.shift(); // Remove o mais antigo
      }
    }

    // Notifica todos os listeners
    const listeners = this._listeners.get(eventType);
    if (!listeners) return;

    for (const callback of listeners) {
      try {
        callback(event);
      } catch (error) {
        console.error(
          `[EventDispatcher] Error in listener for ${eventType}:`,
          error,
        );
      }
    }
  }

  /**
   * Remove todos os listeners de um tipo de evento
   * @param {string} eventType
   */
  clear(eventType) {
    this._listeners.delete(eventType);
    this._history.delete(eventType);
  }

  /**
   * Obtém o histórico de um tipo de evento
   * @param {string} eventType
   * @returns {Array} Lista de eventos históricos
   */
  getHistory(eventType) {
    return this._history.get(eventType) ?? [];
  }
}

// Instância singleton para uso global
export const worldEvents = new EventDispatcher();

/**
 * Helper para criar payloads de evento padronizados
 * @param {string} type
 * @param {Object} data
 * @param {Object} options
 * @returns {Object} Payload pronto para emitir
 */
export function createEventPayload(type, data, options = {}) {
  return {
    type,
    timestamp: Date.now(),
    source: options.source || null,
    ...data,
  };
}

// Exporta tipos para TypeScript/JSDoc
/**
 * @typedef {Object} CombatDamageEvent
 * @property {string} type - 'combat:damage'
 * @property {number} timestamp
 * @property {string} attackerId
 * @property {string} defenderId
 * @property {number} damage
 * @property {string} [damageType] - 'physical', 'fire', 'poison', etc.
 * @property {boolean} [isCritical]
 * @property {boolean} [isFieldDamage]
 * @property {number} [defenderX]
 * @property {number} [defenderY]
 * @property {number} [defenderZ]
 */

/**
 * @typedef {Object} SpellCastEvent
 * @property {string} type - 'spell:cast'
 * @property {number} timestamp
 * @property {string} casterId
 * @property {string} spellId
 * @property {string} [targetId]
 * @property {number} [targetX]
 * @property {number} [targetY]
 * @property {number} [targetZ]
 * @property {string} [spellType] - 'direct', 'aoe', 'field', 'self', 'buff'
 */

/**
 * @typedef {Object} MapTransitionEvent
 * @property {string} type - 'map:transition'
 * @property {number} timestamp
 * @property {string} playerId
 * @property {Object} from - {x, y, z, map?}
 * @property {Object} to - {x, y, z, map?}
 * @property {string} [transitionType] - 'walk', 'use', 'npc'
 */
