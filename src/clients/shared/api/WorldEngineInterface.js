// =============================================================================
// WorldEngineInterface.js — mmoRPGEduc
// API PÚBLICA que os clientes consomem para interagir com o núcleo
// 
// Regras:
// • Cliente NUNCA acessa db.js, worldStore.js ou gameplay/ diretamente
// • Cliente usa APENAS esta interface para: enviar ações, receber updates
// • Esta classe encapsula NetworkInterface + validação + prediction
//
// Dependências: events.js, network/NetworkInterface.js
// =============================================================================

import { worldEvents, EVENT_TYPES, createEventPayload } from '../../../core/events.js';
import { createNetworkInstance, isFeatureEnabled } from '../../../core/network/networkFactory.js';

/**
 * Interface principal para clientes se comunicarem com o WorldEngine
 */
export class WorldEngineInterface {
  /**
   * @param {Object} config 
   * @param {string} [config.playerId] - ID do jogador (para ações)
   * @param {Object} [config.network] - Configurações de rede
   * @param {Function} [config.onEvent] - Callback global para eventos
   */
  constructor(config = {}) {
    this.config = {
      playerId: config.playerId || null,
      network: config.network || {},
      onEvent: config.onEvent || null,
    };
    
    /** @private */
    this._network = null;
    /** @private */
    this._subscriptions = new Map();
    /** @private */
    this._predictionState = {
      movements: new Map(),
      spells: new Map(),
    };
    /** @private */
    this._eventHandlers = new Map();
    
    // Registra handler global para eventos do núcleo
    this._globalEventUnsub = worldEvents.subscribe('*', (event) => {
      if (this.config.onEvent) {
        try { this.config.onEvent(event); } catch (e) { console.error(e); }
      }
    });
  }

  /**
   * Inicializa a conexão com o backend
   * @param {Object} options 
   * @returns {Promise<boolean>}
   */
  async connect(options = {}) {
    if (this._network) {
      console.warn('[WorldEngineInterface] Already connected');
      return true;
    }

    this._network = createNetworkInstance({
      ...this.config.network,
      playerId: this.config.playerId,
    });

    const success = await this._network.connect({
      ...options,
      clientId: this._network.clientId,
    });

    if (success) {
      // Configura listeners internos para sincronização
      this._setupInternalListeners();
    }

    return success;
  }

  /**
   * Desconecta e limpa recursos
   */
  async disconnect() {
    // Cancela todas as subscriptions do cliente
    for (const unsub of this._subscriptions.values()) {
      if (typeof unsub === 'function') unsub();
    }
    this._subscriptions.clear();

    // Cancela handlers de evento
    for (const unsub of this._eventHandlers.values()) {
      if (typeof unsub === 'function') unsub();
    }
    this._eventHandlers.clear();

    // Desconecta rede
    if (this._network) {
      await this._network.disconnect();
      this._network = null;
    }

    // Cleanup global
    if (this._globalEventUnsub) {
      this._globalEventUnsub();
      this._globalEventUnsub = null;
    }

    this._predictionState.movements.clear();
    this._predictionState.spells.clear();
  }

  // =============================================================================
  // MÉTODOS PÚBLICOS - O que o cliente pode chamar
  // =============================================================================

