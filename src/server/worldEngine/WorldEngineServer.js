// =============================================================================
// WorldEngineServer.js — mmoRPGEduc (SOLUTION 3 - PREPARAÇÃO)
// Server-side World Engine para Node.js
//
// Este arquivo é um ESQUELETO para futura migração.
// Quando estiver pronto para migrar:
// 1. Instalar dependências: firebase-admin, express, ws
// 2. Configurar Firebase Admin SDK
// 3. Substituir WorkerBridge por WebSocket server
// 4. Este módulo já usa WorldEngineCore, então a lógica é reutilizada!
// =============================================================================

// Dependências (instalar com: npm install firebase-admin express ws)
// import admin from 'firebase-admin';
// import express from 'express';
// import { WebSocketServer } from 'ws';

import { createWorldEngine } from "../../core/engine/WorldEngineCore.js";
import {
  MESSAGE_TYPE,
  serializeMessage,
  deserializeMessage,
  MessageBuilder,
} from "../../core/network/EngineProtocol.js";

// =============================================================================
// CONFIGURAÇÃO DO SERVER
// =============================================================================

const SERVER_CONFIG = {
  port: process.env.PORT || 3000,
  firebaseConfig: {
    // Config do Firebase Admin (variáveis de ambiente)
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  },
  tickInterval: 100,
  maxConnections: 100,
};

// =============================================================================
// CLASSE DO SERVER
// =============================================================================

export class WorldEngineServer {
  constructor(config = {}) {
    this.config = { ...SERVER_CONFIG, ...config };

    // Engine core (reutiliza a mesma lógica do client!)
    this.engine = createWorldEngine({
      ...this.config,
      onEvent: this._onEngineEvent.bind(this),
      onUpdate: this._onEngineUpdate.bind(this),
    });

    // Conexões de clientes (WebSocket)
    this._clients = new Map();

    // Firebase Admin (inicializar quando migrar)
    this._firebase = null;

    // Server HTTP/WebSocket (inicializar quando migrar)
    this._httpServer = null;
    this._wsServer = null;
  }

  // =============================================================================
  // INICIALIZAÇÃO
  // =============================================================================

  async init() {
    console.log("[WorldEngineServer] Initializing...");

    // TODO: Inicializar Firebase Admin
    // admin.initializeApp({ credential: admin.credential.cert(this.config.firebaseConfig) });
    // this._firebase = admin.firestore();

    // TODO: Inicializar servidor HTTP + WebSocket
    // this._httpServer = express();
    // this._wsServer = new WebSocketServer({ server: this._httpServer });
    // this._setupWebSocketHandlers();

    // Inicializar engine com estado do Firebase
    const initialState = await this._loadInitialState();
    this.engine.init(initialState);

    console.log("[WorldEngineServer] Initialized");
    return true;
  }

  async start() {
    console.log(`[WorldEngineServer] Starting on port ${this.config.port}...`);

    // TODO: Iniciar servidor HTTP
    // this._httpServer.listen(this.config.port, () => {
    //   console.log(`[WorldEngineServer] Listening on port ${this.config.port}`);
    // });

    // Iniciar engine loop
    this.engine.start();

    console.log("[WorldEngineServer] Started");
  }

  async stop() {
    console.log("[WorldEngineServer] Stopping...");

    this.engine.stop();

    // TODO: Fechar servidor
    // if (this._wsServer) this._wsServer.close();
    // if (this._httpServer) this._httpServer.close();

    console.log("[WorldEngineServer] Stopped");
  }

  // =============================================================================
  // WEBSOCKET HANDLERS (TODO: implementar quando migrar)
  // =============================================================================

  _setupWebSocketHandlers() {
    this._wsServer.on("connection", (ws, req) => {
      const clientId = this._generateClientId(req);
      console.log(`[WS] Client connected: ${clientId}`);

      this._clients.set(clientId, { ws, lastHeartbeat: Date.now() });

      ws.on("message", (data) => this._handleClientMessage(clientId, data));
      ws.on("close", () => this._handleClientDisconnect(clientId));
      ws.on("error", (err) => console.error(`[WS] Error ${clientId}:`, err));

      // Enviar confirmação de conexão
      this._sendToClient(clientId, MessageBuilder.initResponse(true));
    });
  }

