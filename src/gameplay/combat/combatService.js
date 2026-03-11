// =============================================================================
// combatService.js — mmoRPGEduc
// Camada autoritativa de combate - emite eventos, não manipula UI
//
// Responsabilidades:
// • Validar ações de ataque (autoritativo)
// • Calcular dano usando combatLogic (puro)
// • Aplicar mudanças no worldStore/db
// • Emitir eventos para clientes via worldEvents
// • Registrar dano para sistema de XP
// =============================================================================

import {
  calculateCombatResult,
  calculateNewHp,
  calculateFinalDamage,
  COMBAT,
} from "../combatLogic.js";
import { worldEvents, EVENT_TYPES } from "../../core/events.js";
import { applyHpToPlayer, applyHpToMonster } from "../../core/db.js";
import {
  getMonsters,
  getPlayers,
  applyMonstersLocal,
  applyPlayersLocal,
} from "../../core/worldStore.js";
import { registerDamage, registerLastHit } from "../progression/xpManager.js";
import {
  calculateTotalStats,
  getAttackPower,
  getCritChance,
  getDefense,
} from "../progression/progressionSystem.js";

// =============================================================================
// COMBAT EFFECT PRESETS
// =============================================================================
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

/**
 * Obter preset de efeito de combate
 * @param {string} key - Chave do preset (attackHit, burning, etc)
 * @returns {Object|null} Dados do preset ou null se não encontrado
 */
export function getCombatEffectPreset(key) {
  return COMBAT_EFFECT_PRESETS[key] ?? null;
}

function getEntityAgility(entity, entityType) {
  if (entityType === "player") {
    return calculateTotalStats(entity).totalStats.AGI;
  }
  return entity?.stats?.AGI ?? entity?.stats?.agi ?? 5;
}

function getEntityAttackPower(entity, entityType) {
  if (entityType === "player") {
    return getAttackPower(entity);
  }

  if (entity?.stats?.atk != null) {
    return entity.stats.atk;
  }

  const strength = entity?.stats?.FOR ?? 5;
  const intellect = entity?.stats?.INT ?? 0;
  return Math.round(strength * 1.5 + intellect * 0.5);
}

function getEntityDefensePower(entity, entityType) {
  if (entityType === "player") {
    return getDefense(entity, entity?.stats?.def ?? 0);
  }

  if (entity?.stats?.def != null) {
    return entity.stats.def;
  }

  const vitality = entity?.stats?.VIT ?? 5;
  const agility = entity?.stats?.AGI ?? entity?.stats?.agi ?? 5;
  return Math.round(vitality * 0.6 + agility * 0.2);
}

// =============================================================================
// FUNÇÕES PRINCIPAIS
// =============================================================================

/**
 * Processa um ataque autoritativo no servidor
 */
