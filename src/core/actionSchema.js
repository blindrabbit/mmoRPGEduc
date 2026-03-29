// =============================================================================
// actionSchema.js — Validação de Schema de Ações (Zero Trust)
// Inspirado em: ProtocolGame::parse*() do Canary/OTClient
// =============================================================================
// Arquitetura:
//   Cliente → Action Schema → Validação → actionProcessor → Execução
//              (Camada de Validação)     (Camada de Negócio)
// =============================================================================

import { getPlayers, getMonsters } from "../core/worldStore.js";
import { PATHS, dbGet } from "../core/db.js";

// =============================================================================
// CONSTANTES DE VALIDAÇÃO
// =============================================================================

const COORD_LIMITS = {
  min: -8192,
  max: 8192,
  zMin: 0,
  zMax: 15,
};

const DISTANCE_LIMITS = {
  move: 1,        // Movimento: máximo 1 SQM
  attack: 1.5,    // Melee: 1 SQM
  spell: 5,       // Magias: varia por spell
  interact: 2,    // Interação: 2 SQMs
};

const VALID_DIRECTIONS = new Set([
  "frente",
  "costas",
  "lado",
  "lado-esquerdo",
]);

const VALID_ITEM_ACTIONS = new Set([
  "use",
  "equip",
  "unequip",
  "drop",
  "move",
  "pickUp",
  "moveWorld",
]);

// =============================================================================
// ACTION SCHEMA — Definição de schemas por tipo de ação
// =============================================================================

export const ACTION_SCHEMA = {
  // ── MOVIMENTO ─────────────────────────────────────────────────────────────
  move: {
    required: ["playerId", "x", "y"],
    optional: ["z", "direcao", "source", "ts", "expiresAt"],
    validators: [
      validatePlayerId,
      validateCoordinates,
      validateDirection,
      validateDistance("move"),
      validateTimestamp,
    ],
  },

  // ── ATAQUE ────────────────────────────────────────────────────────────────
  attack: {
    required: ["playerId", "targetId"],
    optional: ["ts", "expiresAt"],
    validators: [
      validatePlayerId,
      validateTargetExists,
      validateDistance("attack"),
      validateTimestamp,
    ],
  },

  // ── MAGIA ─────────────────────────────────────────────────────────────────
  spell: {
    required: ["playerId", "spellId"],
    optional: ["targetId", "targetX", "targetY", "targetZ", "ts", "expiresAt"],
    validators: [
      validatePlayerId,
      validateSpellId,
      validateSpellTarget,
      validateTimestamp,
    ],
  },

  // ── ITEM ──────────────────────────────────────────────────────────────────
  item: {
    required: ["playerId", "itemAction"],
    optional: [
      "slotIndex",
      "toSlot",
      "worldItemId",
      "equipSlot",
      "quantity",
      "toX",
      "toY",
      "toZ",
      "ts",
      "expiresAt",
    ],
    validators: [
      validatePlayerId,
      validateItemAction,
      validateItemPayload,
      validateTimestamp,
    ],
  },

  // ── MAP TILE PICKUP ───────────────────────────────────────────────────────
  map_tile_pickup: {
    required: ["playerId", "coord", "tileId", "mapLayer"],
    optional: [
      "clientTempId",
      "tileCount",
      "stackable",
      "maxStack",
      "content_type",
      "unique_id",
      "ts",
      "expiresAt",
    ],
    validators: [
      validatePlayerId,
      validateTileCoord,
      validateTileId,
      validateMapLayer,
      validateDistance("interact"),
      validateTimestamp,
    ],
  },

  // ── TOGGLE DOOR ───────────────────────────────────────────────────────────
  toggle_door: {
    required: ["playerId", "target", "fromId", "toId"],
    optional: ["isOpening", "ts", "expiresAt"],
    validators: [
      validatePlayerId,
      validateTarget,
      validateTileId("fromId"),
      validateTileId("toId"),
      validateDistance("interact"),
      validateTimestamp,
    ],
  },

  // ── CHANGE FLOOR ──────────────────────────────────────────────────────────
  change_floor: {
    required: ["playerId", "fromZ", "toZ"],
    optional: ["itemId", "ts", "expiresAt"],
    validators: [
      validatePlayerId,
      validateFloorChange,
      validateTimestamp,
    ],
  },

  // ── ALLOCATE STAT ─────────────────────────────────────────────────────────
  allocateStat: {
    required: ["playerId", "statName", "amount"],
    optional: ["ts", "expiresAt"],
    validators: [
      validatePlayerId,
      validateStatName,
      validateStatAmount,
      validateTimestamp,
    ],
  },
};