  /**
   * Envia uma ação para o WorldEngine processar
   * @param {Object} action 
   * @param {'attack'|'spell'|'move'|'use'|'chat'} action.type
   * @param {Object} action.payload - Dados específicos da ação
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendAction(action) {
    if (!this._network?.connected) {
      return { success: false, error: 'Not connected' };
    }

    // Validação básica do cliente (servidor re-valida)
    if (!this._validateAction(action)) {
      return { success: false, error: 'Invalid action' };
    }

    // Prediction client-side para responsividade (opcional)
    if (isFeatureEnabled('movementPrediction') && action.type === 'move') {
      this._predictMovement(action.payload);
    }
    
    if (isFeatureEnabled('spellPrediction') && action.type === 'spell') {
      this._predictSpell(action.payload);
    }

    return this._network.sendAction(action);
  }

  /**
   * Assina um canal para receber atualizações em tempo real
   * @param {'players'|'monsters'|'effects'|'fields'|'chat'} channel 
   * @param {Function} callback - Recebe {data, timestamp, type}
   * @returns {Function} Função para cancelar assinatura
   */
  subscribe(channel, callback) {
    if (!this._network) {
      console.warn('[WorldEngineInterface] subscribe called before connect');
      return () => {};
    }

    // Wrapper para adicionar metadados e tratar erros
    const wrappedCallback = (update) => {
      try {
        // Corrige prediction se servidor enviou correção
        const corrected = this._correctPrediction(channel, update.data);
        
        callback({
          ...update,
          data: corrected || update.data,
          corrected: !!corrected,
        });
      } catch (error) {
        console.error(`[WorldEngineInterface] Error in ${channel} callback:`, error);
      }
    };

    const unsub = this._network.subscribe(channel, wrappedCallback);
    this._subscriptions.set(`${channel}_${Date.now()}`, unsub);

    return () => {
      unsub();
      // Remove da map (pode haver múltiplas subs do mesmo canal)
      for (const [key, value] of this._subscriptions.entries()) {
        if (value === unsub) {
          this._subscriptions.delete(key);
          break;
        }
      }
    };
  }

  /**
   * Obtém snapshot atual de um canal
   * @param {string} channel 
   * @returns {Promise<Object>}
   */
  async getSnapshot(channel) {
    if (!this._network) {
      throw new Error('Not connected');
    }
    return this._network.getSnapshot(channel);
  }

  /**
   * Registra handler para evento específico do núcleo
   * @param {string} eventType - De EVENT_TYPES
   * @param {Function} callback 
   * @returns {Function} Unsubscribe
   */
  onEvent(eventType, callback) {
    const unsub = worldEvents.subscribe(eventType, callback);
    this._eventHandlers.set(`${eventType}_${Date.now()}`, unsub);
    return unsub;
  }

  /**
   * Obtém histórico de um tipo de evento (para late-join)
   * @param {string} eventType 
   * @returns {Array}
   */
  getEventHistory(eventType) {
    return worldEvents.getHistory(eventType);
  }

  /**
   * Estado da conexão
   * @returns {{connected: boolean, clientId: string, adapter: string}}
   */
  getConnectionState() {
    return {
      connected: this._network?.connected ?? false,
      clientId: this._network?.clientId ?? 'unknown',
      adapter: this.config.network?.adapter || 'firebase',
    };
  }

  // =============================================================================
  // MÉTODOS PRIVADOS - Lógica interna
  // =============================================================================

  /**
   * Valida estrutura básica de ação no cliente
   * @private
   */
  _validateAction(action) {
    if (!action?.type) return false;
    
    const validTypes = ['attack', 'spell', 'move', 'use', 'chat', 'interact', 'item'];
    if (!validTypes.includes(action.type)) return false;

    // Validações específicas por tipo
    switch (action.type) {
      case 'attack':
      case 'spell':
        return !!action.payload?.targetId;
      case 'move':
        return typeof action.payload?.x === 'number' &&
               typeof action.payload?.y === 'number';
      case 'chat':
        return typeof action.payload?.message === 'string' &&
               action.payload.message.length <= 120;
      case 'item': {
        const validItemActions = ['pickUp', 'drop', 'equip', 'unequip', 'move', 'use'];
        return validItemActions.includes(action.payload?.itemAction);
      }
      default:
        return true;
    }
  }

  /**
   * Prediction: movimento client-side para feedback imediato
   * @private
   */
  _predictMovement(payload) {
    const { playerId, x, y, z } = payload;
    const key = playerId || this.config.playerId;
    
    if (!key) return;
    
    // Salva estado previsto para correção posterior
    this._predictionState.movements.set(key, {
      predicted: { x, y, z },
      timestamp: Date.now(),
      confirmed: false,
    });
    
    // Emite evento local para UI atualizar imediatamente
    worldEvents.emit(EVENT_TYPES.PLAYER_MOVE, {
      playerId: key,
      x, y, z,
      predicted: true,
      timestamp: Date.now(),
    });
  }