export async function processAttack({
  attackerId,
  defenderId,
  attackerType,
  defenderType,
  options = {},
}) {
  // Obter dados das entidades
  const attacker =
    attackerType === "player"
      ? getPlayers()[attackerId]
      : getMonsters()[attackerId];
  const defender =
    defenderType === "player"
      ? getPlayers()[defenderId]
      : getMonsters()[defenderId];

  if (!attacker || !defender) {
    return { success: false, error: "Entity not found" };
  }

  // Calcular stats de ataque/defesa com atributos
  const atkStats = {
    atk: attacker.stats?.atk ?? getEntityAttackPower(attacker, attackerType),
    attackPower: getEntityAttackPower(attacker, attackerType),
    agi: attacker.stats?.agi ?? getEntityAgility(attacker, attackerType),
    agility: getEntityAgility(attacker, attackerType),
    level: attacker.stats?.level ?? 1,
    ...(attackerType === "player"
      ? {
          critChance: getCritChance(attacker),
        }
      : {}),
  };

  const defStats = {
    def: defender.stats?.def ?? getEntityDefensePower(defender, defenderType),
    defense: getEntityDefensePower(defender, defenderType),
    agi: defender.stats?.agi ?? getEntityAgility(defender, defenderType),
    agility: getEntityAgility(defender, defenderType),
    level: defender.stats?.level ?? 1,
  };

  // Calcular resultado do combate (função pura)
  const combatResult = calculateCombatResult(atkStats, defStats);

  if (!combatResult.hit) {
    // Emitir evento de MISS
    worldEvents.emit(EVENT_TYPES.COMBAT_MISS, {
      attackerId,
      defenderId,
      attackerType,
      defenderType,
      hitChance: combatResult.hitChance,
      timestamp: Date.now(),
    });
    return { success: true, damage: 0, killed: false, missed: true };
  }

  // Calcular dano final
  let damage = combatResult.damage;

  // Aplicar atributos do atacante
  if (attackerType === "player") {
    const attackPower = getAttackPower(attacker);
    damage = Math.floor(damage * (1 + attackPower / 100));

    // Verificar crítico
    const critChance = getCritChance(attacker);
    if (Math.random() < critChance) {
      damage = Math.floor(damage * 1.5);
      options.isCritical = true;
    }
  }

  if (options.bonusDamage) damage += options.bonusDamage;
  if (options.isCritical) damage = Math.floor(damage * 1.5);

  // Aplicar dano ao defensor
  const currentHp = defender.stats?.hp ?? 100;
  const maxHp = defender.stats?.maxHp ?? 100;
  const newHp = calculateNewHp(currentHp, -damage, maxHp);
  const killed = newHp <= 0;

  // Atualizar no Firebase e no worldStore local
  if (defenderType === "player") {
    await applyHpToPlayer(defenderId, newHp);
    applyPlayersLocal(defenderId, { stats: { ...defender.stats, hp: newHp } });
  } else {
    await applyHpToMonster(defenderId, newHp);
    applyMonstersLocal(defenderId, {
      stats: { ...defender.stats, hp: newHp },
      ...(attackerType === "player" ? { lastHitBy: attackerId } : {}),
    });

    // Registrar dano para XP (apenas em monstros)
    if (attackerType === "player" && damage > 0) {
      registerDamage(defenderId, attackerId, damage);
      if (killed) {
        registerLastHit(defenderId, attackerId);
      }
    }
  }

  // Emitir evento de dano (cliente decide como mostrar)
  worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
    attackerId,
    defenderId,
    attackerType,
    defenderType,
    damage,
    isCritical: !!options.isCritical,
    defenderX: defender.x,
    defenderY: defender.y,
    defenderZ: defender.z,
    newHp,
    killed,
    timestamp: Date.now(),
  });

  // Se matou, emitir evento de kill
  if (killed) {
    worldEvents.emit(EVENT_TYPES.COMBAT_KILL, {
      attackerId,
      defenderId,
      defenderType,
      xpGranted: defender.stats?.xpValue ?? 10,
      timestamp: Date.now(),
    });
  }

  return { success: true, damage, killed, combatResult };
}

/**
 * Aplica dano direto (para magias, campos, etc.)
 */
export async function applyDirectDamage({
  targetId,
  targetType,
  damage,
  damageType = "physical",
  sourceId = null,
}) {
  const target =
    targetType === "player" ? getPlayers()[targetId] : getMonsters()[targetId];

  if (!target) return { success: false, error: "Target not found" };

  // Aplicar atributos do source se for jogador
  if (sourceId && targetType === "monster") {
    const source = getPlayers()[sourceId];
    if (source) {
      const spellPower = source.stats?.spellPower ?? 0;
      if (spellPower > 0) {
        damage = Math.floor(damage * (1 + spellPower / 100));
      }
    }
  }

  const currentHp = target.stats?.hp ?? 100;
  const maxHp = target.stats?.maxHp ?? 100;
  const newHp = calculateNewHp(currentHp, -damage, maxHp);
  const killed = newHp <= 0;

  if (targetType === "player") {
    await applyHpToPlayer(targetId, newHp);
    applyPlayersLocal(targetId, { stats: { ...target.stats, hp: newHp } });
  } else {
    await applyHpToMonster(targetId, newHp);
    applyMonstersLocal(targetId, {
      stats: { ...target.stats, hp: newHp },
      ...(sourceId ? { lastHitBy: sourceId } : {}),
    });

    // Registrar dano para XP
    if (sourceId && damage > 0) {
      registerDamage(targetId, sourceId, damage);
      if (killed) {
        registerLastHit(targetId, sourceId);
      }
    }
  }

  worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
    attackerId: sourceId,
    defenderId: targetId,
    defenderType: targetType,
    damage,
    damageType,
    defenderX: target.x,
    defenderY: target.y,
    defenderZ: target.z,
    newHp,
    killed,
    isDirectDamage: true,
    timestamp: Date.now(),
  });

  return { success: true, newHp, killed };
}

