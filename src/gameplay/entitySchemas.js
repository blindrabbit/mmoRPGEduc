// =============================================================================
// entitySchemas.js — Schema canônico de configuração (somente leitura)
// Fonte local de fallback para catálogos no Firebase (game_schemas/*).
// =============================================================================

export const ENTITY_SCHEMAS = Object.freeze({
  player: {
    version: 1,
    description: "Schema de player para UI/consulta e validação de setup.",
    stats: {
      required: ["hp", "maxHp", "mp", "maxMp", "atk", "def", "agi", "level"],
      optional: [
        "FOR",
        "INT",
        "AGI",
        "VIT",
        "ml",
        "magic",
        "resistances",
        "xp",
        "totalXp",
        "availableStatPoints",
        "allocatedStats",
      ],
    },
    abilities: {
      source: "spellBook",
      slots: { min: 1, max: 9 },
      cooldownScope: "perSpell",
    },
    visuals: {
      effectLayer: "top",
      supportsStatusLabels: true,
    },
  },

  monster: {
    version: 1,
    description: "Schema de monstro para IA, ataque e consulta de templates.",
    stats: {
      required: ["hp", "maxHp", "level"],
      optional: [
        "FOR",
        "INT",
        "AGI",
        "VIT",
        "combatProfile",
        "atk",
        "def",
        "agi",
        "xpValue",
        "elite",
      ],
    },
    metadata: {
      optional: ["recommendedPlayerLevel", "threatTier"],
    },
    behavior: {
      required: ["range", "loseAggro", "maxDistance"],
      optional: ["patrol", "fleeHpPct"],
    },
    attacks: {
      source: "monsterData",
      supportsTypes: ["melee", "ranged", "area", "buff", "debuff"],
      cooldownScope: "perAttackName",
    },
    visuals: {
      fieldPath: "world_fields",
      effectPath: "world_effects",
      statusEffectSync: true,
    },
  },

  npc: {
    version: 1,
    description:
      "Schema reservado para NPCs não hostis e scripts de interação.",
    behavior: {
      supportsDialogue: true,
      supportsQuestHooks: true,
    },
    abilities: {
      supportsBuffs: true,
      supportsDebuffs: false,
    },
  },
});

export const ABILITY_TYPE_SCHEMAS = Object.freeze({
  direct: {
    version: 1,
    targeting: { mode: "single", requiresTarget: true, maxTargets: 1 },
    impactArea: { shape: "target", radius: 0, pattern: null },
    effectArea: { shape: "target", radius: 0, pattern: null, layer: "top" },
    supports: ["damage", "heal", "debuff"],
  },

  self: {
    version: 1,
    targeting: { mode: "self", requiresTarget: false, maxTargets: 1 },
    impactArea: { shape: "self", radius: 0, pattern: null },
    effectArea: { shape: "self", radius: 0, pattern: null, layer: "top" },
    supports: ["heal", "buff"],
  },

  aoe: {
    version: 1,
    targeting: { mode: "pointOrSelf", requiresTarget: false, maxTargets: 999 },
    impactArea: {
      shape: "circle",
      radius: 2,
      allowedShapes: ["circle", "cross", "square", "cone", "line", "pattern"],
      pattern: null,
    },
    effectArea: {
      shape: "circle",
      radius: 2,
      allowedShapes: ["circle", "cross", "square", "cone", "line", "pattern"],
      pattern: null,
      layer: "ground_or_top",
    },
    supports: ["damage", "field", "status", "dot"],
  },

  buff: {
    version: 1,
    targeting: { mode: "selfOrSingle", requiresTarget: false, maxTargets: 1 },
    impactArea: { shape: "target", radius: 0, pattern: null },
    effectArea: { shape: "target", radius: 0, pattern: null, layer: "top" },
    supports: ["statMod", "duration", "stackingRules"],
  },

  debuff: {
    version: 1,
    targeting: { mode: "singleOrArea", requiresTarget: true, maxTargets: 999 },
    impactArea: {
      shape: "target",
      radius: 0,
      allowedShapes: ["target", "circle", "cross", "pattern"],
      pattern: null,
    },
    effectArea: {
      shape: "target",
      radius: 0,
      allowedShapes: ["target", "circle", "cross", "pattern"],
      pattern: null,
      layer: "top",
    },
    supports: ["statusType", "duration", "tickRate"],
  },

  area: {
    version: 1,
    targeting: { mode: "shape", requiresTarget: false, maxTargets: 999 },
    impactArea: {
      shape: "pattern",
      radius: 1,
      allowedShapes: ["pattern", "cone", "line", "cross", "square", "circle"],
      pattern: ["0X0", "XMX", "0X0"],
    },
    effectArea: {
      shape: "pattern",
      radius: 1,
      allowedShapes: ["pattern", "cone", "line", "cross", "square", "circle"],
      pattern: ["0X0", "XMX", "0X0"],
      layer: "ground_or_top",
    },
    supports: ["damage", "field", "status", "isPersistent"],
  },
});
