// =============================================================================
// combatEngine.js — mmoRPGGame (FASE 2 — Delegado)
//
// Este módulo agora é uma fachada fina:
//   • Presets e buildCombatEffectPayload → delegados a combatService.js
//   • applyDamage (compat) → usa statsCache local para admin/legado
//   • handleStatsChanges → detecta deltas de HP do Firebase e emite eventos
//   • calculateCombatResult → re-exporta de combatLogic.js (compat)
//   • initCombatEngine → no-op (mantido para não quebrar boots existentes)
//
// Para novo código, prefira importar diretamente de:
//   src/gameplay/combat/combatService.js
//
// Dependências: core/events.js, core/db.js, gameplay/combatLogic.js,
//               gameplay/combat/combatService.js
// =============================================================================

import { applyHpToPlayer } from "../core/db.js";
import { calculateCombatResult as calculateCombatResultByRules } from "./combatLogic.js";
import { worldEvents, EVENT_TYPES } from "../core/events.js";

// ---------------------------------------------------------------------------
// RE-EXPORTS DE COMPAT — presets e builder agora vivem no combatService
// ---------------------------------------------------------------------------
export {
  COMBAT_EFFECT_PRESETS,
  getCombatEffectPreset,
  buildCombatEffectPayload,
} from "./combat/combatService.js";

// ---------------------------------------------------------------------------
// ESTADO INTERNO (statsCache — usado por handleStatsChanges e applyDamage)
// ---------------------------------------------------------------------------
const statsCache = { players: {}, monsters: {} };
const recentDeltas = new Map();
const RECENT_WINDOW_MS = 260;

// ---------------------------------------------------------------------------
// INIT — mantido para compatibilidade (no-op)
// ---------------------------------------------------------------------------

/**
 * @deprecated floatingTextsRef não é mais necessário.
 * Mantido para não quebrar chamadas existentes no boot.
 */
export function initCombatEngine(_floatingTextsRef, _getMonsters, _getPlayers) {
  // no-op: textos flutuantes agora são gerenciados por CombatTextRenderer
  //        ou por combatText.js no cliente.
}

// ---------------------------------------------------------------------------
// CÁLCULO DE COMBATE — re-export de compat
// ---------------------------------------------------------------------------

export function calculateCombatResult(atkS, defS) {
  return calculateCombatResultByRules(atkS, defS);
}

// ---------------------------------------------------------------------------
// APLICAÇÃO DE DANO — legado/admin (usa statsCache)
// Para novo código prefira combatService.applyPlayerDamage(playerId, dmg, player)
// ---------------------------------------------------------------------------

export async function applyDamage(playerId, amount) {
  const cached = statsCache.players[playerId];
  const currentHp = cached?.hp ?? 100;
  const maxHp = cached?.maxHp ?? 100;
  const newHp = Math.max(0, Math.min(maxHp, currentHp - amount));
  await applyHpToPlayer(playerId, newHp);
}

// ---------------------------------------------------------------------------
// HELPERS INTERNOS
// ---------------------------------------------------------------------------

function nowMs() { return Date.now(); }

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

// ---------------------------------------------------------------------------
// MUDANÇAS DE STATS — detecta deltas HP do Firebase → emite eventos
// ---------------------------------------------------------------------------

/**
 * Detecta mudanças de HP no snapshot do worldStore e emite eventos.
 * Chamado pelo cliente a cada sync do Firebase.
 *
 * @param {'players'|'monsters'} type
 * @param {Object} newData  snapshot do worldStore
 */
export function handleStatsChanges(type, newData) {
  if (!newData) return;

  for (const id in newData) {
    const ent = newData[id];
    if (!ent?.stats) continue;
    if (!statsCache[type]) statsCache[type] = {};

    const old = statsCache[type][id];
    if (old && old.hp !== ent.stats.hp) {
      const diff = ent.stats.hp - old.hp; // positivo = cura, negativo = dano

      if (!wasRecentDelta(type, id, diff)) {
        markRecentDelta(type, id, diff);

        if (diff < 0) {
          worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
            defenderId: id,
            defenderType: type,
            damage: Math.abs(diff),
            defenderX: ent.x,
            defenderY: ent.y,
            defenderZ: ent.z ?? 7,
          });
        } else {
          worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
            defenderId: id,
            defenderType: type,
            damage: -diff,
            isHeal: true,
            defenderX: ent.x,
            defenderY: ent.y,
            defenderZ: ent.z ?? 7,
          });
        }

        if (ent.stats.hp <= 0) {
          worldEvents.emit(EVENT_TYPES.COMBAT_KILL, {
            victimId: id,
            victimType: type,
            victimX: ent.x,
            victimY: ent.y,
            victimZ: ent.z ?? 7,
          });
        }
      }
    }

    statsCache[type][id] = { ...ent.stats };
  }
}