/**
 * Cura uma entidade
 */
export async function applyHeal({ targetId, targetType, healAmount }) {
  const target =
    targetType === "player" ? getPlayers()[targetId] : getMonsters()[targetId];

  if (!target) return { success: false, error: "Target not found" };

  // Aplicar poder de cura se for jogador
  if (targetType === "player") {
    const healPower = target.stats?.healPower ?? 0;
    if (healPower > 0) {
      healAmount = Math.floor(healAmount * (1 + healPower / 100));
    }
  }

  const currentHp = target.stats?.hp ?? 100;
  const maxHp = target.stats?.maxHp ?? 100;
  const newHp = calculateNewHp(currentHp, healAmount, maxHp);

  if (targetType === "player") {
    await applyHpToPlayer(targetId, newHp);
    applyPlayersLocal(targetId, { stats: { ...target.stats, hp: newHp } });
  } else {
    await applyHpToMonster(targetId, newHp);
    applyMonstersLocal(targetId, { stats: { ...target.stats, hp: newHp } });
  }

  worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
    defenderId: targetId,
    defenderType: targetType,
    damage: -healAmount, // negativo = cura
    defenderX: target.x,
    defenderY: target.y,
    defenderZ: target.z,
    newHp,
    isHeal: true,
    timestamp: Date.now(),
  });

  return { success: true, newHp };
}

/**
 * Helper para emitir evento de dano (usado por fieldSystem)
 */
export function emitDamage(targetId, targetType, damage, target, options = {}) {
  if (!target) return;

  worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
    attackerId: options.attackerId,
    defenderId: targetId,
    defenderType: targetType,
    damage,
    damageType: options.element || "physical",
    defenderX: target.x,
    defenderY: target.y,
    defenderZ: target.z ?? 7,
    isFieldDamage: options.isFieldDamage ?? false,
    timestamp: Date.now(),
  });
}

/**
 * Helper para emitir evento de cura
 */
export function emitHeal(targetId, targetType, healAmount, target) {
  if (!target) return;

  worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
    defenderId: targetId,
    defenderType: targetType,
    damage: -healAmount,
    defenderX: target.x,
    defenderY: target.y,
    defenderZ: target.z ?? 7,
    isHeal: true,
    timestamp: Date.now(),
  });
}

/**
 * Resolve ataque físico (wrapper para processAttack)
 */
export function resolveAttack(
  attackerId,
  attacker,
  targetId,
  target,
  options = {},
) {
  const attackerType =
    options.attackerType ??
    (attacker?.type === "monster" ? "monster" : "player");
  const defenderType =
    options.defenderType ?? (target?.type === "monster" ? "monster" : "player");

  return processAttack({
    attackerId,
    defenderId: targetId,
    attackerType,
    defenderType,
    ...options,
  });
}

/**
 * Build de payload de efeito de combate
 */
export function buildCombatEffectPayload({
  effectId,
  x,
  y,
  z,
  duration,
  startTime,
}) {
  const t = startTime ?? Date.now();
  const d = Number(duration ?? 800);
  return {
    id: String(effectId),
    type: "effect",
    effectId: Number(effectId),
    x: Number(x),
    y: Number(y),
    z: Number(z ?? 7),
    startTime: t,
    effectDuration: d,
    expiry: t + d,
    isField: false,
  };
}
