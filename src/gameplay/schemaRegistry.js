// =============================================================================
// schemaRegistry.js — Registry de schemas de entidade/habilidade
// Carrega configuração do Firebase e faz fallback para schema local.
// =============================================================================

import {
  getEntitySchemas,
  getAbilitySchemas,
  watchEntitySchemas,
  watchAbilitySchemas,
} from "../core/db.js";
import { ENTITY_SCHEMAS, ABILITY_TYPE_SCHEMAS } from "./entitySchemas.js";

const state = {
  entities: ENTITY_SCHEMAS,
  abilities: ABILITY_TYPE_SCHEMAS,
  initialized: false,
  unsubs: [],
};

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;
  if (!base || typeof base !== "object") return override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function initSchemaRegistry({
  watch = true,
  remoteOnly = false,
} = {}) {
  if (state.initialized) return state;

  try {
    const [remoteEntities, remoteAbilities] = await Promise.all([
      getEntitySchemas(),
      getAbilitySchemas(),
    ]);

    if (remoteEntities && typeof remoteEntities === "object") {
      state.entities = remoteOnly
        ? remoteEntities
        : deepMerge(ENTITY_SCHEMAS, remoteEntities);
    }

    if (remoteAbilities && typeof remoteAbilities === "object") {
      state.abilities = remoteOnly
        ? remoteAbilities
        : deepMerge(ABILITY_TYPE_SCHEMAS, remoteAbilities);
    }
  } catch (e) {
    console.warn("[schemaRegistry] fallback para schema local:", e?.message);
    if (remoteOnly) {
      state.entities = {};
      state.abilities = {};
    }
  }

  if (watch) {
    state.unsubs.push(
      watchEntitySchemas((data) => {
        if (!data || typeof data !== "object") return;
        state.entities = remoteOnly ? data : deepMerge(ENTITY_SCHEMAS, data);
      }),
    );
    state.unsubs.push(
      watchAbilitySchemas((data) => {
        if (!data || typeof data !== "object") return;
        state.abilities = remoteOnly
          ? data
          : deepMerge(ABILITY_TYPE_SCHEMAS, data);
      }),
    );
  }

  state.initialized = true;
  return state;
}

export function getEntitySchema(entityType) {
  return state.entities?.[entityType] ?? ENTITY_SCHEMAS?.[entityType] ?? null;
}

export function getAbilityTypeSchema(abilityType) {
  return (
    state.abilities?.[abilityType] ??
    ABILITY_TYPE_SCHEMAS?.[abilityType] ??
    null
  );
}

export function getAllEntitySchemas() {
  return state.entities;
}

export function getAllAbilityTypeSchemas() {
  return state.abilities;
}

export function disposeSchemaRegistry() {
  for (const unsub of state.unsubs) {
    try {
      if (typeof unsub === "function") unsub();
    } catch {}
  }
  state.unsubs = [];
  state.initialized = false;
}
