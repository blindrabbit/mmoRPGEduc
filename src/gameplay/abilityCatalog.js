// =============================================================================
// abilityCatalog.js — Catálogo unificado de habilidades
// Consolida magias de players e ataques de monstros em um único ponto.
// =============================================================================

import { SPELLS } from "./spellBook.js";
import { MONSTER_TEMPLATES } from "./monsterData.js";
import {
  normalizeSpellAbility,
  normalizeMonsterAttackAbility,
} from "./abilityCore.js";
import { getAbilityTypeSchema, getEntitySchema } from "./schemaRegistry.js";

export function getUnifiedAbilities() {
  const out = [];

  for (const spell of Object.values(SPELLS)) {
    const normalized = normalizeSpellAbility(spell);
    if (normalized) out.push(normalized);
  }

  for (const [species, template] of Object.entries(MONSTER_TEMPLATES)) {
    const attacks = Array.isArray(template?.attacks) ? template.attacks : [];
    for (const attack of attacks) {
      const normalized = normalizeMonsterAttackAbility(attack, {
        monsterSpecies: species,
      });
      if (normalized) out.push(normalized);
    }
  }

  return out;
}

export function getUnifiedAbilityById(abilityId) {
  return getUnifiedAbilities().find((a) => a.id === abilityId) ?? null;
}

export function getAbilityConfigSchema(abilityType) {
  return getAbilityTypeSchema(abilityType);
}

export function getEntityConfigSchema(entityType) {
  return getEntitySchema(entityType);
}
