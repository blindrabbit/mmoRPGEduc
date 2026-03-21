// ═══════════════════════════════════════════════════════════════
// WorldStore.js — Acesso centralizado ao estado do mundo
// Usado pelos validators e handlers do worldEngine
//
// Adapta as fontes de dados existentes:
//   • worldStore.js (cache in-memory de players/monsters)
//   • db.js / firebaseClient.js (Firebase Realtime Database)
//   • ItemDataService (metadata de itens do map_data.json)
//   • MapChunkSubscriber (tiles do mapa por chunk)
//
// @serverOnly — rodar apenas no contexto do worldEngine
// ═══════════════════════════════════════════════════════════════

import { dbGet, PATHS, TILE_CHUNK_SIZE } from "../../../core/db.js";
import { getPlayer } from "../../../core/worldStore.js";
import { getItemDataService } from "../../../gameplay/items/ItemDataService.js";
import { isTileBlockedByWall } from "../../../core/collision.js";
import { FlagResolver } from "../../../core/FlagResolver.js";

// ── Players ────────────────────────────────────────────────────

/**
 * Retorna dados do player mesclando online_players (posição atual) com
 * players_data (level, vocação, premium, etc.).
 * online_players tem prioridade para campos voláteis (x, y, z, stats.hp, etc.)
 * @param {string} playerId
 * @returns {Promise<Object|null>}
 */
export async function wsGetPlayer(playerId) {
  // Cache in-memory de online_players (tem x, y, z, stats em tempo real)
  const online = getPlayer(playerId);

  // Dados persistentes (tem level, vocation, premium, etc.)
  const persistent = await dbGet(PATHS.playerData(playerId));

  if (!online && !persistent) return null;

  // Merge: persistent como base, online sobrescreve (posição atual tem prioridade)
  return { ...persistent, ...(online ?? {}) };
}

// ── Itens no mundo (world_items) ──────────────────────────────

/**
 * Retorna item do mundo pelo ID único.
 * @param {string} itemId - UUID do item no world_items
 * @returns {Promise<Object|null>}
 */
export async function wsGetWorldItem(itemId) {
  return await dbGet(`world_items/${itemId}`);
}

// ── Inventário e Equipamento ──────────────────────────────────

/**
 * Retorna o inventário completo do player.
 * @param {string} playerId
 * @returns {Promise<Object>} { slotIndex: itemData, ... }
 */
export async function wsGetInventory(playerId) {
  return (await dbGet(`players_data/${playerId}/inventory`)) ?? {};
}

/**
 * Retorna item em um slot específico do inventário.
 * @param {string} playerId
 * @param {number|string} slotIndex
 * @returns {Promise<Object|null>}
 */
export async function wsGetInventorySlot(playerId, slotIndex) {
  return await dbGet(`players_data/${playerId}/inventory/${slotIndex}`);
}

/**
 * Retorna o equipamento completo do player.
 * @param {string} playerId
 * @returns {Promise<Object>} { slotId: itemData, ... }
 */
export async function wsGetEquipment(playerId) {
  return (await dbGet(`players_data/${playerId}/equipment`)) ?? {};
}

/**
 * Retorna item equipado em um slot específico.
 * @param {string} playerId
 * @param {number|string} slotId
 * @returns {Promise<Object|null>}
 */
export async function wsGetEquippedItem(playerId, slotId) {
  return await dbGet(`players_data/${playerId}/equipment/${slotId}`);
}

/**
 * Encontra o primeiro slot vazio no inventário (0–19).
 * @param {string} playerId
 * @param {number} [maxSlots=20]
 * @returns {Promise<number|null>} índice do slot ou null se cheio
 */
export async function wsFindEmptyInventorySlot(playerId, maxSlots = 20) {
  const inv = await wsGetInventory(playerId);
  for (let i = 0; i < maxSlots; i++) {
    if (!inv[String(i)]) return i;
  }
  return null;
}

// ── Containers ────────────────────────────────────────────────

/**
 * Retorna dados de um container (que é um world_item com slots internos).
 * @param {string} containerId - ID do container no world_items
 * @returns {Promise<Object|null>}
 */
export async function wsGetContainer(containerId) {
  return await dbGet(`world_items/${containerId}`);
}

/**
 * Retorna item dentro de um container em um slot específico.
 * @param {string} containerId
 * @param {number|string} slotIndex
 * @returns {Promise<Object|null>}
 */