  async _handleClientMessage(clientId, raw) {
    const message = deserializeMessage(raw);
    if (!message) return;

    const client = this._clients.get(clientId);
    if (!client) return;

    // Atualizar heartbeat
    client.lastHeartbeat = Date.now();

    switch (message.type) {
      case MESSAGE_TYPE.ACTION:
        await this._handleClientAction(clientId, message.payload.action);
        break;

      case MESSAGE_TYPE.HEARTBEAT:
        this._sendToClient(clientId, MessageBuilder.heartbeat());
        break;

      // ... outros tipos
    }
  }

  async _handleClientAction(clientId, action) {
    // Validar e processar ação
    if (!action?.type) {
      this._sendToClient(
        clientId,
        MessageBuilder.actionResult(action?.id, {
          success: false,
          error: "Invalid action",
        }),
      );
      return;
    }

    // Enfileirar para o engine processar
    this.engine.queueAction({ ...action, sourceClientId: clientId });

    // Confirmar recebimento
    this._sendToClient(
      clientId,
      MessageBuilder.actionResult(action.id, {
        success: true,
        queued: true,
      }),
    );
  }

  _handleClientDisconnect(clientId) {
    console.log(`[WS] Client disconnected: ${clientId}`);
    this._clients.delete(clientId);
  }

  // =============================================================================
  // ENGINE CALLBACKS → BROADCAST PARA CLIENTES
  // =============================================================================

  _onEngineEvent(event) {
    // Broadcast evento para todos os clientes interessados
    const message = MessageBuilder.event(event.type, event.payload);
    this._broadcast(message);
  }

  _onEngineUpdate(updates) {
    // Enviar updates apenas para clientes que precisam
    // (otimização: enviar apenas deltas relevantes por cliente)
    const message = MessageBuilder.stateUpdate(updates);
    this._broadcast(message);

    // TODO: Também atualizar Firebase com mudanças persistentes
    // await this._syncToFirebase(updates);
  }

  // =============================================================================
  // UTILITÁRIOS DE COMUNICAÇÃO
  // =============================================================================

  _sendToClient(clientId, message) {
    const client = this._clients.get(clientId);
    if (client?.ws?.readyState === 1) {
      // WebSocket.OPEN
      client.ws.send(JSON.stringify(message));
    }
  }

  _broadcast(message, filterFn = null) {
    const serialized = JSON.stringify(message);
    for (const [clientId, client] of this._clients.entries()) {
      if (filterFn && !filterFn(clientId, client)) continue;
      if (client.ws?.readyState === 1) {
        client.ws.send(serialized);
      }
    }
  }

  _generateClientId(req) {
    // Gerar ID único para cliente
    return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  async _loadInitialState() {
    // TODO: Carregar estado inicial do Firebase
    // const players = await this._firebase.collection('online_players').get();
    // const monsters = await this._firebase.collection('world_entities').where('type', '==', 'monster').get();
    // return { players, monsters };

    // Placeholder
    return { players: {}, monsters: {}, fields: {} };
  }

  async _syncToFirebase(updates) {
    // TODO: Escrever mudanças persistentes de volta no Firebase
    // const batch = this._firebase.batch();
    // ... aplicar updates ...
    // await batch.commit();
  }

  // =============================================================================
  // CLEANUP
  // =============================================================================

  destroy() {
    this.stop();
    this._clients.clear();
    this.engine = null;
  }
}

// =============================================================================
// FACTORY E EXPORTS
// =============================================================================

export function createWorldEngineServer(config = {}) {
  return new WorldEngineServer(config);
}

// Export para compatibilidade com imports
export default { createWorldEngineServer, WorldEngineServer };

// =============================================================================
// SCRIPT DE INICIALIZAÇÃO (para rodar como processo Node)
// =============================================================================

// Se executado diretamente: node WorldEngineServer.js
if (typeof require !== "undefined" && require.main === module) {
  (async () => {
    const server = createWorldEngineServer();
    await server.init();
    await server.start();

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("[WorldEngineServer] Shutting down...");
      await server.stop();
      process.exit(0);
    });
  })();
}
