// =============================================================================
// schema.js — mmoRPGGame
// Camada 0: Estrutura canônica de todas as entidades do sistema.
// REGRA: Todo objeto que entra ou sai do Firebase passa por aqui.
// Nenhum outro arquivo define a forma de uma entidade.
// Dependências: NENHUMA (zero imports)
// =============================================================================

export const SCHEMA_VERSION = 2;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringSafe(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function normalizeOutfitPack(pack, fallback) {
  const raw = toStringSafe(pack, fallback);
  if (!raw) return fallback;
  const aliases = {
    outfits01: "outfits_01",
    outfits02: "monstros_01",
  };
  return aliases[raw] ?? raw;
}

export const COMBAT_PROFILE_FACTORS = Object.freeze({
  balanced: {
    attack: { FOR: 1.35, INT: 0.35, AGI: 0.15, VIT: 0.1 },
    defense: { VIT: 0.6, AGI: 0.25, FOR: 0.1, INT: 0.05 },
    agility: 1,
  },
  skirmisher: {
    attack: { FOR: 1.2, INT: 0.15, AGI: 0.45, VIT: 0.05 },
    defense: { VIT: 0.35, AGI: 0.45, FOR: 0.1, INT: 0.05 },
    agility: 1.08,
  },
  caster: {
    attack: { FOR: 0.2, INT: 1.45, AGI: 0.2, VIT: 0.05 },
    defense: { VIT: 0.4, AGI: 0.2, FOR: 0.05, INT: 0.1 },
    agility: 0.95,
  },
  tank: {
    attack: { FOR: 1.05, INT: 0.1, AGI: 0.1, VIT: 0.35 },
    defense: { VIT: 0.95, AGI: 0.15, FOR: 0.15, INT: 0.05 },
    agility: 0.82,
  },
  boss: {
    attack: { FOR: 1.4, INT: 0.9, AGI: 0.25, VIT: 0.15 },
    defense: { VIT: 0.9, AGI: 0.3, FOR: 0.2, INT: 0.1 },
    agility: 1,
  },
});

export function deriveCombatStatsFromAttributes({
  FOR = 0,
  INT = 0,
  AGI = 0,
  VIT = 0,
  combatProfile = "balanced",
} = {}) {
  const profile =
    COMBAT_PROFILE_FACTORS[combatProfile] ?? COMBAT_PROFILE_FACTORS.balanced;
  const weightedAttack =
    FOR * profile.attack.FOR +
    INT * profile.attack.INT +
    AGI * profile.attack.AGI +
    VIT * profile.attack.VIT;
  const weightedDefense =
    VIT * profile.defense.VIT +
    AGI * profile.defense.AGI +
    FOR * profile.defense.FOR +
    INT * profile.defense.INT;

  return {
    atk: Math.max(1, Math.round(weightedAttack)),
    def: Math.max(0, Math.round(weightedDefense)),
    agi: Math.max(1, Math.round(AGI * profile.agility)),
    combatProfile,
  };
}

// ---------------------------------------------------------------------------
// APPEARANCE — estrutura canônica de visual de qualquer entidade
// Resolve o bug: speed estava dentro de appearance em players
// e fora de appearance em monstros. Agora é sempre na raiz da entidade.
// ---------------------------------------------------------------------------
export function makeAppearance(
  outfitId = 10000,
  outfitPack = "outfits_01",
  isAdmin = false,
  className = null,
) {
  return {
    outfitId: toStringSafe(outfitId, "10000"),
    outfitPack: normalizeOutfitPack(outfitPack, "outfits_01"),
    isAdmin: Boolean(isAdmin),
    class: className ?? null,
  };
}

// ---------------------------------------------------------------------------
// STATS — estrutura canônica de atributos de combate
// ---------------------------------------------------------------------------
export function makeStats({
  hp = 100,
  maxHp = 100,
  mp = 50,
  maxMp = 50,
  atk,
  def,
  agi,
  FOR,
  INT,
  AGI,
  VIT,
  combatProfile,
  level = 1,
  xp,
  totalXp,
  availableStatPoints,
  allocatedStats,
  xpValue,
  elite,
  ml,
  magic,
  resistances,
  ...extra
} = {}) {
  const forResolved = FOR == null ? null : toNumber(FOR, 0);
  const intResolved = INT == null ? null : toNumber(INT, 0);
  const agiPrimaryResolved = AGI == null ? null : toNumber(AGI, 0);
  const vitResolved = VIT == null ? null : toNumber(VIT, 0);
  const combatProfileResolved = combatProfile ?? "balanced";
  const derivedCombatStats =
    forResolved == null &&
    intResolved == null &&
    agiPrimaryResolved == null &&
    vitResolved == null
      ? { atk: 10, def: 5, agi: 10, combatProfile: combatProfileResolved }
      : deriveCombatStatsFromAttributes({
          FOR: forResolved ?? 0,
          INT: intResolved ?? 0,
          AGI: agiPrimaryResolved ?? 0,
          VIT: vitResolved ?? 0,
          combatProfile: combatProfileResolved,
        });

  return {
    ...extra,
    level: toNumber(level, 1),
    hp: toNumber(hp, 100),
    maxHp: toNumber(maxHp, 100),
    mp: toNumber(mp, 50),
    maxMp: toNumber(maxMp, 50),
    atk: toNumber(atk, derivedCombatStats.atk),
    def: toNumber(def, derivedCombatStats.def),
    agi: toNumber(agi, derivedCombatStats.agi),
    ...(combatProfile !== undefined ||
    forResolved != null ||
    intResolved != null ||
    agiPrimaryResolved != null ||
    vitResolved != null
      ? { combatProfile: combatProfileResolved }
      : {}),
    ...(forResolved == null ? {} : { FOR: forResolved }),
    ...(intResolved == null ? {} : { INT: intResolved }),
    ...(agiPrimaryResolved == null ? {} : { AGI: agiPrimaryResolved }),
    ...(vitResolved == null ? {} : { VIT: vitResolved }),
    ...(xpValue === undefined ? {} : { xpValue: toNumber(xpValue, 10) }),
    ...(elite === undefined ? {} : { elite: Boolean(elite) }),
    ...(ml === undefined ? {} : { ml: toNumber(ml, 0) }),
    ...(magic === undefined ? {} : { magic: toNumber(magic, 0) }),
    ...(xp === undefined ? {} : { xp: toNumber(xp, 0) }),
    ...(totalXp === undefined ? {} : { totalXp: toNumber(totalXp, 0) }),
    ...(availableStatPoints === undefined
      ? {}
      : { availableStatPoints: toNumber(availableStatPoints, 0) }),
    ...(allocatedStats === undefined
      ? {}
      : { allocatedStats: allocatedStats ?? null }),
    ...(resistances === undefined ? {} : { resistances: { ...resistances } }),
  };
}

// ---------------------------------------------------------------------------
// PLAYER — entidade canônica de jogador (players_data + online_players)
// ---------------------------------------------------------------------------
export function makePlayer({
  id,
  name,
  class: playerClass = null,
  x = 0,
  y = 0,
  z = 7,
  direcao = "frente",
  speed,
  appearance = {},
  stats = {},
  spawnX = x,
  spawnY = y,
  spawnZ = z,
  isAdmin = false,
  status = null,
  schemaVersion = SCHEMA_VERSION,
  ...extra
} = {}) {
  const isAdminResolved = isAdmin || appearance?.isAdmin === true;
  const speedResolved = speed ?? appearance?.speed ?? 120;
  const classResolved = appearance?.class ?? playerClass ?? null;
  const statsRaw = stats && typeof stats === "object" ? stats : {};
  const playerStatsSeed = {
    level: 1,
    xp: 0,
    totalXp: 0,
    availableStatPoints: 0,
    allocatedStats: { FOR: 0, INT: 0, AGI: 0, VIT: 0 },
    ...statsRaw,
    allocatedStats: {
      FOR: 0,
      INT: 0,
      AGI: 0,
      VIT: 0,
      ...(statsRaw?.allocatedStats ?? {}),
    },
  };

  return {
    ...extra,
    schemaVersion: toNumber(schemaVersion, SCHEMA_VERSION),
    id: toStringSafe(id, ""),
    name: toStringSafe(name, "Jogador"),
    class: classResolved,
    x: toNumber(x, 0),
    y: toNumber(y, 0),
    z: toNumber(z, 7),
    direcao: toStringSafe(direcao, "frente"),
    speed: toNumber(speedResolved, 120),
    appearance: makeAppearance(
      appearance?.outfitId ?? (isAdminResolved ? 75 : 128),
      appearance?.outfitPack ?? "outfits_01",
      isAdminResolved,
      classResolved,
    ),
    stats: makeStats(playerStatsSeed),
    spawnX: toNumber(spawnX, toNumber(x, 0)),
    spawnY: toNumber(spawnY, toNumber(y, 0)),
    spawnZ: toNumber(spawnZ, toNumber(z, 7)),
    status: status ?? null,
  };
}

// ---------------------------------------------------------------------------
// MONSTER — entidade canônica de monstro (world_entities)
// ---------------------------------------------------------------------------
export function makeMonster({
  id,
  species,
  name,
  x = 0,
  y = 0,
  z = 7,
  direcao = "frente",
  speed,
  appearance = {},
  stats = {},
  type = "monster",
  spawnX = x,
  spawnY = y,
  spawnZ = z,
  schemaVersion = SCHEMA_VERSION,
  ...extra
} = {}) {
  const speciesResolved = toStringSafe(species, "unknown");
  const speedResolved = speed ?? appearance?.speed ?? 80;

  return {
    ...extra,
    schemaVersion: toNumber(schemaVersion, SCHEMA_VERSION),
    id: toStringSafe(id, ""),
    species: speciesResolved,
    name: toStringSafe(name, speciesResolved),
    x: toNumber(x, 0),
    y: toNumber(y, 0),
    z: toNumber(z, 7),
    spawnX: toNumber(spawnX, toNumber(x, 0)),
    spawnY: toNumber(spawnY, toNumber(y, 0)),
    spawnZ: toNumber(spawnZ, toNumber(z, 7)),
    direcao: toStringSafe(direcao, "frente"),
    speed: toNumber(speedResolved, 80),
    type: toStringSafe(type, "monster"),
    appearance: makeAppearance(
      appearance?.outfitId ?? speciesResolved,
      appearance?.outfitPack ?? "monstros_01",
      false,
    ),
    stats: makeStats(stats),
  };
}

// ---------------------------------------------------------------------------
// EFFECT — entidade canônica de efeito visual (world_effects)
// Cobre: corpses, explosões, magias, projéteis
// ---------------------------------------------------------------------------
export function makeEffect({
  id,
  type = "effect",
  x = 0,
  y = 0,
  z = 7,
  startTime = Date.now(),
  expiry = Date.now() + 2000,
  outfitPack = null,
  stages = null,
  effectFrames = null,
  effectDuration = 1200,
  effectSpeed = 200,
  isField = false,
  fieldDuration = 0,
  schemaVersion = SCHEMA_VERSION,
  ...extra
} = {}) {
  return {
    ...extra,
    schemaVersion: toNumber(schemaVersion, SCHEMA_VERSION),
    id: toStringSafe(id, ""),
    type: toStringSafe(type, "effect"),
    x: toNumber(x, 0),
    y: toNumber(y, 0),
    z: toNumber(z, 7),
    startTime: toNumber(startTime, Date.now()),
    expiry: toNumber(expiry, Date.now() + 2000),
    outfitPack: outfitPack
      ? normalizeOutfitPack(outfitPack, toStringSafe(outfitPack, ""))
      : null,
    stages: stages ?? null,
    effectFrames: effectFrames ?? null,
    effectDuration: toNumber(effectDuration, 1200),
    effectSpeed: toNumber(effectSpeed, 200),
    isField: Boolean(isField),
    fieldDuration: toNumber(fieldDuration, 0),
  };
}

// ---------------------------------------------------------------------------
// FIELD — entidade canônica de campo persistente (world_fields)
// Cobre: fogo, veneno, campos de dano contínuo
// ---------------------------------------------------------------------------
export function makeField({
  id,
  x = 0,
  y = 0,
  z = 7,
  damage = 0,
  expiry = Date.now() + 5000,
  tickRate = 1000,
  statusType = null,
  lastTick = 0,
  schemaVersion = SCHEMA_VERSION,
  ...extra
} = {}) {
  return {
    ...extra,
    schemaVersion: toNumber(schemaVersion, SCHEMA_VERSION),
    id: toStringSafe(id, ""),
    x: toNumber(x, 0),
    y: toNumber(y, 0),
    z: toNumber(z, 7),
    damage: toNumber(damage, 0),
    expiry: toNumber(expiry, Date.now() + 5000),
    tickRate: toNumber(tickRate, 1000),
    statusType: statusType ?? null,
    lastTick: toNumber(lastTick, 0),
  };
}

// ---------------------------------------------------------------------------
// normalizeEntity — sanitiza qualquer objeto vindo do Firebase
// Garante tipos corretos mesmo se o banco tiver dados inconsistentes.
// Uso: const safe = normalizeEntity(rawFirebaseData, 'player')
// ---------------------------------------------------------------------------
export function normalizeEntity(raw, type = "unknown") {
  if (!raw || typeof raw !== "object") return null;
  const inferred = type === "unknown" ? (raw.type ?? "unknown") : type;

  switch (type) {
    case "player":
      return makePlayer(raw);
    case "monster":
      return makeMonster(raw);
    case "effect":
      return makeEffect(raw);
    case "field":
      return makeField(raw);
    case "unknown":
      switch (inferred) {
        case "player":
          return makePlayer(raw);
        case "monster":
        case "corpse":
          return makeMonster(raw);
        case "effect":
        case "projectile":
        case "corpseEffect":
          return makeEffect(raw);
        case "field":
          return makeField(raw);
        default:
          return {
            ...raw,
            schemaVersion: toNumber(raw.schemaVersion, SCHEMA_VERSION),
            x: toNumber(raw.x, 0),
            y: toNumber(raw.y, 0),
            z: toNumber(raw.z, 7),
          };
      }
    default:
      // Normalização mínima: garante x, y, z numéricos
      return {
        ...raw,
        schemaVersion: toNumber(raw.schemaVersion, SCHEMA_VERSION),
        x: toNumber(raw.x, 0),
        y: toNumber(raw.y, 0),
        z: toNumber(raw.z, 7),
      };
  }
}

// ---------------------------------------------------------------------------
// ITEM_SCHEMA — constantes e validação para itens do jogo
// ---------------------------------------------------------------------------
export const ITEM_SCHEMA = Object.freeze({
  types: ["consumable", "equipment", "quest", "material", "currency"],
  equipmentSlots: [
    "weapon",
    "shield",
    "helmet",
    "armor",
    "boots",
    "ring",
    "amulet",
    "backpack",
  ],
  validStats: [
    "atk",
    "def",
    "agi",
    "int",
    "vit",
    "hpBonus",
    "mpBonus",
    "critChance",
  ],
  validEffects: ["heal", "mana", "buff", "teleport", "reveal"],
});

/**
 * Cria um item canônico com sanitização de tipos
 * @param {Object} raw
 * @returns {Object}
 */
export function makeItem({
  id,
  name,
  type = "material",
  description = null,
  spriteId = null,
  weight = 0,
  value = 0,
  stackable = false,
  maxStack = 1,
  // equipamento
  slot = null,
  stats = null,
  // consumível
  effect = null,
  cooldown = 0,
  charges = undefined,
  // posição no mundo (quando no chão)
  x = null,
  y = null,
  z = null,
  ownerId = null,
  expiresAt = null,
  schemaVersion = SCHEMA_VERSION,
  quantity = 1,
  count = undefined,
  ...extra
} = {}) {
  const normalizedQuantityRaw = toNumber(quantity ?? count ?? 1, 1);
  const normalizedQuantity = Math.max(
    1,
    Math.floor(
      Number.isFinite(normalizedQuantityRaw) ? normalizedQuantityRaw : 1,
    ),
  );
  const normalizedChargesRaw = toNumber(charges, 0);
  const normalizedCharges =
    Number.isFinite(normalizedChargesRaw) && normalizedChargesRaw > 0
      ? Math.max(1, Math.floor(normalizedChargesRaw))
      : null;

  return {
    ...extra,
    schemaVersion: toNumber(schemaVersion, SCHEMA_VERSION),
    id: toStringSafe(id, ""),
    name: toStringSafe(name, "Item"),
    type: ITEM_SCHEMA.types.includes(type) ? type : "material",
    description: description ?? null,
    spriteId: spriteId != null ? toNumber(spriteId, 0) : null,
    weight: toNumber(weight, 0),
    value: toNumber(value, 0),
    stackable: Boolean(stackable),
    maxStack: Math.max(1, toNumber(maxStack, 1)),
    quantity: normalizedQuantity,
    count: normalizedQuantity,
    ...(slot != null
      ? { slot: ITEM_SCHEMA.equipmentSlots.includes(slot) ? slot : null }
      : {}),
    ...(stats != null ? { stats: { ...stats } } : {}),
    ...(effect != null ? { effect: { ...effect } } : {}),
    ...(normalizedCharges != null ? { charges: normalizedCharges } : {}),
    ...(cooldown ? { cooldown: toNumber(cooldown, 0) } : {}),
    ...(x != null ? { x: toNumber(x, 0) } : {}),
    ...(y != null ? { y: toNumber(y, 0) } : {}),
    ...(z != null ? { z: toNumber(z, 7) } : {}),
    ...(ownerId != null ? { ownerId: toStringSafe(ownerId, "") } : {}),
    ...(expiresAt != null ? { expiresAt: toNumber(expiresAt, 0) } : {}),
  };
}

/**
 * Valida um item conforme o schema canônico
 * @param {Object} item
 * @param {'inventory'|'world'|'equipment'} context
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateItem(item, context = "inventory") {
  const errors = [];
  if (!item || typeof item !== "object")
    return { valid: false, errors: ["Not an object"] };

  if (!item.id) errors.push("Missing required: id");
  if (!item.name) errors.push("Missing required: name");
  if (!item.type) errors.push("Missing required: type");

  if (item.type && !ITEM_SCHEMA.types.includes(item.type)) {
    errors.push(`Invalid type: ${item.type}`);
  }

  if (item.type === "equipment") {
    if (!item.slot || !ITEM_SCHEMA.equipmentSlots.includes(item.slot)) {
      errors.push(`Invalid equipment slot: ${item.slot}`);
    }
    if (item.stats) {
      for (const stat of Object.keys(item.stats)) {
        if (!ITEM_SCHEMA.validStats.includes(stat)) {
          errors.push(`Invalid stat: ${stat}`);
        }
      }
    }
  }

  if (item.type === "consumable" && item.effect) {
    if (!ITEM_SCHEMA.validEffects.includes(item.effect.type)) {
      errors.push(`Invalid effect type: ${item.effect.type}`);
    }
  }

  if (context === "world" && (item.x == null || item.y == null)) {
    errors.push("World items must have x/y coordinates");
  }

  if (context === "equipment" && item.type !== "equipment") {
    errors.push("Only equipment type items can be equipped");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
export function normalizeCollection(rawCollection, type) {
  if (!rawCollection || typeof rawCollection !== "object") return {};
  const out = {};
  for (const [id, value] of Object.entries(rawCollection)) {
    const normalized = normalizeEntity({ id, ...value }, type);
    if (normalized) out[id] = normalized;
  }
  return out;
}