// =============================================================================
// VALIDADORES BASE
// =============================================================================

/**
 * Valida playerId
 */
function validatePlayerId(action) {
  if (!action.playerId || typeof action.playerId !== "string") {
    return { ok: false, error: "invalid_player_id", field: "playerId" };
  }
  return { ok: true };
}

/**
 * Valida coordenadas (x, y, z)
 */
function validateCoordinates(action) {
  const { x, y, z } = action;

  if (typeof x !== "number" || !Number.isFinite(x)) {
    return { ok: false, error: "invalid_x", field: "x" };
  }
  if (typeof y !== "number" || !Number.isFinite(y)) {
    return { ok: false, error: "invalid_y", field: "y" };
  }
  if (z !== undefined && (typeof z !== "number" || !Number.isFinite(z))) {
    return { ok: false, error: "invalid_z", field: "z" };
  }

  // Limites do mapa
  if (
    x < COORD_LIMITS.min ||
    x > COORD_LIMITS.max ||
    y < COORD_LIMITS.min ||
    y > COORD_LIMITS.max
  ) {
    return {
      ok: false,
      error: "coord_out_of_bounds",
      field: "x,y",
      limits: COORD_LIMITS,
    };
  }

  if (z !== undefined && (z < COORD_LIMITS.zMin || z > COORD_LIMITS.zMax)) {
    return {
      ok: false,
      error: "z_out_of_bounds",
      field: "z",
      limits: COORD_LIMITS,
    };
  }

  return { ok: true };
}

/**
 * Valida direção
 */
function validateDirection(action) {
  if (action.direcao && !VALID_DIRECTIONS.has(action.direcao)) {
    return {
      ok: false,
      error: "invalid_direction",
      field: "direcao",
      valid: Array.from(VALID_DIRECTIONS),
    };
  }
  return { ok: true };
}

/**
 * Valida distância máxima do tipo de ação
 */
function validateDistance(type) {
  return function (action, player) {
    if (!player) return { ok: true }; // Player não online, valida depois

    const maxDist = DISTANCE_LIMITS[type] ?? 1;

    if (type === "move" && action.x !== undefined && action.y !== undefined) {
      const dx = Math.abs(action.x - player.x);
      const dy = Math.abs(action.y - player.y);

      if (dx > maxDist || dy > maxDist) {
        return {
          ok: false,
          error: "distance_exceeded",
          field: "x,y",
          max: maxDist,
          actual: { dx, dy },
        };
      }
    }

    if (
      type === "attack" &&
      action.targetId &&
      player.x !== undefined
    ) {
      const monsters = getMonsters();
      const target = monsters[action.targetId];

      if (target) {
        const dist = Math.hypot(target.x - player.x, target.y - player.y);
        if (dist > maxDist + 0.5) {
          return {
            ok: false,
            error: "target_out_of_range",
            field: "targetId",
            max: maxDist,
            actual: dist,
          };
        }
      }
    }

    return { ok: true };
  };
}

/**
 * Valida se target existe
 */
function validateTargetExists(action) {
  if (!action.targetId) {
    return { ok: false, error: "missing_target_id", field: "targetId" };
  }

  const monsters = getMonsters();
  const target = monsters[action.targetId];

  if (!target) {
    return {
      ok: false,
      error: "target_not_found",
      field: "targetId",
      targetId: action.targetId,
    };
  }

  if (target.stats?.hp <= 0 || target.dead) {
    return {
      ok: false,
      error: "target_dead",
      field: "targetId",
      targetId: action.targetId,
    };
  }

  return { ok: true };
}

/**
 * Valida spellId
 */
