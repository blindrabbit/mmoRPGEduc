// =============================================================================
// WorkerBridge.js — mmoRPGEduc
// Ponte de comunicação entre Main Thread e Web Worker
//
// Abstrai a comunicação para que o código do jogo não precise saber
// se está rodando em worker, main thread, ou futuro server.
// =============================================================================

import {
  MESSAGE_TYPE,
  deserializeMessage,
  MessageBuilder,
  MessageValidator,
  logMessage,
} from "../../../core/network/EngineProtocol.js";

// Resolve o path do worker relativo a este arquivo (funciona independente do HTML)
const _DEFAULT_WORKER_URL = new URL("./worldTick.worker.js", import.meta.url)
  .href;

export class WorkerBridge {
  constructor(options = {}) {
    this.options = {
      ...options,
      workerPath: options.workerPath || _DEFAULT_WORKER_URL,
      enableWorker: options.enableWorker ?? true,
      fallbackToMain: options.fallbackToMain ?? true,
    };

    this._worker = null;
    this._useWorker = false;
    this._messageId = 0;
    this._pendingRequests = new Map();

    // Callbacks
    this._onUpdate = null;
    this._onEvent = null;
    this._onError = null;
    this._onReady = null;

    // Estado local (fallback mode)
    this._core = null;
  }

  // =============================================================================
  // INICIALIZAÇÃO
  // =============================================================================

  async init(config = {}, initialState = {}) {
    // Tentar usar worker se disponível e habilitado
    if (this.options.enableWorker && typeof Worker !== "undefined") {
      try {
        // { type: "module" } é obrigatório para workers que usam import/export
        this._worker = new Worker(this.options.workerPath, { type: "module" });
        this._setupWorkerListeners();
        this._useWorker = true;

        // Enviar init
        const initMsg = MessageBuilder.init(config, initialState);
        this._postMessage(initMsg);

        // Aguardar resposta de init
        return await this._waitForResponse(MESSAGE_TYPE.INIT_RESPONSE, 5000);
      } catch (error) {
        console.warn("[WorkerBridge] Failed to initialize worker:", error);
        if (!this.options.fallbackToMain) {
          throw error;
        }
        // Fallback para main thread
        this._useWorker = false;
      }
    }

    // Fallback: instanciar core na main thread
    return this._initMainFallback(config, initialState);
  }

  async _initMainFallback(config, initialState) {
    // Import dinâmico para evitar circular deps
    const { createWorldEngine } =
      await import("../../../core/engine/WorldEngineCore.js");

    this._core = createWorldEngine({
      ...config,
      onEvent: (event) => this._handleEvent(event),
      onUpdate: (updates) => this._handleUpdate(updates),
    });
    this._core.init(initialState);

    if (this._onReady) this._onReady({ mode: "main-thread" });
    return { success: true, mode: "main-thread" };
  }

  _setupWorkerListeners() {
    this._worker.onmessage = (e) => this._handleWorkerMessage(e.data);
    this._worker.onerror = (error) => {
      const msg = error?.message || "(sem mensagem)";
      const file = error?.filename || this.options.workerPath;
      const line = error?.lineno ? `:${error.lineno}` : "";
      console.warn(
        `[WorkerBridge] Worker falhou ao carregar — usando fallback main thread.\n` +
          `  Path: ${file}${line}\n` +
          `  Erro: ${msg}`,
      );

      if (this._onError)
        this._onError({ type: "worker_error", message: msg, filename: file });

      // Rejeitar _waitForResponse pendente imediatamente (evita esperar o timeout)
      const pending = this._pendingRequests.get(MESSAGE_TYPE.INIT_RESPONSE);
      if (pending) {
        pending.reject(new Error(`Worker failed: ${msg} (${file}${line})`));
        this._pendingRequests.delete(MESSAGE_TYPE.INIT_RESPONSE);
      }

      // Marcar worker como inválido para acionar fallback no catch de init()
      this._useWorker = false;
    };
  }

  // =============================================================================
  // COMUNICAÇÃO COM WORKER
  // =============================================================================

  _postMessage(message) {
    if (this._useWorker && this._worker) {
      logMessage(message, "→");
      this._worker.postMessage(message);
    }
  }

