// =============================================================================
// fieldSystem.js — mmoRPGEduc
// Gerencia ciclo de vida de campos persistentes (magias FIELD)
//
// Responsabilidades:
// • Criar campos no Firebase + cache local
// • Aplicar dano/cura por tick às entidades no campo
// • Remover campos automaticamente ao expirar
// • Emitir eventos para clientes renderizarem
// =============================================================================

import { SPELL_TYPE } from "../spellBook.js";
import { buildFieldPayload } from "../fieldPayload.js";
import { worldEvents, EVENT_TYPES } from "../../core/events.js";
import { dbSet, dbRemove } from "../../core/db.js";
import { getMonsters, getPlayers } from "../../core/worldStore.js";
import { applyDirectDamage, applyHeal } from "../combat/combatService.js";

// Cache em memória para performance (espelho do Firebase)
const activeFields = new Map();

/**
 * Cria um campo persistente no mapa
 */
export async function createField({
  casterId,
  casterType,
  spellData,
  x,
  y,
  z = 7,
}) {
  // Validação: magia deve ser do tipo FIELD
  if (
    !spellData ||
    (spellData.type !== SPELL_TYPE.FIELD && !spellData.isField)
  ) {
    return { success: false, error: "Magia não é do tipo campo" };
  }

  const fieldId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  // Construir payload canônico usando fieldPayload.js
  const field = buildFieldPayload({
    id: fieldId,
    x,
    y,
    z,
    now,
    damage: spellData.damage || 0,
    fieldId: spellData.fieldId || spellData.fieldData?.fieldId,
    effectId: spellData.effectId || spellData.fieldData?.effectId,
    fieldDuration:
      spellData.fieldDuration || spellData.fieldData?.duration || 5000,
    tickRate:
      spellData.tickRate || spellData.fieldData?.tickDamage?.interval || 1000,
    statusType: spellData.damageType || spellData.fieldData?.damageType,
  });

  // Metadados de controle
  field.casterId = casterId;
  field.casterType = casterType;
  field.spellId = spellData.id;
  field.affectEnemies = spellData.affectEnemies ?? true;
  field.affectAllies = spellData.affectAllies ?? false;
  field.tickDamage =
    spellData.fieldData?.tickDamage ||
    (spellData.damage ? { base: spellData.damage, variance: 0.1 } : null);
  field.tickHeal = spellData.fieldData?.tickHeal || null;

  // Salvar no Firebase (fonte da verdade)
  await dbSet(`world_fields/${fieldId}`, field);
  activeFields.set(fieldId, field);

  // Emitir evento: cliente renderiza o campo visualmente
  worldEvents.emit(EVENT_TYPES.FIELD_CREATED, {
    fieldId,
    spellId: spellData.id,
    x: field.x,
    y: field.y,
    z: field.z,
    fieldSpriteId: field.fieldId,
    effectSpriteId: field.effectId,
    duration: field.fieldDuration,
    casterId,
    timestamp: now,
  });

  // Agendar ticks de dano/cura
  _scheduleFieldTicks(fieldId, field);

  return { success: true, fieldId };
}

function _scheduleFieldTicks(fieldId, field) {
  const tickInterval = field.tickRate || 1000;

  const tickFn = async () => {
    const cached = activeFields.get(fieldId);
    if (!cached) return;

    const now = Date.now();
    if (now >= cached.expiry) {
      await removeField(fieldId);
      return;
    }

    await _applyFieldEffect(cached);
    cached.lastTick = now;
    activeFields.set(fieldId, cached);

    worldEvents.emit(EVENT_TYPES.FIELD_TICK, {
      fieldId,
      tickCount: Math.floor((now - cached.startTime) / tickInterval),
      timestamp: now,
    });

    setTimeout(tickFn, tickInterval);
  };

  setTimeout(tickFn, tickInterval);
  setTimeout(async () => {
    if (activeFields.has(fieldId)) await removeField(fieldId);
  }, field.fieldDuration + 100);
}

