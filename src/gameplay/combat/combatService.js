// =============================================================================
// combatService.js — mmoRPGEduc (FASE 2)
//
// RESPONSABILIDADE: Camada de serviço de combate.
//   • Centraliza lógica de hit/miss, dano, cura e dano de campo
//   • Emite eventos padronizados (worldEvents) — nunca toca em UI
//   • Retorna payload de updates Firebase para o chamador fazer batchWrite
//   • Elimina duplicação entre actionProcessor.js e monsterManager.js
//
// Regras:
//   ✅ Pode importar: core/db.js, core/events.js, gameplay/combatLogic.js
//   ❌ Nunca importa: render/, clients/, floatingTexts, canvas
//
// Dependências:
//   core/events.js, core/db.js, gameplay/combatLogic.js
// =============================================================================

import { applyHpToPlayer } from "../../core/db.js";
import { worldEvents, EVENT_TYPES } from "../../core/events.js";
import {
  calculateCombatResult,
  calculateNewHp,
  calculateFinalDamage,
} from "../combatLogic.js";

// =============================================================================
// PRESETS DE EFEITOS VISUAIS (dados puros — sem UI)
// Movidos de combatEngine.js para cá, onde pertencem logicamente.
// =============================================================================

export const COMBAT_EFFECT_PRESETS = {
  attackHit: { effectId: 1, spriteId: 187376, duration: 700 },
  attackMiss: { effectId: 3, spriteId: 187394, duration: 700 },
  burning: { effectId: null, spriteId: null, duration: 900 },
  electrified: { effectId: null, spriteId: null, duration: 900 },
  poisoned: { effectId: null, spriteId: null, duration: 900 },
};

/**
 * Obtém preset de efeito de combate pelo nome.
 * @param {string} key
 * @returns {Object|null}
 */
export function getCombatEffectPreset(key) {
  return COMBAT_EFFECT_PRESETS[key] ?? null;
}

/**
 * Constrói payload de efeito visual para Firebase (world_effects).
 * @param {string} key - Chave do preset (ex: 'attackHit')
 * @param {{ id, x, y, z?, now?, duration? }} opts
 * @returns {Object|null}
 */
export function buildCombatEffectPayload(key, { id, x, y, z = 7, now = Date.now(), duration }) {
  const preset = getCombatEffectPreset(key);
  if (!preset || preset.effectId == null) return null;

  const d = Number(duration ?? preset.duration ?? 700);
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
    effectDuration: d,
    expiry: Number(now + d),
    isField: false,
  };
}

// =============================================================================
// RESOLUÇÃO DE ATAQUE FÍSICO
// =============================================================================

/**
 * Processa o resultado de um ataque físico entre dois combatentes.
 *
 * Calcula hit/miss, dano, emite eventos e retorna os dados necessários
 * para o chamador persistir no Firebase (via batchWrite).
 *
 * Não faz I/O de rede — é responsabilidade do chamador.
 *
 * @param {string} attackerId
 * @param {Object} attacker - Snapshot do atacante { stats, x, y, z }
 * @param {string} defenderId
 * @param {Object} defender - Snapshot do defensor { stats, x, y, z }
 * @param {Object} [options]
 * @param {'players'|'monsters'} [options.defenderType='monsters']
 * @param {number} [options.now]
 * @param {string} [options.spellId] - Se vier de magia, passa para o evento
 * @returns {{
 *   hit: boolean,
 *   damage: number,
 *   newHp: number,
 *   fxId: string,
 *   fxPayload: Object|null
 * }}
 */
export function resolveAttack(attackerId, attacker, defenderId, defender, options = {}) {
  const defenderType = options.defenderType ?? "monsters";
  const now = options.now ?? Date.now();

  const result = calculateCombatResult(attacker.stats, defender.stats);

  if (result.hit) {
    const dmg = calculateFinalDamage
      ? calculateFinalDamage(result.damage ?? 0, result)
      : (result.damage ?? 0);
    const newHp = calculateNewHp(defender.stats.hp, -dmg, defender.stats.maxHp);

    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      attackerId,
      defenderId,
      defenderType,
      damage: dmg,
      isCritical: result.critical ?? false,
      spellId: options.spellId ?? null,
      defenderX: defender.x,
      defenderY: defender.y,
      defenderZ: defender.z ?? 7,
    });

    if (newHp <= 0) {
      worldEvents.emit(EVENT_TYPES.COMBAT_KILL, {
        attackerId,
        victimId: defenderId,
        victimType: defenderType,
        victimX: defender.x,
        victimY: defender.y,
        victimZ: defender.z ?? 7,
      });
    }

    const fxId = `hit_${attackerId}_${defenderId}_${now}`;
    const fxPayload = buildCombatEffectPayload("attackHit", {
      id: fxId, x: defender.x, y: defender.y, z: defender.z ?? 7, now,
    });

    return { hit: true, damage: dmg, newHp, fxId, fxPayload };
  } else {
    worldEvents.emit(EVENT_TYPES.COMBAT_MISS, {
      attackerId,
      defenderX: defender.x,
      defenderY: defender.y,
      defenderZ: defender.z ?? 7,
    });

    const fxId = `miss_${attackerId}_${defenderId}_${now}`;
    const fxPayload = buildCombatEffectPayload("attackMiss", {
      id: fxId, x: defender.x, y: defender.y, z: defender.z ?? 7, now,
    });

    return { hit: false, damage: 0, newHp: defender.stats.hp, fxId, fxPayload };
  }
}

