// =============================================================================
// worldStore.js — mmoRPGGame  [FASE IMEDIATA — refatorado]
// Estado global do mundo — fonte única de verdade.
// Usado por: worldEngine.html, rpg.html, admin.html
//
// MUDANÇA: import { dbWatch } from './firebaseClient.js'
//       → import { watchMonsters, watchPlayers,
//                  watchEffectsChildren, watchFields } from './db.js'
//
// Nenhuma outra lógica foi alterada nesta fase.
// =============================================================================

// ✅ FASE IMEDIATA: só db.js, zero firebaseClient direto
import {
  watchMonsters,
  watchPlayers,
  watchEffectsChildren,
  watchFields,
  watchMonsterTemplates,
  watchChat,
  dbGet,
  PATHS,
} from "./db.js";
import {
  inferSpeciesFromName,
  getMonsterTemplates,
  setMonsterTemplates,
} from "./remoteTemplates.js";
import { normalizeCollection, normalizeEntity } from "./schema.js";
import { worldEvents, EVENT_TYPES } from "./events.js";

// ---------------------------------------------------------------------------
// ESTADO INTERNO
// ---------------------------------------------------------------------------
const state = {
  monsters: {}, // world_entities  (type: monster)
  players: {}, // online_players
  effects: {}, // world_effects
  fields: {}, // world_fields
  chat: [], // world_chat (array de mensagens recentes)
};

// Maps para acesso rápido por ID (usados por funções newer)
const _monsters = new Map(); // espelho do state.monsters para .get/.set/.delete
const _players = new Map(); // espelho do state.players para .get/.set/.delete

// Subscribers por canal
const subs = {
  monsters: new Set(),
  players: new Set(),
  effects: new Set(),
  fields: new Set(),
  chat: new Set(),
};

// Flag exposta para o worldEngine bloquear durante o tick
export let tickRunning = false;
export function setTickRunning(val) {
  tickRunning = val;
}

// ---------------------------------------------------------------------------
// INIT — chame uma vez no boot de qualquer tela
// ---------------------------------------------------------------------------
let initialized = false;

export function initWorldStore() {
  if (initialized) return;
  initialized = true;

  // world_entities — monstros
  watchMonsters((data) => {
    if (tickRunning) return; // WorldEngine não sobrescreve durante tick
    mergeMonsters(normalizeCollection(data, "monster"));
    notify("monsters", state.monsters);
  });

  // também faz uma leitura pontual imediata para garantir que qualquer
  // monstro persistido *antes* da conexão seja carregado mesmo que o
  // watcher não tenha disparado ainda (problema raro com onValue).
  dbGet(PATHS.monsters)
    .then((initial) => {
      if (initial) {
        mergeMonsters(normalizeCollection(initial, "monster"));
        notify("monsters", state.monsters);
        // console.log("[worldStore] initial monsters fetched", Object.keys(state.monsters).length);
      }
    })
    .catch((e) => {
      console.warn("[worldStore] failed to fetch initial monsters", e);
    });

  // online_players — jogadores
  watchPlayers((data) => {
    mergePlayers(normalizeCollection(data, "player"));
    notify("players", state.players);
  });

  // world_effects — efeitos visuais e cadáveres
  // Usa child_added/removed em vez de onValue para que cada effect
  // apareça individualmente assim que chega — sem esperar todos os
  // filhos de um batchWrite (crítico para animações AOE em sequência).
  watchEffectsChildren({
    onAdd: (id, data) => {
      if (!data) return;
      const normalized = normalizeEntity({ id, ...data }, "effect");
      if (normalized) {
        state.effects[id] = normalized;
        notify("effects", state.effects);
      }
    },
    onRemove: (id) => {
      delete state.effects[id];
      notify("effects", state.effects);
    },
    onChange: (id, data) => {
      if (!data) {
        delete state.effects[id];
      } else {
        const normalized = normalizeEntity({ id, ...data }, "effect");
        if (normalized) state.effects[id] = normalized;
      }
      notify("effects", state.effects);
    },
  });

  // world_fields — campos persistentes (fogo, veneno, etc.)
  watchFields((data) => {
    state.fields = normalizeCollection(data, "field");
    notify("fields", state.fields);
  });

  // monster_templates — catálogo remoto canônico (nome/species/ataques)
  watchMonsterTemplates((data) => {
    setMonsterTemplates(data || {});
  });

  // world_chat — mensagens de chat (child_added, entregue uma a uma)
  watchChat((msg) => {
    state.chat.push(msg);
    if (state.chat.length > 200) state.chat.shift(); // cap local
    notify("chat", msg);
  });
}

// ---------------------------------------------------------------------------
// GETTERS
// ---------------------------------------------------------------------------
export const getMonsters = () => state.monsters;
export const getPlayers = () => state.players;
export const getEffects = () => state.effects;
export const getFields = () => state.fields;
export const getChat = () => state.chat;