  _handleWorkerMessage(raw) {
    const message = deserializeMessage(raw);
    if (!message) return;

    logMessage(message, "←");

    switch (message.type) {
      case MESSAGE_TYPE.INIT_RESPONSE:
        this._resolvePending(MESSAGE_TYPE.INIT_RESPONSE, message.payload);
        if (this._onReady)
          this._onReady({ mode: "worker", ...message.payload });
        break;

      case MESSAGE_TYPE.STATE_UPDATE:
        if (this._onUpdate) this._onUpdate(message.payload);
        break;

      case MESSAGE_TYPE.EVENT:
        this._handleEvent(message.payload);
        break;

      case MESSAGE_TYPE.ACTION_RESULT:
        this._resolvePending(
          `action:${message.payload.actionId}`,
          message.payload.result,
        );
        break;

      case MESSAGE_TYPE.ERROR:
        if (this._onError) this._onError(message.payload);
        break;

      case MESSAGE_TYPE.HEARTBEAT:
        // Responder heartbeat para manter worker ativo
        this._postMessage(MessageBuilder.heartbeat());
        break;
    }
  }

  // =============================================================================
  // SISTEMA DE REQUEST/RESPONSE
  // =============================================================================

  _waitForResponse(expectedType, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(expectedType);
        reject(new Error(`Timeout waiting for ${expectedType}`));
      }, timeout);

      this._pendingRequests.set(expectedType, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  _resolvePending(key, value) {
    const pending = this._pendingRequests.get(key);
    if (pending) {
      pending.resolve(value);
      this._pendingRequests.delete(key);
    }
  }

  // =============================================================================
  // API PÚBLICA (mesma interface independente do modo)
  // =============================================================================

  start() {
    if (this._useWorker) {
      this._postMessage(MessageBuilder.start());
    } else if (this._core) {
      this._core.start();
    }
  }

  stop() {
    if (this._useWorker) {
      this._postMessage(MessageBuilder.stop());
    } else if (this._core) {
      this._core.stop();
    }
  }

  async sendAction(action) {
    if (!MessageValidator.isValidAction(action)) {
      return { success: false, error: "Invalid action" };
    }

    const actionId = `act_${++this._messageId}_${Date.now()}`;

    if (this._useWorker) {
      this._postMessage(MessageBuilder.action({ ...action, id: actionId }));
      return this._waitForResponse(`action:${actionId}`, 3000);
    } else if (this._core) {
      this._core.queueAction({ ...action, id: actionId });
      return { success: true, actionId };
    }

    return { success: false, error: "Engine not initialized" };
  }

  syncEntities(entities) {
    if (this._useWorker) {
      this._postMessage(MessageBuilder.syncEntities(entities));
    } else if (this._core) {
      this._core.syncEntities(entities);
    }
  }

  async getSnapshot() {
    if (this._useWorker) {
      this._postMessage(MessageBuilder.stateSnapshot());
    } else if (this._core) {
      return this._core.getSnapshot();
    }
    return {};
  }

  setConfig(config) {
    if (this._useWorker) {
      this._postMessage(MessageBuilder.setConfig(config));
    } else if (this._core) {
      Object.assign(this._core.config, config);
    }
  }

  // =============================================================================
  // CALLBACKS
  // =============================================================================

  onUpdate(callback) {
    this._onUpdate = callback;
  }

  onEvent(callback) {
    this._onEvent = callback;
  }

  onError(callback) {
    this._onError = callback;
  }

  onReady(callback) {
    this._onReady = callback;
  }

  // ===============================================================
  // HELPERS INTERNOS
  // ===============================================================

  _handleEvent(event) {
    if (this._onEvent) {
      this._onEvent({
        ...event,
        source: this._useWorker ? "worker" : "main",
      });
    }
  }

  _handleUpdate(updates) {
    if (this._onUpdate) {
      this._onUpdate({
        ...updates,
        source: this._useWorker ? "worker" : "main",
      });
    }
  }

  // =============================================================================
  // CLEANUP
  // =============================================================================

  destroy() {
    this.stop();

    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }

    if (this._core) {
      this._core = null;
    }

    this._pendingRequests.clear();
    this._onUpdate = null;
    this._onEvent = null;
    this._onError = null;
    this._onReady = null;
  }

  // =============================================================================
  // STATUS/DEBUG
  // =============================================================================

  getStatus() {
    return {
      mode: this._useWorker ? "worker" : this._core ? "main" : "uninitialized",
      running: this._core?.["_running"] ?? false,
      worker: this._worker ? { state: "active" } : null,
    };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createWorkerBridge(options = {}) {
  return new WorkerBridge(options);
}
