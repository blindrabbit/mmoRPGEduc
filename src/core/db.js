// =============================================================================
// db.js — mmoRPGGame (v2.2 — Final)
// Camada 1: Único ponto de acesso ao Firebase Realtime Database.
// =============================================================================

import {
  dbGet,
  dbSet,
  dbWatch,
  dbWatchChildren,
  dbUpdate as _dbUpdateClient,
  syncEntity as _syncEntity,
} from "./firebaseClient.js";
import {
  makePlayer,
  makeMonster,
  makeEffect,
  makeField,
  normalizeEntity,
  normalizeCollection,
} from "./schema.js";

// Re-exporta as primitivas para o playerManager.html e outros módulos
export { dbGet, dbSet, dbWatch };

// ---------------------------------------------------------------------------
// UTILITÁRIOS — Base64 & Formatação
// ---------------------------------------------------------------------------

export const encodeUser = (user) => {
  try {
    return btoa(user);
  } catch (e) {
    return btoa(unescape(encodeURIComponent(user)));
  }
};

export const decodeUser = (encoded) => {
  if (!encoded) return "N/A";
  try {
    // Suporte para transição de dados antigos (_at_ / _dot_)
    if (encoded.includes("_at_") || encoded.includes("_dot_")) {
      return encoded.replace(/_at_/g, "@").replace(/_dot_/g, ".");
    }
    // Tenta decodificar base64
    const decoded = atob(encoded);
    return decoded;
  } catch (e) {
    // Se falhar decodificação, retorna o valor original (pode ser que já esteja decodificado)
    return encoded;
  }
};

export const formatDisplayName = (fullName) => {
  if (!fullName) return "Jogador";
  const parts = fullName.trim().split(/\s+/);
  return parts.length < 2 ? parts[0] : `${parts[0]} ${parts[parts.length - 1]}`;
};

function safePath(...parts) {
  const safeParts = parts.map((part) => {
    if (
      typeof part === "string" &&
      (part.includes("@") || part.includes("."))
    ) {
      return encodeUser(part);
    }
    return String(part);
  });
  return safeParts.join("/");
}

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------
export const PATHS = {
  monsters: "world_entities",
  monster: (id) => safePath("world_entities", id),
  players: "online_players",
  playersData: "players_data",
  player: (id) => safePath("online_players", id),
  playerStats: (id) => safePath("online_players", id, "stats"),
  playerData: (id) => safePath("players_data", id),
  playerDataStats: (id) => safePath("players_data", id, "stats"),
  effects: "world_effects",
  effect: (id) => safePath("world_effects", id),
  fields: "world_fields",
  field: (id) => safePath("world_fields", id),
  tiles: "world_tiles",
  tilesData: "world_tiles_data",
  worldState: "world_state",
  account: (userOrUuid) =>
    `accounts/${userOrUuid.includes("@") ? encodeUser(userOrUuid) : userOrUuid}`,
  serverTime: ".info/serverTimeOffset",
  monsterTemplates: "monster_templates",
  actions:           "player_actions",
  action:            (id) => safePath("player_actions", id),
  chat:              "world_chat",
  chatMsg:           (id) => safePath("world_chat", id),
};

const WRITE_GUARD = {
  minCoord: -8192,
  maxCoord: 8192,
  minZ: 0,
  maxZ: 15,
  minSpeed: 1,
  maxSpeed: 600,
  minHp: 0,
  maxHp: 200000,
  minDuration: 0,
  maxDuration: 86_400_000,
  minTickRate: 50,
  maxTickRate: 60_000,
};