export async function wsGetContainerItem(containerId, slotIndex) {
  return await dbGet(`world_items/${containerId}/slots/${slotIndex}`);
}

/**
 * Encontra o primeiro slot vazio num container.
 * @param {string} containerId
 * @param {number} [maxSlots=20]
 * @returns {Promise<number|null>}
 */
export async function wsFindEmptyContainerSlot(containerId, maxSlots = 20) {
  const container = await wsGetContainer(containerId);
  const slots = container?.slots ?? {};
  for (let i = 0; i < maxSlots; i++) {
    if (!slots[String(i)]) return i;
  }
  return null;
}

// ── Tiles do mapa ─────────────────────────────────────────────

const CHUNK = typeof TILE_CHUNK_SIZE !== "undefined" ? TILE_CHUNK_SIZE : 16;

/**
 * Retorna dados do tile numa posição do mundo.
 * Busca o chunk Firebase e extrai o tile específico.
 * @param {{ x: number, y: number, z: number }} position
 * @returns {Promise<{ items: Array, flags: Object }|null>}
 */
export async function wsGetTile(position) {
  const { x, y, z } = position;
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);

  const chunkData = await dbGet(`${PATHS.tiles}/${z}/${cx},${cy}`);
  if (!chunkData) return null;

  const tileData = chunkData[`${x},${y}`];
  if (!tileData) return null;

  // Extrai IDs dos itens do tile para flags de metadados
  const ids = _extractTileItemIds(tileData);
  const mapData = getItemDataService()?._data ?? {};

  // Verifica se o tile tem algum item explicitamente bloqueante
  // (is_walkable === false ou flags_raw.unpass === true).
  // Tiles sem metadados ou sem flag explícita são considerados válidos para drop.
  const flatTile = { [`${x},${y},${z}`]: tileData };
  const isBlocked = isTileBlockedByWall(x, y, z, flatTile, mapData);
  const isWalkable = !isBlocked;
  const itemCount = ids.length;

  // Resolve flags do tile via FlagResolver (map_flag_definitions.json)
  const tileFlags = FlagResolver.resolve(tileData?.flags ?? 0);

  return {
    items: ids,
    itemCount,
    isWalkable: isWalkable && tileFlags.isWalkable,
    flags: { noItemDrop: isBlocked || !tileFlags.canDropItem },
    protectionZone: tileFlags.isProtectionZone,
    houseId: tileData?.houseId ?? null,
    raw: tileData,
  };
}

function _extractTileItemIds(tileValue) {
  if (!tileValue) return [];
  if (Array.isArray(tileValue)) {
    return tileValue.map((v) => (typeof v === "object" ? v.id : v)).filter(Boolean);
  }
  if (typeof tileValue === "object") {
    // Suporta formato Firebase: { layers: {"0": [...], "2": [...]}, flags: N, houseId: ... }
    const layersObj =
      tileValue.layers != null &&
      typeof tileValue.layers === "object" &&
      !Array.isArray(tileValue.layers)
        ? tileValue.layers
        : tileValue;
    const ids = [];
    for (const layer of Object.values(layersObj)) {
      if (Array.isArray(layer)) {
        for (const item of layer) {
          const id = typeof item === "object" ? item.id : item;
          if (id != null) ids.push(id);
        }
      }
    }
    return ids;
  }
  return [];
}

// ── Contagem de world_items no tile ───────────────────────────

/**
 * Conta quantos world_items existem numa posição do mapa.
 * Usado pelo validator para checar limite de itens por tile (max 10).
 * @param {{ x: number, y: number, z: number }} position
 * @returns {Promise<number>}
 */
export async function wsCountWorldItemsAt(position) {
  const { x, y, z } = position;
  const allItems = await dbGet("world_items");
  if (!allItems || typeof allItems !== "object") return 0;

  let count = 0;
  for (const item of Object.values(allItems)) {
    if (
      item &&
      Math.round(Number(item.x)) === Math.round(x) &&
      Math.round(Number(item.y)) === Math.round(y) &&
      Math.round(Number(item.z ?? 7)) === Math.round(z)
    ) {
      count++;
    }
  }
  return count;
}

// ── Definições de itens (ItemDataService) ─────────────────────

/**
 * Retorna metadata de um tipo de item pelo ID.
 * @param {number|string} itemTypeId
 * @returns {Object|null}
 */
export function wsGetItemDefinition(itemTypeId) {
  return getItemDataService()?._get(itemTypeId) ?? null;
}
