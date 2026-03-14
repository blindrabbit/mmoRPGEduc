// =============================================================================
// runtimeConfig.js — Config operacional hot-reloadável via Firebase
//
// Permite ajustar parâmetros em tempo real sem reiniciar clientes/servidor.
//
// Estrutura Firebase:  world_config/runtime
//
// API:
//   RuntimeConfig.init(dbWatchFn, dbGetFn)  — conecta ao Firebase (boot)
//   RuntimeConfig.seed(dbGetFn, dbSetFn)    — preenche Firebase se vazio
//   RuntimeConfig.get(dotPath, fallback)    — leitura com fallback local
//   RuntimeConfig.snapshot()               — cópia completa mesclada
//   RuntimeConfig.onChange(fn)             — listener de mudança
//   RuntimeConfig.destroy()               — cleanup
//
// Nunca importa de db.js diretamente — recebe as funções via init()/seed().
// Isso evita dependência circular: db.js → config.js / runtimeConfig.js → db.js.
// =============================================================================

import { WORLD_SETTINGS, REGEN_RATES, REGEN_TICK_MS } from "./config.js";

// ─── Defaults (espelham os valores de config.js) ──────────────────────────────
// O Firebase sobrepõe apenas os campos que existirem em world_config/runtime.
// Qualquer campo ausente no Firebase usa o default abaixo.
export const RUNTIME_DEFAULTS = {
  // ── GC — intervalos e TTLs do Garbage Collector ─────────────────────────
  gc: {
    transientIntervalMs: WORLD_SETTINGS.gc.transientIntervalMs, // ms entre cada ciclo do GC
    mapClaimTtlMs: WORLD_SETTINGS.gc.mapClaimTtlMs, // tempo até uma claim expirar
    mapClaimSweepIntervalMs: WORLD_SETTINGS.gc.mapClaimSweepIntervalMs, // intervalo do sweep de claims
  },

  // ── Tick — cadência de processamento ─────────────────────────────────────
  tick: {
    worldTickMs: 250, // ms entre ticks da IA/mundo
    regenTickMs: REGEN_TICK_MS, // ms entre ticks de regeneração de HP/MP
  },

  // ── Itens — regras de interação no mundo ─────────────────────────────────
  items: {
    pickupRange: 2, // distância máx. para pegar item (tiles)
    dropRange: 15, // distância máx. para largar item (tiles)
    maxInventoryWeight: 500, // peso total máximo do inventário
    worldItemExpiry: 15 * 60 * 1000, // ms até item no chão expirar
    consumableCooldown: 1000, // ms de cooldown entre usos de consumível
    actionExpiresAfterMs: 5000, // ms até uma player_action ser descartada
  },

  // ── Morte — regras de respawn ─────────────────────────────────────────────
  death: {
    hpRecoveryMultiplier: WORLD_SETTINGS.death.hpRecoveryMultiplier,
    clearStatusOnDeath: WORLD_SETTINGS.death.clearStatusOnDeath,
    respawnDelayPlayer: WORLD_SETTINGS.death.respawnDelayPlayer, // ms antes do teleporte
  },

  // ── Regeneração — taxas base por classe ──────────────────────────────────
  regen: {
    rates: Object.fromEntries(
      Object.entries(REGEN_RATES).map(([cls, r]) => [cls, { ...r }]),
    ),
  },

  // ── Feature flags — liga/desliga comportamentos sem deploy ───────────────
  features: {
    enableMapClaimGC: true, // GC varre e remove claims antigas
    enableStrictInventoryPreconditions: true, // valida slot no DB antes de mover
    enableWallBypassForGM: true, // GM/WorldEngine ignora paredes
  },

  // ── Limites de segurança ──────────────────────────────────────────────────
  limits: {
    maxInventoryWeight: 500,
    maxPlayers: 50,
  },
};

// ─── Estado interno ───────────────────────────────────────────────────────────
let _live = _deepClone(RUNTIME_DEFAULTS);
const _listeners = new Set();
let _unsubscribe = null;

function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function _deepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  const result = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      result[k] = _deepMerge(result[k] ?? {}, v);
    } else if (v !== null && v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

function _applyRemote(remote) {
  const prev = JSON.stringify(_live);
  _live = _deepMerge(_deepClone(RUNTIME_DEFAULTS), remote ?? {});
  if (JSON.stringify(_live) !== prev) {
    for (const fn of _listeners) {
      try {
        fn(_deepClone(_live));
      } catch (_) {}
    }
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────
export const RuntimeConfig = {
  /**
   * Conecta ao Firebase e escuta world_config/runtime para hot reload.
   * Deve ser chamado uma vez no boot (antes de initServices).
   * @param {function} dbWatchFn — ex: dbWatch de firebaseClient
   * @param {function} [dbGetFn] — mantido para consistência futura
   */
  init(dbWatchFn, _dbGetFn) {
    if (_unsubscribe) _unsubscribe();
    _unsubscribe = dbWatchFn("world_config/runtime", (data) => {
      _applyRemote(data);
    });
  },

  /**
   * Grava os defaults em world_config/runtime apenas se o nó estiver vazio.
   * Garante que o Firebase tenha valores editáveis desde a primeira sessão.
   * @param {function} dbGetFn
   * @param {function} dbSetFn
   */
  async seed(dbGetFn, dbSetFn) {
    try {
      const existing = await dbGetFn("world_config/runtime");
      if (
        existing &&
        typeof existing === "object" &&
        Object.keys(existing).length > 0
      ) {
        return;
      }
      await dbSetFn("world_config/runtime", _deepClone(RUNTIME_DEFAULTS));
      console.info(
        "[RuntimeConfig] Defaults semeados em world_config/runtime.",
      );
    } catch (err) {
      console.warn(
        "[RuntimeConfig] Falha ao semear defaults:",
        err?.message ?? err,
      );
    }
  },

  /**
   * Lê um valor via notação de ponto, com fallback.
   * Exemplos:
   *   RuntimeConfig.get("gc.mapClaimTtlMs")
   *   RuntimeConfig.get("features.enableMapClaimGC")
   *   RuntimeConfig.get("regen.rates.cavaleiro")
   *
   * @param {string} dotPath — notação de ponto para acesso aninhado
   * @param {*} [fallback]   — retornado se o caminho não existir (default: undefined)
   * @returns {*}
   */
  get(dotPath, fallback = undefined) {
    const parts = String(dotPath).split(".");
    let cur = _live;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return fallback;
      cur = cur[part];
    }
    return cur !== undefined && cur !== null ? cur : fallback;
  },

  /**
   * Retorna cópia completa da config mesclada atual (Firebase + defaults).
   * @returns {object}
   */
  snapshot() {
    return _deepClone(_live);
  },

  /**
   * Registra um callback chamado toda vez que a config mudar via hot reload.
   * @param {function} fn — recebe snapshot completo do novo estado
   * @returns {function} unsubscribe
   */
  onChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  /**
   * Para o watcher Firebase e limpa listeners. Chamar no destroy() do cliente.
   */
  destroy() {
    if (_unsubscribe) _unsubscribe();
    _unsubscribe = null;
    _listeners.clear();
    _live = _deepClone(RUNTIME_DEFAULTS);
  },
};