const VALID_DIRECTIONS = new Set([
  "frente",
  "costas",
  "lado",
  "lado-esquerdo",
]);

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function enforceEntityBounds(entity, type) {
  if (!entity || typeof entity !== "object") return entity;

  const next = { ...entity };

  const nx = toNumberOrNull(next.x);
  const ny = toNumberOrNull(next.y);
  const nz = toNumberOrNull(next.z);
  if (nx != null)
    next.x = clamp(Math.round(nx), WRITE_GUARD.minCoord, WRITE_GUARD.maxCoord);
  if (ny != null)
    next.y = clamp(Math.round(ny), WRITE_GUARD.minCoord, WRITE_GUARD.maxCoord);
  if (nz != null)
    next.z = clamp(Math.round(nz), WRITE_GUARD.minZ, WRITE_GUARD.maxZ);

  if (typeof next.direcao === "string" && !VALID_DIRECTIONS.has(next.direcao)) {
    next.direcao = "frente";
  }

  const speed = toNumberOrNull(next.speed);
  if (speed != null) {
    next.speed = clamp(
      Math.round(speed),
      WRITE_GUARD.minSpeed,
      WRITE_GUARD.maxSpeed,
    );
  }

  if (next.stats && typeof next.stats === "object") {
    const stats = { ...next.stats };
    const hp = toNumberOrNull(stats.hp);
    const maxHp = toNumberOrNull(stats.maxHp);
    const mp = toNumberOrNull(stats.mp);
    const maxMp = toNumberOrNull(stats.maxMp);

    if (maxHp != null) stats.maxHp = clamp(maxHp, 1, WRITE_GUARD.maxHp);
    if (hp != null) {
      const hpCap = stats.maxHp != null ? Number(stats.maxHp) : WRITE_GUARD.maxHp;
      stats.hp = clamp(hp, WRITE_GUARD.minHp, hpCap);
    }
    if (maxMp != null) stats.maxMp = clamp(maxMp, 0, WRITE_GUARD.maxHp);
    if (mp != null) {
      const mpCap = stats.maxMp != null ? Number(stats.maxMp) : WRITE_GUARD.maxHp;
      stats.mp = clamp(mp, 0, mpCap);
    }

    next.stats = stats;
  }

  if (type === "field") {
    const damage = toNumberOrNull(next.damage);
    const tickRate = toNumberOrNull(next.tickRate);
    const fieldDuration = toNumberOrNull(next.fieldDuration);

    if (damage != null) next.damage = clamp(damage, 0, WRITE_GUARD.maxHp);
    if (tickRate != null) {
      next.tickRate = clamp(
        tickRate,
        WRITE_GUARD.minTickRate,
        WRITE_GUARD.maxTickRate,
      );
    }
    if (fieldDuration != null) {
      next.fieldDuration = clamp(
        fieldDuration,
        WRITE_GUARD.minDuration,
        WRITE_GUARD.maxDuration,
      );
    }
  }

  if (type === "effect") {
    const effectDuration = toNumberOrNull(next.effectDuration);
    const fieldDuration = toNumberOrNull(next.fieldDuration);
    if (effectDuration != null) {
      next.effectDuration = clamp(
        effectDuration,
        WRITE_GUARD.minDuration,
        WRITE_GUARD.maxDuration,
      );
    }
    if (fieldDuration != null) {
      next.fieldDuration = clamp(
        fieldDuration,
        WRITE_GUARD.minDuration,
        WRITE_GUARD.maxDuration,
      );
    }
  }

  return next;
}

function sanitizePrimitivePath(path, value) {
  if (value === null) return null;

  const numericField = toNumberOrNull(value);

  if (/\/(x|y)$/.test(path)) {
    if (numericField == null) return undefined;
    return clamp(
      Math.round(numericField),
      WRITE_GUARD.minCoord,
      WRITE_GUARD.maxCoord,
    );
  }

  if (/\/z$/.test(path)) {
    if (numericField == null) return undefined;
    return clamp(Math.round(numericField), WRITE_GUARD.minZ, WRITE_GUARD.maxZ);
  }

  if (/\/direcao$/.test(path)) {
    const dir = String(value ?? "frente");
    return VALID_DIRECTIONS.has(dir) ? dir : "frente";
  }

  if (/\/(hp|maxHp|mp|maxMp)$/.test(path)) {
    if (numericField == null) return undefined;
    return clamp(numericField, WRITE_GUARD.minHp, WRITE_GUARD.maxHp);
  }

  if (/\/(lastMoveTime|lastAttack|lastAiTick|startTime|expiry|lastTick)$/.test(path)) {
    if (numericField == null) return undefined;
    return Math.max(0, Math.round(numericField));
  }

  if (/\/(effectDuration|fieldDuration)$/.test(path)) {
    if (numericField == null) return undefined;
    return clamp(numericField, WRITE_GUARD.minDuration, WRITE_GUARD.maxDuration);
  }

  if (/\/tickRate$/.test(path)) {
    if (numericField == null) return undefined;
    return clamp(
      numericField,
      WRITE_GUARD.minTickRate,
      WRITE_GUARD.maxTickRate,
    );
  }

  if (/\/(effectId|fieldId)$/.test(path)) {
    if (numericField == null) return null;
    return Math.max(0, Math.round(numericField));
  }

  return value;
}