// ---------------------------------------------------------------------------
// SUBSCRIBE — qualquer tela recebe updates em tempo real
// canal: 'monsters' | 'players' | 'effects' | 'fields'
// ---------------------------------------------------------------------------
export function subscribe(canal, cb) {
  subs[canal].add(cb);
  // Dispara imediatamente com o estado atual se já tiver dados
  const current = state[canal];
  const hasData = Array.isArray(current)
    ? current.length > 0
    : Object.keys(current).length > 0;
  if (hasData) cb(current);
  return () => subs[canal].delete(cb); // retorna unsubscribe
}

// ---------------------------------------------------------------------------
// INTERNOS
// ---------------------------------------------------------------------------
function notify(canal, data) {
  for (const cb of subs[canal]) cb(data);
}

// Mescla monstros preservando campos de controle de IA
function mergeMonsters(incoming) {
  if (!incoming) {
    // Firebase deletou o nó inteiro (ex: clearMonsters)
    state.monsters = {};
    _monsters.clear();
    return;
  }

  // Remove entidades deletadas do Firebase
  for (const id in state.monsters) {
    if (!incoming[id]) delete state.monsters[id];
  }

  // Mescla entidades existentes e adiciona novas
  for (const id in incoming) {
    // normalize: if entry looks like a monster but has no type, add it
    const entry = incoming[id];
    if (entry && !entry.type) {
      if (
        typeof entry.species === "string" ||
        id.startsWith("mob") ||
        (!!entry.stats && !entry.type)
      ) {
        entry.type = "monster";
      }
    }
    // infer species by name when it's missing (helps renderers and AI)
    if (entry && entry.type === "monster" && !entry.species && entry.name) {
      const inferred = inferSpeciesFromName(entry.name);
      if (inferred) {
        entry.species = inferred;
      }
    }

    if (!state.monsters[id]) {
      // Entidade nova: aceita direto
      // Se é nova e tem posição, marca o timestamp do movimento agora
      // para que a interpolação comece corretamente
      if (entry.x != null && entry.y != null && !entry.lastMoveTime) {
        entry.lastMoveTime = Date.now();
      }
      state.monsters[id] = entry;
    } else {
      // Entidade existente: preserva campos de IA
      const local = state.monsters[id];
      // log when incoming is missing crucial positional data
      // if (entry.x == null || entry.y == null) {
      //   console.warn(`[mergeMonsters] partial update dropping coords for ${id}`, entry);
      // }

      // ✅ DETECTA MOVIMENTO: se x ou y mudaram, atualiza lastMoveTime
      const newX = entry.x != null ? entry.x : local.x;
      const newY = entry.y != null ? entry.y : local.y;
      const moved = newX !== local.x || newY !== local.y;

      // Se monstro se moveu e servidor não enviou timestamp novo,
      // atualiza para agora (permite interpolação visual)
      let moveTimestamp = entry.lastMoveTime ?? local.lastMoveTime;
      if (moved && !entry.lastMoveTime) {
        moveTimestamp = Date.now();
        console.debug(
          `[mergeMonsters] movement detected for ${id}, updating lastMoveTime`,
        );
      }

      // Se monstro se moveu, preserva posição antiga para interpolação
      let oldXForInterp = local.oldX;
      let oldYForInterp = local.oldY;
      if (moved) {
        oldXForInterp = local.x;
        oldYForInterp = local.y;
      }

      // merge incoming monster with local state, but allow server timestamps
      // (moveTime/attack/etc) to override so clients like RPG see fresh values.
      // if the incoming update explicitly wipes the name, keep the old one
      if (entry && entry.name == null && local.name) {
        entry.name = local.name;
      }

      let merged = {
        // start with the local state, then overwrite with any fields that
        // actually exist in the incoming entry to treat the update as
        // partial rather than replace-all. undefined values in `entry`
        // should not erase existing data.
        ...local,
        ...entry,
        lastAiTick: local.lastAiTick ?? entry.lastAiTick,
        lastAttack: local.lastAttack ?? entry.lastAttack,
        lastMoveTime: moveTimestamp,
        dead: entry.dead ?? local.dead,
        // keep position/direction unless server explicitly provides them
        x: newX,
        y: newY,
        z: entry.z != null ? entry.z : local.z,
        direcao: entry.direcao != null ? entry.direcao : local.direcao,
        // preserve visual interpolation state so movement is detected
        oldX: oldXForInterp ?? entry.oldX,
        oldY: oldYForInterp ?? entry.oldY,
        // Preserva todos os campos de cooldown de IA (cdXxx)
        ...Object.fromEntries(
          Object.entries(local).filter(([k]) => k.startsWith("cd")),
        ),
      };

      // Normaliza nome canônico por espécie para evitar drift entre
      // monsterData/monster_templates e registros antigos em world_entities.
      if (merged.species) {
        const remote = getMonsterTemplates();
        const canonicalName = remote?.[merged.species]?.name;
        if (canonicalName) {
          merged.name = canonicalName;
        }
      }

      state.monsters[id] = merged;
    }
  }

  // Sincroniza o Map _monsters com state.monsters
  _monsters.clear();
  for (const id in state.monsters) {
    _monsters.set(id, state.monsters[id]);
  }
}

