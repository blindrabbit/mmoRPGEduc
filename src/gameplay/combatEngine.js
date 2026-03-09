// =============================================================================
// combatEngine.js — mmoRPGGame
// Lógica de combate e stats + textos flutuantes.
// FASE IMEDIATA: zero firebaseClient. Dano escrito via db.js (applyHpToPlayer).
// Depende de: db.js, worldStore.js
// =============================================================================

import { applyHpToPlayer } from "../core/db.js";
import { calculateCombatResult as calculateCombatResultByRules } from "./combatLogic.js";

// ---------------------------------------------------------------------------
// ESTADO INTERNO
// ---------------------------------------------------------------------------
let floatingTexts = null; // referência ao array do gameCore, injetada via init
const statsCache = { players: {}, monsters: {} };
const recentDeltas = new Map();
const RECENT_WINDOW_MS = 260;
const TIBIA_TEXT = {
  damage: {
    color: "#ff4040",
    duration: 900,
    font: "bold 13px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 34,
    driftX: 0,
  },
  heal: {
    color: "#40ff70",
    duration: 1000,
    font: "bold 12px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 28,
    driftX: 0,
  },
  miss: {
    color: "#f5f5f5",
    duration: 750,
    font: "bold 11px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 20,
    driftX: 0,
  },
  status: {
    color: "#f1c40f",
    duration: 800,
    font: "bold 11px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 18,
    driftX: 0,
  },
};

export const COMBAT_EFFECT_PRESETS = {
  attackHit: {
    effectId: 1,
    spriteId: 187376,
    duration: 700,
  },
  attackMiss: {
    effectId: 3,
    spriteId: 187394,
    duration: 700,
  },
  burning: {
    effectId: null,
    spriteId: null,
    duration: 900,
  },
  electrified: {
    effectId: null,
    spriteId: null,
    duration: 900,
  },
  poisoned: {
    effectId: null,
    spriteId: null,
    duration: 900,
  },
};

export function getCombatEffectPreset(key) {
  return COMBAT_EFFECT_PRESETS[key] ?? null;
}

export function buildCombatEffectPayload(
  key,
  { id, x, y, z = 7, now = Date.now(), duration },
) {
  const preset = getCombatEffectPreset(key);
  if (!preset || preset.effectId == null) return null;

  const finalDuration = Number(duration ?? preset.duration ?? 700);
  return {
    id: String(id),
    type: "effect",
    effectType: key,
    effectId: Number(preset.effectId),
    sourceSpriteId: Number(preset.spriteId),
    x: Number(x),
    y: Number(y),
    z: Number(z),
    startTime: Number(now),
    effectDuration: finalDuration,
    expiry: Number(now + finalDuration),
    isField: false,
  };
}

function nowMs() {
  return Date.now();
}

function markRecentDelta(type, id, delta) {
  recentDeltas.set(`${type}:${id}:${Math.round(delta)}`, nowMs());
}

function wasRecentDelta(type, id, delta) {
  const key = `${type}:${id}:${Math.round(delta)}`;
  const ts = recentDeltas.get(key);
  if (!ts) return false;
  if (nowMs() - ts > RECENT_WINDOW_MS) {
    recentDeltas.delete(key);
    return false;
  }
  return true;
}

function pushFloatingText(payload) {
  if (!floatingTexts) return;
  floatingTexts.push({
    x: Number(payload.x ?? 0),
    y: Number(payload.y ?? 0),
    text: String(payload.text ?? ""),
    color: payload.color ?? "#ffffff",
    startTime: payload.startTime ?? nowMs(),
    duration: Number(payload.duration ?? TIBIA_TEXT.damage.duration),
    font: payload.font ?? TIBIA_TEXT.damage.font,
    strokeStyle: payload.strokeStyle ?? "black",
    strokeWidth: Number(payload.strokeWidth ?? TIBIA_TEXT.damage.strokeWidth),
    rise: Number(payload.rise ?? TIBIA_TEXT.damage.rise),
    driftX: Number(payload.driftX ?? 0),
  });
}

export function emitCombatText(entity, text, options = {}) {
  if (!entity) return;
  pushFloatingText({
    x: entity.x,
    y: entity.y,
    text,
    ...options,
  });
}

export function emitHpDeltaText(type, entityId, entity, delta, options = {}) {
  if (!entity || !delta) return;
  markRecentDelta(type, entityId, delta);
  const isDamage = delta < 0;
  const amount = Math.round(Math.abs(delta));
  const style = isDamage ? TIBIA_TEXT.damage : TIBIA_TEXT.heal;
  pushFloatingText({
    x: entity.x,
    y: entity.y,
    text: isDamage ? `${amount}` : `+${amount}`,
    ...style,
    ...options,
  });
}

export function emitMissText(entity, options = {}) {
  emitCombatText(entity, "MISS", { ...TIBIA_TEXT.miss, ...options });
}

export function emitStatusText(entity, label, options = {}) {
  emitCombatText(entity, String(label || "STATUS").toUpperCase(), {
    ...TIBIA_TEXT.status,
    ...options,
  });
}

/**
 * Injeta a referência ao floatingTexts e getters do worldStore.
 * Chamado UMA vez no boot de cada tela.
 */
export function initCombatEngine(floatingTextsRef, _getMonsters, _getPlayers) {
  floatingTexts = floatingTextsRef;
}

// ---------------------------------------------------------------------------
// CÁLCULO DE COMBATE — puro, sem I/O
// ---------------------------------------------------------------------------

/**
 * Calcula o resultado de um ataque (hit/miss + dano).
 * @param {{ atk, agi }} atkS  stats do atacante
 * @param {{ def, agi }} defS  stats do defensor
 * @returns {{ hit: boolean, damage: number }}
 */
export function calculateCombatResult(atkS, defS) {
  return calculateCombatResultByRules(atkS, defS);
}

// ---------------------------------------------------------------------------
// APLICAÇÃO DE DANO — delega para db.js
// ---------------------------------------------------------------------------

/**
 * Aplica dano/cura a um player.
 * Mantido para compatibilidade com código legado (admin.html healAll).
 * @param {string} playerId
 * @param {number} amount  positivo = dano, negativo = cura
 */
export async function applyDamage(playerId, amount) {
  // Lê HP atual do cache (evita leitura desnecessária do Firebase)
  const cached = statsCache.players[playerId];
  const currentHp = cached?.hp ?? 100;
  const maxHp = cached?.maxHp ?? 100;
  const newHp = Math.max(0, Math.min(maxHp, currentHp - amount));
  await applyHpToPlayer(playerId, newHp);
}

// ---------------------------------------------------------------------------
// MUDANÇAS DE STATS — gera textos flutuantes
// ---------------------------------------------------------------------------

/**
 * Detecta mudanças de HP e empurra textos flutuantes para o gameCore.
 * @param {'players'|'monsters'} type
 * @param {Object} newData  snapshot do worldStore
 */
export function handleStatsChanges(type, newData) {
  if (!newData || !floatingTexts) return;
  for (const id in newData) {
    const ent = newData[id];
    if (!ent?.stats) continue;
    if (!statsCache[type]) statsCache[type] = {};
    const old = statsCache[type][id];
    if (old && old.hp !== ent.stats.hp) {
      const diff = ent.stats.hp - old.hp;
      if (!wasRecentDelta(type, id, diff)) {
        emitHpDeltaText(type, id, ent, diff);
      }
    }
    statsCache[type][id] = { ...ent.stats };
  }
}