function sanitizeObjectPath(path, value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  if (/^online_players\/[^/]+$/.test(path) || /^players_data\/[^/]+$/.test(path)) {
    const id = path.split("/")[1];
    return enforceEntityBounds(makePlayer({ id, ...value }), "player");
  }

  if (/^world_entities\/[^/]+$/.test(path)) {
    const id = path.split("/")[1];
    return enforceEntityBounds(makeMonster({ id, ...value }), "monster");
  }

  if (/^world_effects\/[^/]+$/.test(path)) {
    const id = path.split("/")[1];
    return enforceEntityBounds(makeEffect({ id, ...value }), "effect");
  }

  if (/^world_fields\/[^/]+$/.test(path)) {
    const id = path.split("/")[1];
    return enforceEntityBounds(makeField({ id, ...value }), "field");
  }

  if (/\/stats$/.test(path)) {
    return enforceEntityBounds({ stats: value }, "player").stats;
  }

  return value;
}

function sanitizeValueByPath(path, value) {
  const objectSanitized = sanitizeObjectPath(path, value);
  if (objectSanitized === null) return null;
  if (
    objectSanitized &&
    typeof objectSanitized === "object" &&
    !Array.isArray(objectSanitized)
  ) {
    return objectSanitized;
  }
  return sanitizePrimitivePath(path, objectSanitized);
}

function sanitizeUpdatesMap(updates) {
  if (!updates || typeof updates !== "object") return {};

  const clean = {};
  for (const [path, rawValue] of Object.entries(updates)) {
    if (!path || typeof path !== "string") continue;
    if (path.includes("..") || path.startsWith("/")) continue;

    const sanitized = sanitizeValueByPath(path, rawValue);
    if (sanitized === undefined) continue;

    clean[path] = sanitized;
  }
  return clean;
}

export const dbUpdate = (updates) => {
  const clean = sanitizeUpdatesMap(updates);
  const keys = Object.keys(clean);
  if (!keys.length) {
    console.warn("[db] dbUpdate bloqueado: nenhuma operação válida após validação");
    return Promise.resolve();
  }
  return _dbUpdateClient(clean);
};

// ---------------------------------------------------------------------------
// NOVAS FUNÇÕES DE CONTA (UUID & BASE64)
// ---------------------------------------------------------------------------

export const getAccountByUUID = async (uuid) => {
  const data = await dbGet(`accounts/${uuid}`);
  if (!data) return null;
  return {
    ...data,
    user: decodeUser(data.user),
    gameName: formatDisplayName(data.gameName),
  };
};

export const findAccountByEmail = async (emailRaw) => {
  const allAccounts = await dbGet("accounts");
  if (!allAccounts) return null;

  // Procura decodificando o valor do banco para comparar com o texto limpo digitado
  const foundEntry = Object.entries(allAccounts).find(([uuid, data]) => {
    return decodeUser(data.user) === emailRaw;
  });

  if (foundEntry) {
    const [uuid, data] = foundEntry;
    return {
      ...data,
      uuid,
      user: emailRaw,
      gameName: formatDisplayName(data.fullName),
    };
  }
  return null;
};

// No seu db.js, adicione estas funções de conveniência:

// No seu db.js

/** * ✅ ALTO NÍVEL: Busca APENAS os dados dentro da pasta 'accounts'
 */
export const getAllAccounts = async () => {
  // Forçamos o caminho correto para não ler a raiz do Firebase
  return await dbGet("accounts");
};

/** * ✅ ALTO NÍVEL: Salva um jogador no local correto usando UUID
 */
