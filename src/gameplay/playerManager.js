// =============================================================================
// playerManager.js — mmoRPGGame
// Sincronização e ciclo de vida do player.
// FASE IMEDIATA: zero firebaseClient. Todo acesso ao Firebase via db.js.
// Depende de: db.js, config.js
// =============================================================================

import {
  syncPlayer,
  removePlayer,
  setPlayerData,
  getPlayerData,
  applyHpToPlayer,
  respawnPlayer as dbRespawnPlayer,
  getWorldSpawn,
  batchWrite,
  PATHS,
} from "../core/db.js";
import { WORLDSETTINGS, PLAYERCLASSES } from "../core/config.js";
import { makePlayer } from "../core/schema.js";
import { initializePlayerStats } from "./progression/progressionSystem.js";

// ---------------------------------------------------------------------------
// SINCRONIZAÇÃO DE POSIÇÃO
// Atualiza players_data (persistente) e online_players (sessão) atomicamente.
// ---------------------------------------------------------------------------

export function handlePlayerSync(charId, myPos) {
  const normalized = makePlayer({ id: charId, ...myPos });
  // players_data: apenas subcampos de posição — NUNCA sobrescreve o nó inteiro
  // (evita apagar name, stats, appearance e outros campos permanentes)
  batchWrite({
    [`${PATHS.playerData(charId)}/x`]: normalized.x,
    [`${PATHS.playerData(charId)}/y`]: normalized.y,
    [`${PATHS.playerData(charId)}/z`]: normalized.z,
    [`${PATHS.playerData(charId)}/direcao`]: normalized.direcao,
    [`${PATHS.player(charId)}/x`]: normalized.x,
    [`${PATHS.player(charId)}/y`]: normalized.y,
    [`${PATHS.player(charId)}/z`]: normalized.z,
    [`${PATHS.player(charId)}/direcao`]: normalized.direcao,
    [`${PATHS.player(charId)}/lastMoveTime`]: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// RESPAWN / MORTE
// ---------------------------------------------------------------------------

/**
 * Reseta HP do player para o máximo (após morte).
 * @param {string} playerId
 */
export async function resetPlayerStatus(playerId) {
  const data = await getPlayerData(playerId);
  if (!data?.stats) return;
  const deaths = WORLDSETTINGS.death ?? {};
  const newHp = Math.round(
    (data.stats.maxHp ?? 100) * (deaths.hpRecoveryMultiplier ?? 1),
  );
  const updates = {
    [PATHS.playerDataStats(playerId)]: { hp: newHp },
    [PATHS.playerStats(playerId)]: { hp: newHp },
  };
  if (deaths.clearStatusOnDeath) {
    updates[`${PATHS.playerData(playerId)}/status`] = null;
    updates[`${PATHS.player(playerId)}/status`] = null;
  }
  await batchWrite(updates);
}

/**
 * Teleporta o player para o spawn e reseta HP.
 * @param {string} playerId
 */
export async function respawnPlayer(playerId) {
  // Lê spawn do Firebase; fallback para config local se ainda não definido
  const spawn = (await getWorldSpawn()) ?? WORLDSETTINGS.spawn;
  const { x, y, z } = spawn;
  const data = await getPlayerData(playerId);
  const hp = data?.stats?.maxHp ?? 100;
  // dbRespawnPlayer (db.js) atualiza players_data + online_players atomicamente
  await dbRespawnPlayer(playerId, { x, y, z, hp });
}

// ---------------------------------------------------------------------------
// ADMINISTRAÇÃO
// ---------------------------------------------------------------------------

/** Remove o player da lista de online (kick / logout). */
export async function kickPlayer(playerId) {
  await removePlayer(playerId);
}

/**
 * Cria o registro inicial de um novo personagem.
 * @param {string} playerId
 * @param {string|Object} nameOrData
 * @param {'cavaleiro'|'mago'|'arqueiro'|'clerigo'|'druid'} [playerClass]
 */
export async function createPlayer(playerId, nameOrData, playerClass) {
  const payload =
    nameOrData && typeof nameOrData === "object"
      ? nameOrData
      : { name: nameOrData, class: playerClass };

  const resolvedClass = payload.class || "cavaleiro";
  const cls = PLAYERCLASSES?.[resolvedClass] ?? PLAYERCLASSES?.cavaleiro ?? {};
  // Lê spawn do Firebase; fallback para config local se ainda não definido
  const spawn = (await getWorldSpawn()) ?? WORLDSETTINGS.spawn;
  const initialStats = initializePlayerStats(resolvedClass);

  const player = makePlayer({
    id: playerId,
    name: payload.name,
    class: resolvedClass,
    x: payload.x ?? spawn.x,
    y: payload.y ?? spawn.y,
    z: payload.z ?? spawn.z,
    direcao: "frente",
    speed: cls.speed ?? 120,
    appearance: {
      outfitId: 10000,
      outfitPack: "outfits_01",
      class: resolvedClass,
    },
    stats: initialStats,
    spawnX: spawn.x,
    spawnY: spawn.y,
    spawnZ: spawn.z,
  });

  await setPlayerData(playerId, player);
  return player;
}
