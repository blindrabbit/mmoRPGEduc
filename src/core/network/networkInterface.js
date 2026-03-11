// =============================================================================
// NetworkInterface.js — mmoRPGEduc
// Contrato abstrato para comunicação núcleo ↔ transporte
// 
// Objetivo: Permitir trocar Firebase por WebSocket/outra tecnologia
//           sem refatorar toda a lógica do jogo
//
// Dependências: events.js (para eventos internos)
// =============================================================================

import { worldEvents, EVENT_TYPES } from '../events.js';

/**
 * Interface abstrata para adaptadores de rede
 * @abstract
 */
export class NetworkInterface {
  constructor(config = {}) {
    this.config = config;
    this.connected = false;
    this.clientId = config.clientId || `client_${Math.random().toString(36).slice(2, 9)}`;
    this._subscriptions = new Map();
  }

  /**
   * Conecta ao backend
   * @param {Object} options 
   * @returns {Promise<boolean>}
   * @abstract
   */
  async connect(options = {}) {
    throw new Error('connect() must be implemented by adapter');
  }

  /**
   * Desconecta do backend
   * @returns {Promise<void>}
   * @abstract
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by adapter');
  }

  /**
   * Envia uma ação/intenção para o servidor processar
   * @param {Object} action - { type, payload, ... }
   * @returns {Promise<{success: boolean, error?: string}>}
   * @abstract
   */
  async sendAction(action) {
    throw new Error('sendAction() must be implemented by adapter');
  }

  /**
   * Escuta atualizações de um canal específico
   * @param {string} channel - 'players', 'monsters', 'effects', etc.
   * @param {Function} callback - Recebe dados atualizados
   * @returns {Function} Função para cancelar assinatura
   * @abstract
   */
  subscribe(channel, callback) {
    throw new Error('subscribe() must be implemented by adapter');
  }

  /**
   * Obtém snapshot atual de um canal
   * @param {string} channel 
   * @returns {Promise<Object>}
   * @abstract
   */
  async getSnapshot(channel) {
    throw new Error('getSnapshot() must be implemented by adapter');
  }

  /**
   * Emite evento interno para o núcleo (não vai para rede)
   * @protected
   * @param {string} eventType 
   * @param {Object} payload 
   */
  _emitInternal(eventType, payload) {
    worldEvents.emit(eventType, payload, { storeHistory: false });
  }

  /**
   * Valida estrutura básica de ação antes de enviar
   * @protected
   * @param {Object} action 
   * @returns {boolean}
   */
  _validateAction(action) {
    if (!action || typeof action !== 'object') return false;
    if (!action.type || typeof action.type !== 'string') return false;
    return true;
  }

  /**
   * Serializa payload para transporte
   * @protected
   * @param {Object} payload 
   * @returns {Object}
   */
  _serialize(payload) {
    return JSON.parse(JSON.stringify(payload)); // Deep clone simples
  }

  /**
   * Desserializa payload recebido
   * @protected
   * @param {Object} raw 
   * @returns {Object}
   */
  _deserialize(raw) {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return raw; }
    }
    return raw;
  }
}

/**
 * Factory para criar adaptador baseado em configuração
 * @param {string} type - 'firebase', 'websocket', etc.
 * @param {Object} config 
 * @returns {NetworkInterface}
 */
export function createNetworkAdapter(type, config = {}) {
  switch (type?.toLowerCase()) {
    case 'firebase':
      return new FirebaseAdapter(config);
    case 'websocket':
      return new WebSocketAdapter(config);
    case 'mock':
      return new MockAdapter(config);
    default:
      console.warn(`[Network] Unknown adapter type: ${type}, using Firebase`);
      return new FirebaseAdapter(config);
  }
}

// =============================================================================
// Firebase Adapter (implementação atual)
// =============================================================================

export class FirebaseAdapter extends NetworkInterface {
  constructor(config = {}) {
    super(config);
    this._firebaseSubs = new Map();
    this._dbFunctions = null;
  }

  async connect(options = {}) {
    if (this.connected) return true;
    
    try {
      // Importa funções do db.js dinamicamente para evitar circular deps
      const db = await import('../db.js');
      this._dbFunctions = db;
      
      this.connected = true;
      this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
        message: 'Firebase adapter connected',
        clientId: this.clientId,
      });
      