export const saveAccount = (uuid, data) => {
  return dbSet(`accounts/${uuid}`, data);
};

/** * ✅ ALTO NÍVEL: Remove apenas do nó de contas
 */
export const deleteAccount = (uuid) => {
  return dbSet(`accounts/${uuid}`, null);
};

// ---------------------------------------------------------------------------
// WATCHERS, GETS E SETS
// ---------------------------------------------------------------------------
export const watchMonsters = (cb) =>
  dbWatch(PATHS.monsters, (data) => cb(normalizeCollection(data, "monster")));
export const watchPlayers = (cb) =>
  dbWatch(PATHS.players, (data) => cb(normalizeCollection(data, "player")));
export const watchEffects = (cb) =>
  dbWatch(PATHS.effects, (data) => cb(normalizeCollection(data, "effect")));

/**
 * Escuta filhos de world_effects individualmente (child_added / child_removed).
 * Cada effect aparece no cliente assim que chega — sem aguardar snapshot completo.
 * Usar no worldStore em vez de watchEffects para animações AOE responsivas.
 */
export const watchEffectsChildren = (callbacks) =>
  dbWatchChildren(PATHS.effects, callbacks);
export const watchFields = (cb) =>
  dbWatch(PATHS.fields, (data) => cb(normalizeCollection(data, "field")));
export const watchPlayerData = (id, cb) =>
  dbWatch(PATHS.playerData(id), (data) =>
    cb(data ? makePlayer({ id, ...data }) : null),
  );
export const watchServerTime = (cb) => dbWatch(PATHS.serverTime, cb);
export const watchWorldState = (cb) => dbWatch(PATHS.worldState, cb);

export const getPlayerData = async (id) => {
  const raw = await dbGet(PATHS.playerData(id));
  return raw ? makePlayer({ id, ...raw }) : null;
};
export const getMap = () => dbGet(PATHS.tiles);
export const getMapData = () => dbGet(PATHS.tilesData);

export const setPlayerData = (id, data) =>
  dbSet(PATHS.playerData(id), makePlayer({ id, ...(data ?? {}) }));
export const setMap = (data) => dbSet(PATHS.tiles, data);
export const setMapData = (data) => dbSet(PATHS.tilesData, data);
export const setWorldState = (data) => dbSet(PATHS.worldState, data);
export const getWorldState = () => dbGet(PATHS.worldState);

// account helpers — use findAccountByEmail or saveAccount instead
export const getAccount = async (emailOrUuid) => {
  // Se contiver @, busca por email; senão, busca por UUID
  if (emailOrUuid.includes("@")) {
    return await findAccountByEmail(emailOrUuid);
  } else {
    return await getAccountByUUID(emailOrUuid);
  }
};
export const setAccount = (uuid, data) => dbSet(`accounts/${uuid}`, data);

// ---------------------------------------------------------------------------
// OPERAÇÕES DE ENTIDADES E COMBATE
// ---------------------------------------------------------------------------
function normalizeByBasePath(basePath, id, data) {
  if (data === null) return null;
  const raw = { id, ...(data ?? {}) };
  switch (basePath) {
    case PATHS.players:
      return makePlayer(raw);
    case PATHS.monsters:
      return makeMonster(raw);
    case PATHS.effects:
      return makeEffect(raw);
    case PATHS.fields:
      return makeField(raw);
    default:
      return normalizeEntity(raw, "unknown");
  }
}

export const syncEntity = (basePath, id, data) => {
  const path = safePath(basePath, id);
  if (data === null) return _syncEntity(path, null);

  const normalized = normalizeByBasePath(basePath, id, data);
  const sanitized = sanitizeValueByPath(path, normalized);
  if (sanitized === undefined) {
    console.warn("[db] syncEntity bloqueado por validação:", path);
    return Promise.resolve();
  }

  return _syncEntity(path, sanitized);
};
export const removeEntity = (basePath, id) =>
  dbSet(safePath(basePath, id), null);

