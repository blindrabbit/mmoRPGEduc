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
  atk = 10,
  def = 5,
  agi = 10,
  level = 1,
} = {}) {
  return {
    hp: toNumber(hp, 100),
    maxHp: toNumber(maxHp, 100),
    mp: toNumber(mp, 50),
    maxMp: toNumber(maxMp, 50),
    atk: toNumber(atk, 10),
    def: toNumber(def, 5),
    agi: toNumber(agi, 10),
    level: toNumber(level, 1),
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
    stats: makeStats(stats),
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

export function normalizeCollection(rawCollection, type) {
  if (!rawCollection || typeof rawCollection !== "object") return {};
  const out = {};
  for (const [id, value] of Object.entries(rawCollection)) {
    const normalized = normalizeEntity({ id, ...value }, type);
    if (normalized) out[id] = normalized;
  }
  return out;
}