function validateSpellId(action) {
  if (!action.spellId || typeof action.spellId !== "string") {
    return { ok: false, error: "invalid_spell_id", field: "spellId" };
  }

  // Importar spellBook para validar
  const { getSpell } = require("../gameplay/spellBook.js");
  const spell = getSpell(action.spellId);

  if (!spell) {
    return {
      ok: false,
      error: "spell_not_found",
      field: "spellId",
      spellId: action.spellId,
    };
  }

  return { ok: true };
}

/**
 * Valida target de magia
 */
function validateSpellTarget(action) {
  const { getSpell } = require("../gameplay/spellBook.js");
  const spell = getSpell(action.spellId);

  if (!spell) return { ok: true }; // Validado em validateSpellId

  // DIRECT: precisa de targetId
  if (spell.type === "DIRECT" && !action.targetId) {
    return {
      ok: false,
      error: "missing_target_id",
      field: "targetId",
      spellType: spell.type,
    };
  }

  // FIELD: precisa de targetX, targetY
  if (
    (spell.type === "FIELD" || spell.isField) &&
    (action.targetX === undefined || action.targetY === undefined)
  ) {
    return {
      ok: false,
      error: "missing_target_coords",
      field: "targetX,targetY",
      spellType: spell.type,
    };
  }

  return { ok: true };
}

/**
 * Valida itemAction
 */
function validateItemAction(action) {
  if (!action.itemAction || typeof action.itemAction !== "string") {
    return { ok: false, error: "invalid_item_action", field: "itemAction" };
  }

  if (!VALID_ITEM_ACTIONS.has(action.itemAction)) {
    return {
      ok: false,
      error: "unknown_item_action",
      field: "itemAction",
      valid: Array.from(VALID_ITEM_ACTIONS),
    };
  }

  return { ok: true };
}

/**
 * Valida payload de item
 */
function validateItemPayload(action) {
  const { itemAction } = action;

  // drop: precisa de toX, toY, toZ
  if (itemAction === "drop") {
    if (
      action.toX === undefined ||
      action.toY === undefined ||
      action.toZ === undefined
    ) {
      return {
        ok: false,
        error: "missing_drop_coords",
        field: "toX,toY,toZ",
      };
    }
  }

  // equip: precisa de equipSlot
  if (itemAction === "equip" && !action.equipSlot) {
    return {
      ok: false,
      error: "missing_equip_slot",
      field: "equipSlot",
    };
  }

  // move: precisa de toSlot
  if (itemAction === "move" && action.toSlot === undefined) {
    return {
      ok: false,
      error: "missing_to_slot",
      field: "toSlot",
    };
  }

  return { ok: true };
}

/**
 * Valida coordenadas de tile
 */
function validateTileCoord(action) {
  if (!action.coord || typeof action.coord !== "string") {
    return { ok: false, error: "invalid_coord", field: "coord" };
  }

  const parts = action.coord.split(",");
  if (parts.length !== 3) {
    return {
      ok: false,
      error: "invalid_coord_format",
      field: "coord",
      expected: "x,y,z",
    };
  }

  const [x, y, z] = parts.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { ok: false, error: "invalid_coord_values", field: "coord" };
  }

  return { ok: true };
}

/**
 * Valida tileId
 */
function validateTileId(fieldName = "tileId") {
  return function (action) {
    const value = action[fieldName];

    if (value === undefined || value === null) {
      return { ok: false, error: `missing_${fieldName}`, field: fieldName };
    }

    if (typeof value !== "number" && !Number.isFinite(Number(value))) {
      return { ok: false, error: `invalid_${fieldName}`, field: fieldName };
    }

    return { ok: true };
  };
}

/**
 * Valida mapLayer
 */
function validateMapLayer(action) {
  if (action.mapLayer === undefined || action.mapLayer === null) {
    return { ok: false, error: "missing_map_layer", field: "mapLayer" };
  }

  if (typeof action.mapLayer !== "number") {
    return { ok: false, error: "invalid_map_layer", field: "mapLayer" };
  }

  return { ok: true };
}

/**
 * Valida target (para toggle_door)
 */