  /**
   * Prediction: magia client-side (cuidado: pode ser cheat se não validar no server)
   * @private
   */
  _predictSpell(payload) {
    const { spellId, targetId, casterId } = payload;
    const key = `${casterId || this.config.playerId}:${spellId}`;
    
    this._predictionState.spells.set(key, {
      spellId,
      targetId,
      timestamp: Date.now(),
      confirmed: false,
    });
    
    // Emite evento para UI mostrar efeito visual imediato
    worldEvents.emit(EVENT_TYPES.SPELL_CAST, {
      casterId: casterId || this.config.playerId,
      spellId,
      targetId,
      predicted: true,
      timestamp: Date.now(),
    });
  }

  /**
   * Corrige prediction quando servidor envia estado real
   * @private
   */
  _correctPrediction(channel, data) {
    if (channel !== 'players' || !isFeatureEnabled('movementPrediction')) {
      return null;
    }

    // Data pode ser objeto único ou coleção
    const entities = data?.id ? { [data.id]: data } : data;
    
    for (const [id, entity] of Object.entries(entities || {})) {
      const pred = this._predictionState.movements.get(id);
      if (pred && !pred.confirmed) {
        const serverPos = { x: entity.x, y: entity.y, z: entity.z };
        const predPos = pred.predicted;
        
        // Se diferença for pequena, aceita prediction (suavização)
        const dist = Math.hypot(
          serverPos.x - predPos.x,
          serverPos.y - predPos.y,
          (serverPos.z || 7) - (predPos.z || 7)
        );
        
        if (dist < 0.5) {
          // Prediction estava correto, marca como confirmado
          pred.confirmed = true;
          return null; // Sem correção necessária
        } else {
          // Prediction estava errado, força correção visual
          pred.confirmed = true;
          worldEvents.emit(EVENT_TYPES.PLAYER_MOVE, {
            playerId: id,
            ...serverPos,
            corrected: true,
            timestamp: Date.now(),
          });
          return { ...entity, corrected: true };
        }
      }
    }
    
    return null;
  }

  /**
   * Configura listeners internos para sincronização
   * @private
   */
  _setupInternalListeners() {
    // Listener para ações confirmadas pelo servidor
    this._network.subscribe('actions', (update) => {
      const { id, data } = update;
      if (data?.processed) {
        // Ação foi processada, limpa prediction se existir
        if (data.action?.type === 'move') {
          const key = data.playerId;
          this._predictionState.movements.delete(key);
        }
        if (data.action?.type === 'spell') {
          const key = `${data.playerId}:${data.action.spellId}`;
          this._predictionState.spells.delete(key);
        }
      }
    });
  }
}

// =============================================================================
// Singleton para uso global (opcional)
// =============================================================================

let _globalInterface = null;

/**
 * Obtém ou cria instância global da interface
 * @param {Object} config 
 * @returns {WorldEngineInterface}
 */
export function getWorldEngineInstance(config = {}) {
  if (!_globalInterface) {
    _globalInterface = new WorldEngineInterface(config);
  }
  return _globalInterface;
}

/**
 * Reseta instância global (para testes/reconexão)
 */
export function resetWorldEngineInstance() {
  if (_globalInterface) {
    _globalInterface.disconnect();
    _globalInterface = null;
  }
}

// Exporta tipos para JSDoc/TypeScript
/**
 * @typedef {Object} ActionPayload
 * @property {'attack'|'spell'|'move'|'use'|'chat'} type
 * @property {Object} payload
 * @property {string} [payload.targetId]
 * @property {string} [payload.spellId]
 * @property {number} [payload.x]
 * @property {number} [payload.y]
 * @property {number} [payload.z]
 * @property {string} [payload.message]
 */

/**
 * @typedef {Object} ChannelUpdate
 * @property {string} channel
 * @property {Object} data
 * @property {number} timestamp
 * @property {string} type - 'snapshot'|'add'|'remove'|'change'
 * @property {boolean} [corrected]
 */