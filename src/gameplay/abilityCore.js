// =============================================================================
// abilityCore.js — Núcleo unificado de habilidades (players + monstros)
// Regras comuns de normalização, status e visuais de campo.
// =============================================================================

export const ABILITY_SOURCE = {
  SPELL: "spell",
  MONSTER_ATTACK: "monster_attack",
};

import { normalizeCombatCooldownMs } from "./combatScheduler.js";

export const ABILITY_KIND = {
  DIRECT: "direct",
  SELF: "self",
  AOE: "aoe",
  BUFF: "buff",
  MELEE: "melee",
  RANGED: "ranged",
  AREA: "area",
};

const STATUS_EFFECT_MAP = Object.freeze({
  burning: 16,
  frozen: 24,
  poison: 2,
});

const FIELD_VISUAL_MAP = Object.freeze({
  burning: 2118,
  poison: 2119,
  "effect:2": 2118,
  "effect:16": 2118,
});

/**
 * Resolve effectId canônico para um status.
 */
export function resolveStatusEffectId(statusType, fallbackEffectId = 2) {
  const key = String(statusType ?? "")
    .toLowerCase()
    .trim();
  const mapped = STATUS_EFFECT_MAP[key];
  if (Number.isFinite(Number(mapped))) return Number(mapped);
  const fallback = Number(fallbackEffectId);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 2;
}

/**
 * Resolve IDs visuais de campo de forma unificada.
 */
export function resolveFieldVisualIds({ fieldId, effectId, statusType } = {}) {
  const normalizedEffectId = resolveStatusEffectId(statusType, effectId ?? 2);
  const normalizedFieldId = Number(fieldId);
  const statusKey = String(statusType ?? "")
    .toLowerCase()
    .trim();
  const inferredFieldId = Number(
    FIELD_VISUAL_MAP[statusKey] ??
      FIELD_VISUAL_MAP[`effect:${normalizedEffectId}`] ??
      0,
  );
  return {
    fieldId:
      Number.isFinite(normalizedFieldId) && normalizedFieldId > 0
        ? normalizedFieldId
        : Number.isFinite(inferredFieldId) && inferredFieldId > 0
          ? inferredFieldId
          : null,
    effectId: normalizedEffectId,
  };
}

/**
 * Normaliza magia para shape comum de ability.
 */
export function normalizeSpellAbility(spell, options = {}) {
  if (!spell) return null;
  const schema = options.schema ?? null;
  return {
    id: String(spell.id ?? ""),
    source: ABILITY_SOURCE.SPELL,
    kind: String(spell.type ?? ABILITY_KIND.DIRECT),
    name: String(spell.name ?? spell.id ?? ""),
    cooldownMs: normalizeCombatCooldownMs(spell.cooldownMs ?? 0),
    cost: { mp: Number(spell.mpCost ?? 0) },
    damage: spell.damage ?? null,
    heal: spell.heal ?? null,
    range: Number(spell.range ?? 0),
    aoeRadius: Number(spell.aoeRadius ?? 0),
    statusType: spell.statusType ?? null,
    visuals: {
      fieldId: resolveFieldVisualIds({
        fieldId: spell.fieldId,
        effectId: spell.effectId,
        statusType: spell.statusType,
      }).fieldId,
      effectId: Number.isFinite(Number(spell.effectId))
        ? Number(spell.effectId)
        : null,
      selfEffectId: Number.isFinite(Number(spell.selfEffectId))
        ? Number(spell.selfEffectId)
        : null,
      effectDuration: Number(spell.effectDuration ?? 1200),
      isField: Boolean(spell.isField),
      fieldDuration: Number(spell.fieldDuration ?? 0),
    },
    schema,
    raw: spell,
  };
}

/**
 * Normaliza ataque de monstro para shape comum de ability.
 */
export function normalizeMonsterAttackAbility(
  attack,
  { monsterSpecies, schema } = {},
) {
  if (!attack) return null;
  const kind = String(attack.type ?? ABILITY_KIND.MELEE);
  const visuals = resolveFieldVisualIds({
    fieldId: attack.fieldId,
    effectId: attack.effectId,
    statusType: attack.statusType,
  });

  return {
    id: `${monsterSpecies ?? "monster"}:${String(attack.name ?? "attack")}`,
    source: ABILITY_SOURCE.MONSTER_ATTACK,
    kind,
    name: String(attack.name ?? "Attack"),
    cooldownMs: normalizeCombatCooldownMs(attack.cooldown ?? 0),
    cost: { mp: 0 },
    damage: Number(attack.damage ?? 0),
    heal: null,
    range: Number(attack.range ?? 1),
    aoeRadius: Number(attack.range ?? 0),
    statusType: attack.statusType ?? null,
    visuals: {
      fieldId: visuals.fieldId,
      effectId: visuals.effectId,
      effectDuration: Number(attack.effectDuration ?? 1200),
      isField: Boolean(attack.isField),
      isPersistent: Boolean(attack.isPersistent),
      fieldDuration: Number(attack.fieldDuration ?? 0),
    },
    schema: schema ?? null,
    shape: Array.isArray(attack.shape) ? attack.shape : null,
    raw: attack,
  };
}