      return true;
    } catch (error) {
      console.error('[FirebaseAdapter] Connection failed:', error);
      this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
        message: 'Firebase connection failed',
        error: error.message,
        level: 'error',
      });
      return false;
    }
  }

  async disconnect() {
    // Firebase não precisa de disconnect explícito (conexão persistente)
    // Mas limpamos nossas subscriptions
    for (const [channel, unsub] of this._firebaseSubs) {
      if (typeof unsub === 'function') unsub();
    }
    this._firebaseSubs.clear();
    this.connected = false;
    
    this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
      message: 'Firebase adapter disconnected',
      clientId: this.clientId,
    });
  }

  async sendAction(action) {
    if (!this._validateAction(action)) {
      return { success: false, error: 'Invalid action structure' };
    }

    if (!this._dbFunctions?.submitPlayerAction) {
      return { success: false, error: 'Database functions not loaded' };
    }

    try {
      // Usa playerId do config ou gera um temporário
      const playerId = this.config.playerId || `temp_${this.clientId}`;
      
      await this._dbFunctions.submitPlayerAction(playerId, {
        ...action,
        _clientId: this.clientId, // Para debugging
        _sentAt: Date.now(),
      });
      
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAdapter] sendAction failed:', error);
      return { success: false, error: error.message };
    }
  }

  subscribe(channel, callback) {
    if (!this._dbFunctions) {
      console.warn('[FirebaseAdapter] subscribe called before connect');
      return () => {};
    }

    // Mapeia canal abstrato para função específica do db.js
    const watchFunctions = {
      'players': this._dbFunctions.watchPlayers,
      'monsters': this._dbFunctions.watchMonsters,
      'effects': this._dbFunctions.watchEffects,
      'fields': this._dbFunctions.watchFields,
      'chat': this._dbFunctions.watchChat,
      'actions': this._dbFunctions.watchPlayerActions,
    };

    const watchFn = watchFunctions[channel];
    if (!watchFn) {
      console.warn(`[FirebaseAdapter] Unknown channel: ${channel}`);
      return () => {};
    }

    // Wrapper para normalizar callback
    const wrappedCallback = (data) => {
      try {
        callback({
          channel,
          data,
          timestamp: Date.now(),
          adapter: 'firebase',
        });
      } catch (error) {
        console.error(`[FirebaseAdapter] Error in ${channel} callback:`, error);
      }
    };

    // Registra subscription
    let unsubscribe;
    if (channel === 'effects') {
      // watchEffectsChildren tem API diferente
      unsubscribe = watchFn({
        onAdd: (id, data) => wrappedCallback({ type: 'add', id, data }),
        onRemove: (id) => wrappedCallback({ type: 'remove', id }),
        onChange: (id, data) => wrappedCallback({ type: 'change', id, data }),
      });
    } else if (channel === 'actions') {
      unsubscribe = watchFn((id, data) => wrappedCallback({ id, data }));
    } else {
      unsubscribe = watchFn(wrappedCallback);
    }

    this._firebaseSubs.set(channel, unsubscribe);

    // Retorna função para cancelar
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      this._firebaseSubs.delete(channel);
    };
  }

  async getSnapshot(channel) {
    if (!this._dbFunctions?.dbGet) {
      throw new Error('Database functions not loaded');
    }

    const paths = {
      'players': this._dbFunctions.PATHS.players,
      'monsters': this._dbFunctions.PATHS.monsters,
      'effects': this._dbFunctions.PATHS.effects,
      'fields': this._dbFunctions.PATHS.fields,
      'chat': this._dbFunctions.PATHS.chat,
      'worldState': this._dbFunctions.PATHS.worldState,
    };

    const path = paths[channel];
    if (!path) {
      throw new Error(`Unknown snapshot channel: ${channel}`);
    }

    const raw = await this._dbFunctions.dbGet(path);
    return raw || {};
  }
}

// =============================================================================
// WebSocket Adapter (esqueleto para futura implementação)
// =============================================================================

export class WebSocketAdapter extends NetworkInterface {
  constructor(config = {}) {
    super(config);
    this.ws = null;
    this._reconnectAttempts = 0;
    this._maxReconnect = 5;
    this._messageQueue = [];
  }