// =============================================================================
// DANO DIRETO (spells, campos, etc.)
// =============================================================================

/**
 * Emite evento de dano para uma entidade.
 * NÃO persiste no Firebase — o chamador faz batchWrite.
 *
 * @param {string} entityId
 * @param {'players'|'monsters'} entityType
 * @param {number} damage - Valor positivo de dano
 * @param {Object} entity - Snapshot { stats, x, y, z }
 * @param {Object} [options]
 * @param {string} [options.attackerId]
 * @param {boolean} [options.isCritical]
 * @param {boolean} [options.isFieldDamage]
 * @param {string} [options.element]
 * @param {string} [options.spellId]
 * @returns {number} novo HP calculado
 */
export function emitDamage(entityId, entityType, damage, entity, options = {}) {
  const newHp = Math.max(0, (entity.stats?.hp ?? 0) - damage);

  worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
    attackerId: options.attackerId ?? null,
    defenderId: entityId,
    defenderType: entityType,
    damage,
    isCritical: options.isCritical ?? false,
    isFieldDamage: options.isFieldDamage ?? false,
    element: options.element ?? null,
    spellId: options.spellId ?? null,
    defenderX: entity.x,
    defenderY: entity.y,
    defenderZ: entity.z ?? 7,
  });

  if (newHp <= 0) {
    worldEvents.emit(EVENT_TYPES.COMBAT_KILL, {
      attackerId: options.attackerId ?? null,
      victimId: entityId,
      victimType: entityType,
      victimX: entity.x,
      victimY: entity.y,
      victimZ: entity.z ?? 7,
    });
  }

  return newHp;
}

/**
 * Emite evento de cura para uma entidade.
 * NÃO persiste no Firebase — o chamador faz applyHpToPlayer / batchWrite.
 *
 * @param {string} entityId
 * @param {'players'|'monsters'} entityType
 * @param {number} healAmount - Valor positivo de cura
 * @param {Object} entity - Snapshot { stats, x, y, z }
 * @returns {number} novo HP calculado
 */
export function emitHeal(entityId, entityType, healAmount, entity) {
  const newHp = Math.min(entity.stats?.maxHp ?? 100, (entity.stats?.hp ?? 0) + healAmount);

  worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
    defenderId: entityId,
    defenderType: entityType,
    damage: -healAmount,
    isHeal: true,
    defenderX: entity.x,
    defenderY: entity.y,
    defenderZ: entity.z ?? 7,
  });

  return newHp;
}

// =============================================================================
// DANO DE CAMPO (Field damage tick)
// =============================================================================

/**
 * Processa um tick de dano de campo em uma entidade.
 * Aplica resistência elemental e emite evento.
 * NÃO persiste no Firebase.
 *
 * @param {Object} field - { damage, element, x, y, z, ownerId }
 * @param {string} entityId
 * @param {'players'|'monsters'} entityType
 * @param {Object} entity - Snapshot { stats, x, y, z }
 * @returns {number} novo HP calculado
 */
export function processFieldTick(field, entityId, entityType, entity) {
  const baseDamage = field.damage ?? 0;
  if (baseDamage <= 0) return entity.stats?.hp ?? 0;

  // Resistência elemental (se a entidade tiver)
  const resistance = entity.stats?.resistances?.[field.element] ?? 1.0;
  const finalDamage = Math.max(1, Math.round(baseDamage * resistance));

  return emitDamage(entityId, entityType, finalDamage, entity, {
    attackerId: field.ownerId ?? null,
    isFieldDamage: true,
    element: field.element ?? null,
  });
}

// =============================================================================
// APLICAÇÃO DIRETA DE DANO A PLAYER (usa DB + emite evento)
// Para compatibilidade com admin e fluxos onde temos a entidade disponível.
// =============================================================================

/**
 * Aplica dano a um player diretamente no Firebase e emite evento.
 * @param {string} playerId
 * @param {number} damage
 * @param {Object} player - Snapshot com stats e posição
 * @param {Object} [options]
 * @returns {Promise<number>} novo HP
 */
export async function applyPlayerDamage(playerId, damage, player, options = {}) {
  const newHp = emitDamage(playerId, "players", damage, player, options);
  await applyHpToPlayer(playerId, newHp);
  return newHp;
}

/**
 * Aplica cura a um player diretamente no Firebase e emite evento.
 * @param {string} playerId
 * @param {number} heal
 * @param {Object} player - Snapshot com stats e posição
 * @returns {Promise<number>} novo HP
 */
export async function applyPlayerHeal(playerId, heal, player) {
  const newHp = emitHeal(playerId, "players", heal, player);
  await applyHpToPlayer(playerId, newHp);
  return newHp;
}
