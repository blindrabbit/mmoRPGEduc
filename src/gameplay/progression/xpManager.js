// =============================================================================
// xpManager.js — mmoRPGEduc
// Gerencia distribuição de XP de monstros para jogadores
//
// Responsabilidades:
// • Calcular XP baseado no level do monstro
// • Distribuir XP para quem causou dano (damage share)
// • Integrar com progressionSystem para level up
// =============================================================================

import { processXpGain } from "./progressionSystem.js";
import { worldEvents, EVENT_TYPES } from "../../core/events.js";

// Dano causado por jogador (para damage share)
// Map<monsterId, Map<playerId, { damage: number, lastHit: number }>>
const _damageDealt = new Map();

// Timeout para cleanup de dados de monstros mortos (5 minutos)
const DAMAGE_DATA_TIMEOUT = 5 * 60 * 1000;

/**
 * Registra dano causado por um jogador
 */
export function registerDamage(monsterId, playerId, damage) {
  if (!_damageDealt.has(monsterId)) {
    _damageDealt.set(monsterId, new Map());
  }
  const damageMap = _damageDealt.get(monsterId);
  const existing = damageMap.get(playerId) || {
    damage: 0,
    lastHit: Date.now(),
  };
  damageMap.set(playerId, {
    damage: existing.damage + damage,
    lastHit: Date.now(),
  });
}

/**
 * Registra último hit (para bonus de XP)
 */
export function registerLastHit(monsterId, playerId) {
  if (!_damageDealt.has(monsterId)) {
    _damageDealt.set(monsterId, new Map());
  }
  const damageMap = _damageDealt.get(monsterId);
  const existing = damageMap.get(playerId) || { damage: 0, lastHit: 0 };
  damageMap.set(playerId, {
    ...existing,
    lastHit: Date.now(),
  });
}

/**
 * Distribui XP quando monstro morre
 */
export async function distributeXpOnDeath(monsterId, monster, killerId) {
  const damageMap = _damageDealt.get(monsterId);

  // Calcular XP total do monstro
  const totalXp = calculateMonsterXp(monster);

  if (!damageMap || damageMap.size === 0) {
    // Ninguém causou dano registrado, XP vai pro killer
    await _awardXp(killerId, monster, totalXp, "monster_kill");
    _damageDealt.delete(monsterId);
    return;
  }

  // Calcular total de dano
  const totalDamage = Array.from(damageMap.values()).reduce(
    (sum, data) => sum + data.damage,
    0,
  );

  // Encontrar quem deu o último hit
  let lastHitter = killerId;
  let maxLastHit = 0;
  for (const [playerId, data] of damageMap.entries()) {
    if (data.lastHit > maxLastHit) {
      maxLastHit = data.lastHit;
      lastHitter = playerId;
    }
  }

  // Distribuir XP proporcionalmente ao dano causado
  const promises = [];
  for (const [playerId, data] of damageMap.entries()) {
    const share = data.damage / totalDamage;
    let xpToAward = Math.floor(totalXp * share);

    // Bonus de 20% XP para quem deu o último hit
    if (playerId === lastHitter) {
      xpToAward = Math.floor(xpToAward * 1.2);
    }

    if (xpToAward > 0) {
      promises.push(_awardXp(playerId, monster, xpToAward, "monster_share"));
    }
  }

  await Promise.all(promises);
  _damageDealt.delete(monsterId);
}

/**
 * Calcula XP base de um monstro
 */
export function calculateMonsterXp(monster) {
  const baseXp = monster.stats?.xpValue ?? 10;
  const levelMultiplier = monster.stats?.level ?? 1;
  const difficultyMultiplier = monster.stats?.elite ? 1.5 : 1.0;
  return Math.floor(baseXp * levelMultiplier * difficultyMultiplier);
}

/**
 * Concede XP a um jogador
 */
async function _awardXp(playerId, monster, xpAmount, source) {
  if (!playerId) return { success: false, error: "Player ID inválido" };

  try {
    const result = await processXpGain(playerId, xpAmount, source);

    if (result.success && result.leveledUp) {
      worldEvents.emit(EVENT_TYPES.PROGRESSION_LEVEL_UP, {
        playerId,
        newLevel: result.newLevel,
        monsterName: monster.name ?? monster.id,
        monsterXp: xpAmount,
        timestamp: Date.now(),
      });
    }

    return result;
  } catch (error) {
    console.error("[xpManager] Erro ao conceder XP:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Limpa dados de monstros antigos (chamar periodicamente)
 */
export function cleanupDamageData() {
  const now = Date.now();
  for (const [monsterId, damageMap] of _damageDealt.entries()) {
    let hasRecent = false;
    for (const data of damageMap.values()) {
      if (now - data.lastHit < DAMAGE_DATA_TIMEOUT) {
        hasRecent = true;
        break;
      }
    }
    if (!hasRecent) {
      _damageDealt.delete(monsterId);
    }
  }
}

/**
 * Obtém dados de dano de um monstro (para debug/admin)
 */
export function getDamageData(monsterId) {
  const damageMap = _damageDealt.get(monsterId);
  if (!damageMap) return null;

  const result = {};
  for (const [playerId, data] of damageMap.entries()) {
    result[playerId] = { ...data };
  }
  return result;
}

/**
 * Reseta dados de dano de um monstro
 */
export function resetDamageData(monsterId) {
  _damageDealt.delete(monsterId);
}