export const syncMonster = (id, data) => syncEntity(PATHS.monsters, id, data);
export const syncPlayer = (id, data) => syncEntity(PATHS.players, id, data);
export const syncEffect = (id, data) => syncEntity(PATHS.effects, id, data);
export const syncField = (id, data) => syncEntity(PATHS.fields, id, data);

export const removePlayer = (id) => removeEntity(PATHS.players, id);
export const removeMonster = (id) => removeEntity(PATHS.monsters, id);
export const removeEffect = (id) => removeEntity(PATHS.effects, id);
export const removeField = (id) => removeEntity(PATHS.fields, id);
export const clearMonsters = () => dbSet(PATHS.monsters, null);

// ---------------------------------------------------------------------------
// MONSTER TEMPLATES SYNC
// ---------------------------------------------------------------------------
export const watchMonsterTemplates = (cb) =>
  dbWatch(PATHS.monsterTemplates, cb);
export const getMonsterTemplates = () => dbGet(PATHS.monsterTemplates);
export const setMonsterTemplates = (data) =>
  dbSet(PATHS.monsterTemplates, data);

export const kickAllPlayers = () => dbSet(PATHS.players, null);

export const clearWorldForReload = () =>
  dbUpdate({
    [PATHS.tiles]: null,
    [PATHS.tilesData]: null,
    [PATHS.monsterTemplates]: null,
    [PATHS.monsters]: null,
    [PATHS.effects]: null,
    [PATHS.fields]: null,
  });