// Mescla players preservando interpolação local de movimento
function mergePlayers(incoming) {
  if (!incoming) {
    state.players = {};
    _players.clear();
    return;
  }

  for (const id in state.players) {
    if (!incoming[id]) delete state.players[id];
  }

  for (const id in incoming) {
    const entry = incoming[id];

    if (!state.players[id]) {
      if (entry.x != null && entry.y != null && !entry.lastMoveTime) {
        entry.lastMoveTime = Date.now();
      }
      state.players[id] = entry;
      continue;
    }

    const local = state.players[id];
    const newX = entry.x != null ? entry.x : local.x;
    const newY = entry.y != null ? entry.y : local.y;
    const moved = newX !== local.x || newY !== local.y;

    let moveTimestamp = entry.lastMoveTime ?? local.lastMoveTime;
    if (moved) {
      moveTimestamp = Date.now();
    }

    let oldXForInterp = local.oldX;
    let oldYForInterp = local.oldY;
    if (moved) {
      oldXForInterp = local.x;
      oldYForInterp = local.y;
    }

    state.players[id] = {
      ...local,
      ...entry,
      x: newX,
      y: newY,
      z: entry.z != null ? entry.z : local.z,
      direcao: entry.direcao != null ? entry.direcao : local.direcao,
      lastMoveTime: moveTimestamp,
      oldX: oldXForInterp ?? entry.oldX,
      oldY: oldYForInterp ?? entry.oldY,
    };
  }

  // Sincroniza o Map _players com state.players
  _players.clear();
  for (const id in state.players) {
    _players.set(id, state.players[id]);
  }
}

// =============================================================================
// worldStore.js — mmoRPGEduc (ATUALIZADO)
// ADICIONAR no final do arquivo, após as funções existentes:
// =============================================================================

// ---------------------------------------------------------------------------
// EXPORTS PARA PROGRESSION/COMBAT (ADICIONAR)
// ---------------------------------------------------------------------------

/**
 * Obtém um player específico pelo ID
 * @param {string} playerId
 * @returns {Object|undefined}
 */
export function getPlayer(playerId) {
  return state.players?.[playerId];
}

/**
 * Obtém um monstro específico pelo ID
 * @param {string} monsterId
 * @returns {Object|undefined}
 */
export function getMonster(monsterId) {
  return state.monsters?.[monsterId];
}

/**
 * Atualiza player localmente (para sync com Firebase)
 * @param {string} playerId
 * @param {Object} updates
 */
export function applyPlayersLocal(playerId, updates) {
  const player = state.players?.[playerId];
  if (!player) return;

  const merged = {
    ...player,
    ...updates,
    ...(updates?.stats
      ? { stats: { ...(player.stats ?? {}), ...updates.stats } }
      : {}),
  };

  state.players[playerId] = merged;
  _players.set(playerId, merged);
  notify("players", state.players);

  // Emite evento para UI atualizar
  if (
    typeof worldEvents !== "undefined" &&
    typeof EVENT_TYPES !== "undefined"
  ) {
    worldEvents.emit(EVENT_TYPES.ENTITY_UPDATE, {
      type: "player",
      id: playerId,
      updates: merged,
      timestamp: Date.now(),
    });
  }
}

/**
 * Atualiza monstro localmente
 * @param {string} monsterId
 * @param {Object} updates
 */
export function applyMonstersLocal(monsterId, updates) {
  const monster = state.monsters[monsterId] ?? _monsters.get(monsterId);
  if (!monster) return;

  const merged = {
    ...monster,
    ...updates,
    ...(updates?.stats
      ? { stats: { ...(monster.stats ?? {}), ...updates.stats } }
      : {}),
  };

  state.monsters[monsterId] = merged;
  _monsters.set(monsterId, merged);
  notify("monsters", state.monsters);

  worldEvents.emit(EVENT_TYPES.ENTITY_UPDATE, {
    type: "monster",
    id: monsterId,
    updates: merged,
    timestamp: Date.now(),
  });
}

/**
 * Remove player do cache local
 */
export function removePlayerLocal(playerId) {
  delete state.players?.[playerId];
  _players.delete(playerId);
  notify("players", state.players);
  if (
    typeof worldEvents !== "undefined" &&
    typeof EVENT_TYPES !== "undefined"
  ) {
    worldEvents.emit(EVENT_TYPES.ENTITY_DESPAWN, {
      type: "player",
      id: playerId,
      timestamp: Date.now(),
    });
  }
}

/**
 * Remove monstro do cache local
 */
export function removeMonsterLocal(monsterId) {
  delete state.monsters?.[monsterId];
  _monsters.delete(monsterId);
  notify("monsters", state.monsters);
  if (
    typeof worldEvents !== "undefined" &&
    typeof EVENT_TYPES !== "undefined"
  ) {
    worldEvents.emit(EVENT_TYPES.ENTITY_DESPAWN, {
      type: "monster",
      id: monsterId,
      timestamp: Date.now(),
    });
  }
}

// Re-exportar estado para compatibilidade (se necessario)
export { state };