  async connect(options = {}) {
    if (this.connected) return true;

    const url = options.url || this.config.url || 'ws://localhost:3000';
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => {
          this.connected = true;
          this._reconnectAttempts = 0;
          
          // Envia handshake com clientId
          this.ws.send(JSON.stringify({
            type: 'handshake',
            clientId: this.clientId,
            config: this.config,
          }));
          
          // Processa fila de mensagens pendentes
          while (this._messageQueue.length > 0) {
            const msg = this._messageQueue.shift();
            this.ws.send(JSON.stringify(msg));
          }
          
          this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
            message: 'WebSocket connected',
            url,
          });
          
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          const message = this._deserialize(event.data);
          this._handleMessage(message);
        };

        this.ws.onclose = () => {
          this.connected = false;
          this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
            message: 'WebSocket disconnected',
            attempts: this._reconnectAttempts,
          });
          
          // Tentativa de reconexão automática
          this._attemptReconnect(options);
        };

        this.ws.onerror = (error) => {
          console.error('[WebSocketAdapter] Error:', error);
          this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
            message: 'WebSocket error',
            error: error.message,
            level: 'error',
          });
          reject(error);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this._messageQueue = [];
  }

  async sendAction(action) {
    if (!this._validateAction(action)) {
      return { success: false, error: 'Invalid action structure' };
    }

    const message = {
      type: 'action',
      clientId: this.clientId,
      action: this._serialize(action),
      timestamp: Date.now(),
    };

    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return { success: true };
    } else {
      // Enfileira para envio posterior
      this._messageQueue.push(message);
      return { success: false, error: 'Not connected, queued for later' };
    }
  }

  subscribe(channel, callback) {
    // WebSocket usa subscription via mensagem
    const subId = `${channel}_${Date.now()}`;
    
    const subscription = {
      id: subId,
      channel,
      callback,
    };

    // Envia pedido de subscrição ao servidor
    if (this.connected) {
      this.ws?.send(JSON.stringify({
        type: 'subscribe',
        clientId: this.clientId,
        channel,
        subId,
      }));
    }

    // Armazena callback localmente para quando mensagens chegarem
    if (!this._subscriptions.has(channel)) {
      this._subscriptions.set(channel, new Map());
    }
    this._subscriptions.get(channel).set(subId, callback);

    // Retorna função para cancelar
    return () => {
      this._subscriptions.get(channel)?.delete(subId);
      
      if (this.connected) {
        this.ws?.send(JSON.stringify({
          type: 'unsubscribe',
          clientId: this.clientId,
          channel,
          subId,
        }));
      }
    };
  }

  async getSnapshot(channel) {
    // WebSocket: pede snapshot ao servidor
    return new Promise((resolve, reject) => {
      const requestId = `snapshot_${Date.now()}`;
      
      // Listener temporário para resposta
      const tempCallback = (data) => {
        if (data.requestId === requestId) {
          resolve(data.payload);
          // Remove listener após receber
          this._subscriptions.get('snapshots')?.delete(requestId);
        }
      };
      
      if (!this._subscriptions.has('snapshots')) {
        this._subscriptions.set('snapshots', new Map());
      }
      this._subscriptions.get('snapshots').set(requestId, tempCallback);
      
      // Envia pedido
      this.ws?.send(JSON.stringify({
        type: 'snapshot_request',
        clientId: this.clientId,
        channel,
        requestId,
      }));
      
      // Timeout de segurança
      setTimeout(() => {
        if (this._subscriptions.get('snapshots')?.has(requestId)) {
          this._subscriptions.get('snapshots').delete(requestId);
          reject(new Error('Snapshot timeout'));
        }
      }, 5000);
    });
  }

  // === Métodos privados ===

  _handleMessage(message) {
    const { type, channel, subId, payload, requestId } = message;

    switch (type) {
      case 'update':
        // Atualização de canal assinado
        const callbacks = this._subscriptions.get(channel);
        if (callbacks) {
          for (const cb of callbacks.values()) {
            try { cb(payload); } catch (e) { console.error(e); }
          }
        }
        break;
        
      case 'snapshot_response':
        // Resposta de pedido de snapshot
        const snapshotCallbacks = this._subscriptions.get('snapshots');
        if (snapshotCallbacks?.has(requestId)) {
          snapshotCallbacks.get(requestId)(payload);
        }
        break;
        
      case 'server_event':
        // Evento emitido pelo servidor
        this._emitInternal(payload.eventType, payload.data);
        break;
        
      case 'error':
        console.error('[WebSocketAdapter] Server error:', payload);
        this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
          message: 'Server error',
          error: payload,
          level: 'error',
        });
        break;
    }
  }

  _attemptReconnect(options) {
    if (this._reconnectAttempts >= this._maxReconnect) {
      this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
        message: 'Max reconnection attempts reached',
        level: 'error',
      });
      return;
    }

    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 10000);
    
    this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
      message: `Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`,
    });

    setTimeout(() => {
      if (!this.connected) {
        this.connect(options).catch(() => {});
      }
    }, delay);
  }
}

// =============================================================================
// Mock Adapter (para testes e desenvolvimento offline)
// =============================================================================

export class MockAdapter extends NetworkInterface {
  constructor(config = {}) {
    super(config);
    this._mockData = {
      players: {},
      monsters: {},
      effects: {},
      fields: {},
      chat: [],
    };
    this._interval = null;
  }

  async connect(options = {}) {
    this.connected = true;
    
    // Simula dados iniciais
    if (options.seedData) {
      this._mockData = { ...this._mockData, ...options.seedData };
    }
    
    // Simula updates periódicos para testes
    if (options.simulateUpdates) {
      this._interval = setInterval(() => {
        this._emitInternal(EVENT_TYPES.SYSTEM_LOG, {
          message: '[Mock] Simulated tick',
          players: Object.keys(this._mockData.players).length,
        });
      }, 1000);
    }
    
    return true;
  }

  async disconnect() {
    if (this._interval) clearInterval(this._interval);
    this.connected = false;
  }

  async sendAction(action) {
    // Mock: apenas loga e retorna sucesso
    console.log('[MockAdapter] Action sent:', action);
    
    // Simula processamento assíncrono
    await new Promise(r => setTimeout(r, 50));
    
    return { success: true, mock: true };
  }

  subscribe(channel, callback) {
    // Mock: dispara callback imediatamente com dados atuais
    callback({
      channel,
      data: this._mockData[channel] || {},
      timestamp: Date.now(),
      adapter: 'mock',
    });
    
    // Retorna noop (não há subscription real para cancelar)
    return () => {};
  }

  async getSnapshot(channel) {
    return this._mockData[channel] || {};
  }

  // Helpers para testes
  setMockData(channel, data) {
    this._mockData[channel] = data;
  }
  
  triggerMockEvent(eventType, payload) {
    this._emitInternal(eventType, payload);
  }
}