export function markWorldReloading({
  reloadId,
  reason = "manual-reload",
  by = "worldEngine",
} = {}) {
  return setWorldState({
    status: "reloading",
    isReadyToPlay: false,
    readyCondition: false,
    reloadId: Number(reloadId ?? Date.now()),
    reason: String(reason),
    source: String(by),
    reloadStartedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export function markWorldReady({
  reloadId,
  tilesCount = 0,
  mapDataCount = 0,
  monsterTemplatesCount = 0,
  by = "worldEngine",
} = {}) {
  const hasMap = Number(tilesCount) > 0;
  const hasMapData = Number(mapDataCount) > 0;
  const hasMonsterTemplates = Number(monsterTemplatesCount) > 0;
  const ready = hasMap && hasMapData && hasMonsterTemplates;

  return setWorldState({
    status: ready ? "ready" : "error",
    isReadyToPlay: ready,
    readyCondition: ready,
    conditions: {
      hasMap,
      hasMapData,
      hasMonsterTemplates,
    },
    counts: {
      tiles: Number(tilesCount),
      mapData: Number(mapDataCount),
      monsterTemplates: Number(monsterTemplatesCount),
    },
    reloadId: Number(reloadId ?? Date.now()),
    source: String(by),
    reloadFinishedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export function markWorldReloadError(
  message,
  { reloadId, by = "worldEngine" } = {},
) {
  return setWorldState({
    status: "error",
    isReadyToPlay: false,
    readyCondition: false,
    error: String(message ?? "unknown error"),
    reloadId: Number(reloadId ?? Date.now()),
    source: String(by),
    updatedAt: Date.now(),
  });
}

export function applyHpToPlayer(id, newHp) {
  return dbUpdate({
    [`${PATHS.playerDataStats(id)}/hp`]: Number(newHp),
    [`${PATHS.playerStats(id)}/hp`]: Number(newHp),
  });
}

export function respawnPlayer(id, { x, y, z, hp }) {
  return dbUpdate({
    [`${PATHS.playerData(id)}/x`]: Number(x),
    [`${PATHS.playerData(id)}/y`]: Number(y),
    [`${PATHS.playerData(id)}/z`]: Number(z),
    [`${PATHS.playerDataStats(id)}/hp`]: Number(hp),
    [`${PATHS.player(id)}/x`]: Number(x),
    [`${PATHS.player(id)}/y`]: Number(y),
    [`${PATHS.player(id)}/z`]: Number(z),
    [`${PATHS.playerStats(id)}/hp`]: Number(hp),
  });
}

export function applyMpToPlayer(id, newMp) {
  return batchWrite({
    [`${PATHS.playerDataStats(id)}/mp`]: Number(newMp),
    [`${PATHS.playerStats(id)}/mp`]:     Number(newMp),
  });
}

export function applyHpToMonster(id, newHp) {
  return dbUpdate({
    [`${PATHS.monster(id)}/stats/hp`]: Number(newHp),
  });
}

function normalizeCooldownKey(actionKey) {
  const raw = String(actionKey ?? "").replace(/[^a-zA-Z0-9]/g, "");
  if (!raw) return null;
  if (raw.startsWith("cd") && raw.length > 2) return raw;
  return `cd${raw[0].toUpperCase()}${raw.slice(1)}`;
}

export function setPlayerActionCooldown(id, actionKey, timestamp = Date.now()) {
  const cdKey = normalizeCooldownKey(actionKey);
  if (!cdKey) return Promise.resolve();

  const ts = Math.max(0, Math.round(Number(timestamp) || Date.now()));
  return dbUpdate({
    [`${PATHS.player(id)}/${cdKey}`]: ts,
    [`${PATHS.playerData(id)}/${cdKey}`]: ts,
    [`${PATHS.player(id)}/lastAttack`]: ts,
    [`${PATHS.playerData(id)}/lastAttack`]: ts,
  });
}

export function setPlayerLastAttack(id, timestamp = Date.now()) {
  return setPlayerActionCooldown(id, "basicAttack", timestamp);
}

export const batchWrite = (updates) => dbUpdate(updates);

// ---------------------------------------------------------------------------
// PLAYER ACTIONS — fila de intenções do cliente para o worldEngine validar
// ---------------------------------------------------------------------------

/**
 * Cliente envia uma intenção de ação. O worldEngine lê, valida e executa.
 * A chave é sempre {playerId}_{timestamp} para evitar colisões.
 *
 * @param {string} playerId
 * @param {object} action  — { type, ...payload }
 * @returns {Promise}
 */
export function submitPlayerAction(playerId, action) {
  const id  = `${playerId}_${Date.now()}`;
  const ts  = Date.now();
  return dbSet(PATHS.action(id), {
    id,
    playerId: String(playerId),
    ts,
    expiresAt: ts + 5000,   // worldEngine ignora ações com mais de 5s
    ...action,
  });
}

/**
 * WorldEngine: lê todas as ações pendentes uma vez.
 */
export function getPlayerActions() {
  return dbGet(PATHS.actions);
}

/**
 * WorldEngine: apaga uma ação após processar.
 */
export function deletePlayerAction(id) {
  return dbSet(PATHS.action(id), null);
}

/**
 * WorldEngine: escuta novas ações em tempo real (child_added).
 */
export function watchPlayerActions(cb) {
  return dbWatchChildren(PATHS.actions, { onAdd: (id, data) => cb(id, data) });
}

// ---------------------------------------------------------------------------
// CHAT — world_chat/{id}  (mensagens de proximidade / GM broadcast)
// ---------------------------------------------------------------------------
const CHAT_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Publica uma mensagem no canal de chat.
 * data: { id, playerId, name, msg, x, y, z, ts, isGM? }
 */
export function syncChat(id, data) {
  if (!id || !data?.msg) return Promise.resolve();
  const payload = {
    id:       String(id),
    playerId: String(data.playerId ?? ""),
    name:     String(data.name ?? "?").slice(0, 32),
    msg:      String(data.msg).slice(0, 120),
    x:        Number(data.x ?? 0),
    y:        Number(data.y ?? 0),
    z:        Number(data.z ?? 0),
    ts:       Number(data.ts ?? Date.now()),
    isGM:     Boolean(data.isGM ?? false),
  };
  return dbSet(PATHS.chatMsg(id), payload);
}

/**
 * Escuta novas mensagens de chat (child_added).
 * Ignora mensagens com ts > CHAT_TTL_MS (expiradas).
 */
export function watchChat(cb) {
  return dbWatchChildren(PATHS.chat, {
    onAdd: (id, data) => {
      if (!data) return;
      const age = Date.now() - (data.ts ?? 0);
      if (age > CHAT_TTL_MS) return; // ignora mensagens antigas
      cb({ id, ...data });
    },
  });
}

// ---------------------------------------------------------------------------
// MIGRATION — canonicaliza dados legados para o schema atual
// ---------------------------------------------------------------------------

function stableStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, function replacer(key, val) {
    if (val && typeof val === "object") {
      if (seen.has(val)) return undefined;
      seen.add(val);
      if (Array.isArray(val)) return val;
      return Object.keys(val)
        .sort()
        .reduce((acc, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
    }
    return val;
  });
}

function buildMigrationUpdates(raw, type, rootPath) {
  const updates = {};
  let scanned = 0;
  let changed = 0;

  const normalized = normalizeCollection(raw, type);
  for (const [id, nextValue] of Object.entries(normalized)) {
    scanned++;
    const prevValue = raw?.[id] ?? null;
    if (stableStringify(prevValue) !== stableStringify(nextValue)) {
      updates[`${rootPath}/${id}`] = nextValue;
      changed++;
    }
  }

  return { updates, scanned, changed };
}

export async function previewSchemaMigration() {
  const [playersDataRaw, playersOnlineRaw, monstersRaw, effectsRaw, fieldsRaw] =
    await Promise.all([
      dbGet(PATHS.playersData),
      dbGet(PATHS.players),
      dbGet(PATHS.monsters),
      dbGet(PATHS.effects),
      dbGet(PATHS.fields),
    ]);

  const playersData = buildMigrationUpdates(
    playersDataRaw,
    "player",
    PATHS.playersData,
  );
  const playersOnline = buildMigrationUpdates(
    playersOnlineRaw,
    "player",
    PATHS.players,
  );
  const monsters = buildMigrationUpdates(
    monstersRaw,
    "monster",
    PATHS.monsters,
  );
  const effects = buildMigrationUpdates(effectsRaw, "effect", PATHS.effects);
  const fields = buildMigrationUpdates(fieldsRaw, "field", PATHS.fields);

  return {
    scanned: {
      playersData: playersData.scanned,
      onlinePlayers: playersOnline.scanned,
      monsters: monsters.scanned,
      effects: effects.scanned,
      fields: fields.scanned,
    },
    changed: {
      playersData: playersData.changed,
      onlinePlayers: playersOnline.changed,
      monsters: monsters.changed,
      effects: effects.changed,
      fields: fields.changed,
    },
    totalChanged:
      playersData.changed +
      playersOnline.changed +
      monsters.changed +
      effects.changed +
      fields.changed,
  };
}

export async function runSchemaMigration({ dryRun = true } = {}) {
  const [playersDataRaw, playersOnlineRaw, monstersRaw, effectsRaw, fieldsRaw] =
    await Promise.all([
      dbGet(PATHS.playersData),
      dbGet(PATHS.players),
      dbGet(PATHS.monsters),
      dbGet(PATHS.effects),
      dbGet(PATHS.fields),
    ]);

  const playersData = buildMigrationUpdates(
    playersDataRaw,
    "player",
    PATHS.playersData,
  );
  const playersOnline = buildMigrationUpdates(
    playersOnlineRaw,
    "player",
    PATHS.players,
  );
  const monsters = buildMigrationUpdates(
    monstersRaw,
    "monster",
    PATHS.monsters,
  );
  const effects = buildMigrationUpdates(effectsRaw, "effect", PATHS.effects);
  const fields = buildMigrationUpdates(fieldsRaw, "field", PATHS.fields);

  const allUpdates = {
    ...playersData.updates,
    ...playersOnline.updates,
    ...monsters.updates,
    ...effects.updates,
    ...fields.updates,
  };

  const result = {
    dryRun: Boolean(dryRun),
    scanned: {
      playersData: playersData.scanned,
      onlinePlayers: playersOnline.scanned,
      monsters: monsters.scanned,
      effects: effects.scanned,
      fields: fields.scanned,
    },
    changed: {
      playersData: playersData.changed,
      onlinePlayers: playersOnline.changed,
      monsters: monsters.changed,
      effects: effects.changed,
      fields: fields.changed,
    },
    totalChanged: Object.keys(allUpdates).length,
  };

  if (!dryRun && Object.keys(allUpdates).length > 0) {
    await dbUpdate(allUpdates);
  }

  return result;
}