function validateTarget(action) {
  if (!action.target || typeof action.target !== "object") {
    return { ok: false, error: "invalid_target", field: "target" };
  }

  if (
    action.target.x === undefined ||
    action.target.y === undefined ||
    action.target.z === undefined
  ) {
    return {
      ok: false,
      error: "missing_target_coords",
      field: "target.x,target.y,target.z",
    };
  }

  return { ok: true };
}

/**
 * Valida mudança de andar
 */
function validateFloorChange(action) {
  if (action.fromZ === undefined || action.toZ === undefined) {
    return {
      ok: false,
      error: "missing_floor_coords",
      field: "fromZ,toZ",
    };
  }

  const diff = Math.abs(action.toZ - action.fromZ);
  if (diff !== 1) {
    return {
      ok: false,
      error: "invalid_floor_diff",
      field: "fromZ,toZ",
      expected: "±1",
      actual: diff,
    };
  }

  return { ok: true };
}

/**
 * Valida stat name
 */
function validateStatName(action) {
  const VALID_STATS = new Set([
    "str",
    "dex",
    "int",
    "con",
    "agi",
    "luk",
  ]);

  if (!action.statName || typeof action.statName !== "string") {
    return { ok: false, error: "invalid_stat_name", field: "statName" };
  }

  if (!VALID_STATS.has(action.statName.toLowerCase())) {
    return {
      ok: false,
      error: "unknown_stat",
      field: "statName",
      valid: Array.from(VALID_STATS),
    };
  }

  return { ok: true };
}

/**
 * Valida stat amount
 */
function validateStatAmount(action) {
  if (
    action.amount === undefined ||
    typeof action.amount !== "number" ||
    action.amount < 1 ||
    action.amount > 10
  ) {
    return {
      ok: false,
      error: "invalid_stat_amount",
      field: "amount",
      min: 1,
      max: 10,
    };
  }

  return { ok: true };
}

/**
 * Valida timestamp
 */
function validateTimestamp(action) {
  if (!action.ts || typeof action.ts !== "number") {
    return { ok: false, error: "invalid_timestamp", field: "ts" };
  }

  const now = Date.now();
  const age = now - action.ts;

  // Ação muito antiga (> 5 segundos)
  if (age > 5000) {
    return {
      ok: false,
      error: "action_too_old",
      field: "ts",
      age: age,
      maxAge: 5000,
    };
  }

  // expiresAt no futuro
  if (action.expiresAt) {
    if (typeof action.expiresAt !== "number") {
      return {
        ok: false,
        error: "invalid_expires_at",
        field: "expiresAt",
      };
    }

    if (action.expiresAt < now || action.expiresAt > now + 60000) {
      return {
        ok: false,
        error: "invalid_expiry",
        field: "expiresAt",
        now: now,
        min: now,
        max: now + 60000,
      };
    }
  }

  return { ok: true };
}

// =============================================================================
// VALIDAÇÃO DE AÇÃO — Função principal
// =============================================================================

/**
 * Valida uma ação contra o schema definido.
 * @param {Object} action - Ação a validar
 * @param {Object} [player] - Player (opcional, para validações de distância)
 * @returns {{ ok: boolean, error?: string, field?: string, details?: Object }}
 */
export function validateAction(action, player = null) {
  if (!action || typeof action !== "object") {
    return { ok: false, error: "invalid_action_format" };
  }

  if (!action.type || typeof action.type !== "string") {
    return { ok: false, error: "missing_action_type" };
  }

  const schema = ACTION_SCHEMA[action.type];

  if (!schema) {
    return {
      ok: false,
      error: "unknown_action_type",
      type: action.type,
      valid: Object.keys(ACTION_SCHEMA),
    };
  }

  // Validar campos obrigatórios
  for (const field of schema.required) {
    if (action[field] === undefined || action[field] === null) {
      return {
        ok: false,
        error: "missing_required_field",
        field: field,
        type: action.type,
      };
    }
  }

  // Executar validadores
  for (const validator of schema.validators) {
    const result = validator(action, player);

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        field: result.field,
        details: result,
      };
    }
  }

  return { ok: true };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  COORD_LIMITS,
  DISTANCE_LIMITS,
  VALID_DIRECTIONS,
  VALID_ITEM_ACTIONS,
};