async function _applyFieldEffect(field) {
  const { x, y, z, affectEnemies, affectAllies, tickDamage, tickHeal } = field;

  // Monstros
  const monsters = getMonsters();
  for (const [id, monster] of Object.entries(monsters)) {
    if (monster.dead || monster.z !== z) continue;
    if (Math.abs(monster.x - x) > 0.5 || Math.abs(monster.y - y) > 0.5)
      continue;

    const isEnemy =
      monster.type !== field.casterType || monster.id !== field.casterId;
    if (tickDamage && affectEnemies && isEnemy) {
      await _applyTickDamage({ field, targetId: id, targetType: "monster" });
    } else if (tickHeal && affectAllies && !isEnemy) {
      await _applyTickHeal({ field, targetId: id, targetType: "monster" });
    }
  }

  // Jogadores
  const players = getPlayers();
  for (const [id, player] of Object.entries(players)) {
    if (player.z !== z) continue;
    if (Math.abs(player.x - x) > 0.5 || Math.abs(player.y - y) > 0.5) continue;

    const isAlly =
      player.id === field.casterId && field.casterType === "player";
    if (tickHeal && affectAllies && isAlly) {
      await _applyTickHeal({ field, targetId: id, targetType: "player" });
    } else if (tickDamage && affectEnemies && !isAlly) {
      await _applyTickDamage({ field, targetId: id, targetType: "player" });
    }
  }
}

async function _applyTickDamage({ field, targetId, targetType }) {
  if (!field.tickDamage) return;
  const { base, variance = 0.1 } = field.tickDamage;
  const roll = 1 - variance + Math.random() * variance * 2;
  const damage = Math.max(1, Math.round(base * roll));

  const result = await applyDirectDamage({
    targetId,
    targetType,
    damage,
    damageType: field.statusType || "magical",
    sourceId: field.casterId,
  });

  if (result?.killed) {
    worldEvents.emit(EVENT_TYPES.COMBAT_KILL, {
      attackerId: field.casterId,
      defenderId: targetId,
      defenderType: targetType,
      killedByField: true,
      fieldId: field.id,
      spellId: field.spellId,
      timestamp: Date.now(),
    });
  }
}

async function _applyTickHeal({ field, targetId, targetType }) {
  if (!field.tickHeal) return;
  const { base, variance = 0.1 } = field.tickHeal;
  const roll = 1 - variance + Math.random() * variance * 2;
  const heal = Math.max(1, Math.round(base * roll));
  await applyHeal({ targetId, targetType, healAmount: heal });
}

export async function removeField(fieldId) {
  const field = activeFields.get(fieldId);
  if (!field) return;
  await dbRemove(`world_fields/${fieldId}`);
  activeFields.delete(fieldId);
  worldEvents.emit(EVENT_TYPES.FIELD_REMOVED, {
    fieldId,
    x: field.x,
    y: field.y,
    z: field.z,
    timestamp: Date.now(),
  });
}

export function getFieldsAtPosition(x, y, z = 7) {
  const fields = [];
  for (const field of activeFields.values()) {
    if (field.z !== z) continue;
    if (Math.abs(field.x - x) <= 0.5 && Math.abs(field.y - y) <= 0.5) {
      fields.push({ ...field });
    }
  }
  return fields;
}

export async function initFieldSystem(dbFunctions) {
  const fields = await dbFunctions.dbGet(
    dbFunctions.PATHS?.fields || "world_fields",
  );
  if (fields && typeof fields === "object") {
    const now = Date.now();
    for (const [id, field] of Object.entries(fields)) {
      if (field.expiry > now || field.expiresAt > now) {
        const normalized = {
          ...field,
          expiry: field.expiry || field.expiresAt,
          lastTick: field.lastTick || now,
        };
        activeFields.set(id, normalized);
        _scheduleFieldTicks(id, normalized);
        worldEvents.emit(EVENT_TYPES.FIELD_CREATED, {
          fieldId: id,
          spellId: normalized.spellId,
          x: normalized.x,
          y: normalized.y,
          z: normalized.z,
          fieldSpriteId: normalized.fieldId,
          effectSpriteId: normalized.effectId,
          duration: normalized.fieldDuration,
          casterId: normalized.casterId,
          timestamp: now,
          restored: true,
        });
      } else {
        await dbFunctions.dbRemove(`world_fields/${id}`);
      }
    }
  }
}

export function cleanupExpiredFields() {
  const now = Date.now();
  for (const [id, field] of activeFields.entries()) {
    if (now >= (field.expiry || field.expiresAt)) activeFields.delete(id);
  }
}

export { activeFields };
