// =============================================================================
// networkFactory.js — mmoRPGEduc
// Factory centralizada para criação de adaptadores de rede
//
// Objetivo: Centralizar configuração e permitir feature flags
//
// Dependências: NetworkInterface.js
// =============================================================================

import { createNetworkAdapter } from "./networkInterface.js";

/**
 * Configuração padrão de rede
 * @type {Object}
 */
export const DEFAULT_NETWORK_CONFIG = {
  // Adaptador a usar: 'firebase' | 'websocket' | 'mock'
  adapter: "firebase",

  // Configurações por adaptador
  firebase: {
    // Configurações do Firebase são herdadas do db.js
  },

  websocket: {
    url: (typeof process !== "undefined" && process.env?.WS_URL) || "ws://localhost:3000",
    reconnect: true,
    maxReconnectAttempts: 5,
  },

  mock: {
    seedData: null,
    simulateUpdates: false,
  },

  // Feature flags
  features: {
    // Habilita prediction client-side para movimento
    movementPrediction: true,
    // Habilita prediction para magias (cuidado com cheat)
    spellPrediction: false,
    // Buffer de ações para reduzir spam de rede
    actionBuffering: true,
    actionBufferMs: 50,
  },
};

/**
 * Cria instância de adaptador com configuração mesclada
 * @param {Object} userConfig - Configurações do usuário (sobrescrevem defaults)
 * @returns {NetworkInterface}
 */
export function createNetworkInstance(userConfig = {}) {
  const config = {
    ...DEFAULT_NETWORK_CONFIG,
    ...userConfig,
    // Mescla configs específicas do adaptador
    firebase: {
      ...DEFAULT_NETWORK_CONFIG.firebase,
      ...(userConfig.firebase || {}),
    },
    websocket: {
      ...DEFAULT_NETWORK_CONFIG.websocket,
      ...(userConfig.websocket || {}),
    },
    mock: { ...DEFAULT_NETWORK_CONFIG.mock, ...(userConfig.mock || {}) },
    features: {
      ...DEFAULT_NETWORK_CONFIG.features,
      ...(userConfig.features || {}),
    },
  };

  const adapterConfig = config[config.adapter] || {};

  return createNetworkAdapter(config.adapter, {
    ...adapterConfig,
    features: config.features,
  });
}

/**
 * Helper para obter config de features
 * @param {string} featureName
 * @param {Object} [instanceConfig]
 * @returns {boolean}
 */
export function isFeatureEnabled(
  featureName,
  instanceConfig = DEFAULT_NETWORK_CONFIG,
) {
  return (
    instanceConfig.features?.[featureName] ??
    DEFAULT_NETWORK_CONFIG.features?.[featureName] ??
    false
  );
}

/**
 * Valida configuração de rede antes de usar
 * @param {Object} config
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateNetworkConfig(config) {
  const errors = [];

  if (!config?.adapter) {
    errors.push("adapter is required");
  }

  if (config.adapter === "websocket" && !config.websocket?.url) {
    errors.push("websocket.url is required for websocket adapter");
  }

  // Valida feature flags conhecidos
  const knownFeatures = Object.keys(DEFAULT_NETWORK_CONFIG.features);
  if (config.features) {
    for (const feature of Object.keys(config.features)) {
      if (!knownFeatures.includes(feature)) {
        console.warn(`[NetworkConfig] Unknown feature flag: ${feature}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
