// =============================================================================
// worldTick.worker.js — mmoRPGEduc
// Wrapper do WorldEngineCore para execução em Web Worker
//
// Responsabilidades:
// • Receber mensagens via postMessage
// • Instanciar e gerenciar WorldEngineCore
// • Enviar updates/eventos de volta para main thread
// • Manter-se leve (sem imports pesados de UI/render)
// =============================================================================

import {
  MESSAGE_TYPE,
  deserializeMessage,
  serializeMessage,
  MessageBuilder,
  MessageValidator,
} from "../../../core/network/EngineProtocol.js";
import { createWorldEngine } from "../../../core/engine/WorldEngineCore.js";

// =============================================================================
// ESTADO DO WORKER
// =============================================================================

let engine = null;
let heartbeatTimer = null;
const HEARTBEAT_INTERVAL = 5000;

// =============================================================================
// MESSAGE HANDLER
// =============================================================================

self.onmessage = async function (e) {
  const message = deserializeMessage(e.data);
  if (!message) return;

  try {
    await _handleMessage(message);
  } catch (error) {
    _sendError(error.message, {
      messageType: message.type,
      stack: error.stack,
    });
  }
};

async function _handleMessage(message) {
  const { type, payload, meta } = message;

  switch (type) {
    case MESSAGE_TYPE.INIT:
      await _handleInit(payload.config, payload.initialState);
      break;

    case MESSAGE_TYPE.START:
      _handleStart();
      break;

    case MESSAGE_TYPE.STOP:
      _handleStop();
      break;

    case MESSAGE_TYPE.SET_CONFIG:
      _handleSetConfig(payload.config);
      break;

    case MESSAGE_TYPE.SYNC_ENTITIES:
      _handleSyncEntities(payload.entities);
      break;

    case MESSAGE_TYPE.ACTION:
      await _handleAction(payload.action);
      break;

    case MESSAGE_TYPE.HEARTBEAT:
      _handleHeartbeat();
      break;
  }
}

// =============================================================================
// HANDLERS DE MENSAGENS
// =============================================================================

async function _handleInit(config, initialState) {
  // Instanciar engine
  engine = createWorldEngine({
    ...config,
    // Callbacks para comunicar com main thread
    onEvent: _forwardEvent,
    onUpdate: _forwardUpdate,
  });

  // Inicializar com estado
  engine.init(initialState);

  // Enviar confirmação
  _sendMessage(MessageBuilder.initResponse(true));

  // Iniciar heartbeat para manter worker "acordado"
  _startHeartbeat();
}

function _handleStart() {
  if (engine) {
    engine.start();
  }
}

function _handleStop() {
  if (engine) {
    engine.stop();
  }
}

function _handleSetConfig(config) {
  if (engine) {
    engine.setConfig?.(config);
  }
}

function _handleSyncEntities(entities) {
  if (engine) {
    engine.syncEntities(entities);
  }
}

async function _handleAction(action) {
  if (!engine) {
    _sendMessage(
      MessageBuilder.actionResult(action.id, {
        success: false,
        error: "Engine not initialized",
      }),
    );
    return;
  }

  if (!MessageValidator.isValidAction(action)) {
    _sendMessage(
      MessageBuilder.actionResult(action.id, {
        success: false,
        error: "Invalid action",
      }),
    );
    return;
  }

  // Enfileirar ação para processamento no próximo tick
  engine.queueAction(action);

  // Confirmar recebimento (resultado real virá via EVENT ou STATE_UPDATE)
  _sendMessage(
    MessageBuilder.actionResult(action.id, {
      success: true,
      queued: true,
    }),
  );
}

function _handleHeartbeat() {
  // Responder para manter conexão
  _sendMessage(MessageBuilder.heartbeat());
}

// =============================================================================
// FORWARDING PARA MAIN THREAD
// =============================================================================

function _forwardEvent(event) {
  _sendMessage(MessageBuilder.event(event.type, event.payload));
}

function _forwardUpdate(updates) {
  _sendMessage(MessageBuilder.stateUpdate(updates));
}

// =============================================================================
// UTILITÁRIOS DE COMUNICAÇÃO
// =============================================================================

function _sendMessage(message) {
  try {
    self.postMessage(message);
  } catch (error) {
    console.error("[Worker] Failed to post message:", error);
  }
}

function _sendError(message, details = {}) {
  _sendMessage(MessageBuilder.error(message, details));
}

function _startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(() => {
    _sendMessage(MessageBuilder.heartbeat());
  }, HEARTBEAT_INTERVAL);
}

// =============================================================================
// CLEANUP
// =============================================================================

self.onclose = function () {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (engine) {
    engine.stop();
    engine = null;
  }
};

// NOTA: NÃO enviar initResponse aqui.
// A resposta é enviada em _handleInit() APÓS processar a mensagem INIT,
// para que WorkerBridge._waitForResponse() já esteja escutando.
