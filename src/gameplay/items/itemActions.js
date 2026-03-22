// =============================================================================
// itemActions.js — mmoRPGEduc
// Núcleo de lógica de itens: pegar, soltar, equipar, desequipar, mover slots.
//
// Arquitetura:
//   • Chamado pelo actionProcessor.js via _processItem()
//   • Usa getPlayer() + applyPlayersLocal() do worldStore (cache local)
//   • Integra calculateTotalStats() ao equipar/desequipar
//   • Persiste via batchWrite() no Firebase
//   • Emite eventos via worldEvents (sem dependência de UI)
//
// Estrutura no Firebase:
//   • Inventário:  players_data/{id}/inventory/{slotIndex}  (object, não array)
//   • Equipamento: players_data/{id}/equipment/{slot}
//   • Itens mundo: world_items/{itemId}
//
// Dependências: db.js, schema.js, events.js, worldStore.js, progressionSystem.js
// =============================================================================

import {
  batchWrite,
  dbGet,
  dbSet,
  dbRemove,
  PATHS,
  TILE_CHUNK_SIZE,
} from "../../core/db.js";
import { RuntimeConfig } from "../../core/runtimeConfig.js";
import { makeItem, validateItem, ITEM_SCHEMA } from "../../core/schema.js";
import { worldEvents, EVENT_TYPES } from "../../core/events.js";
import { getPlayer, applyPlayersLocal } from "../../core/worldStore.js";
import { getItemDataService } from "./ItemDataService.js";
import { isTileBlockedByWall } from "../../core/collision.js";

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

export const ITEM_CONFIG = Object.freeze({
  // Distância máxima para pegar item do chão (em tiles)
  // 1 = apenas os 8 SQMs ao redor + SQM do próprio player (Chebyshev ≤ 1)
  pickupRange: 1,

  // Distância máxima para arremessar/largar item no chão
  dropRange: 15,

  // Peso máximo do inventário
  maxInventoryWeight: 500,

  // Tempo que um item fica no chão antes de expirar (ms)
  worldItemExpiry: 15 * 60 * 1000,

  // Cooldown entre usos de consumível (ms)
  consumableCooldown: 1000,

  // Restrições de slots de equipamento
  equipmentRules: {
    weapon: { conflicts: ["shield"] }, // arma de 2 mãos conflita com escudo
    shield: { conflicts: ["weapon"] }, // só se a arma for twoHanded
  },
});

// =============================================================================
// PATHS INTERNOS (complementam PATHS do db.js)
// =============================================================================

const P = {
  worldItem: (id) => `world_items/${id}`,
  worldMapClaim: (id) => `world_map_claims/${id}`,
  inventory: (pid) => `players_data/${pid}/inventory`,
  inventorySlot: (pid, slot) => `players_data/${pid}/inventory/${slot}`,
  equipment: (pid) => `players_data/${pid}/equipment`,
  equipmentSlot: (pid, slot) => `players_data/${pid}/equipment/${slot}`,
  statsHp: (pid) => `players_data/${pid}/stats/hp`,
  statsMp: (pid) => `players_data/${pid}/stats/mp`,
  statsMaxHp: (pid) => `players_data/${pid}/stats/maxHp`,
  statsMaxMp: (pid) => `players_data/${pid}/stats/maxMp`,
};

export const INVENTORY_SIZE = 20;
const WORLD_ITEM_LOCK_TTL_MS = 4_000;

const PRIVILEGED_ITEM_ACTOR_IDS = new Set([
  "worldengine",
  "gm",
  "gm_admin",
  "gmadmin",
  "game_master",
  "gamemaster",
]);

async function _resolvePlayerForItemAction(playerId) {
  const player =
    getPlayer(playerId) ?? (await dbGet(`players_data/${playerId}`)) ?? null;
  if (player) return player;

  // Atores privilegiados (WorldEngine, GM) não têm entrada no Firebase.
  // Retorna objeto sintético para que bypassRestrictions funcione corretamente.
  const pid = String(playerId ?? "")
    .trim()
    .toLowerCase();
  if (
    PRIVILEGED_ITEM_ACTOR_IDS.has(pid) ||
    pid.startsWith("gm_") ||
    pid.includes("worldengine")
  ) {
    return {
      id: playerId,
      name: playerId,
      isAdmin: true,
      isGM: true,
      role: "gm",
      x: 0,
      y: 0,
      z: 7,
    };
  }

  return null;
}

function _canBypassItemRestrictions(playerId, player) {
  const pid = String(playerId ?? "")
    .trim()
    .toLowerCase();
  if (!pid) return false;
  if (PRIVILEGED_ITEM_ACTOR_IDS.has(pid)) return true;
  if (pid.startsWith("gm_")) return true;
  if (pid.includes("worldengine")) return true;

  return (
    player?.isAdmin === true ||
    player?.isGM === true ||
    player?.role === "gm" ||
    player?.appearance?.isAdmin === true
  );
}

async function _isBlockedByWallAt(x, y, z) {
  // Busca apenas o chunk relevante (evita baixar o mapa inteiro)
  const cx = Math.floor(x / TILE_CHUNK_SIZE);
  const cy = Math.floor(y / TILE_CHUNK_SIZE);
  const chunkData = await dbGet(`${PATHS.tiles}/${z}/${cx},${cy}`);
  const mapData = await dbGet(PATHS.tilesData);

  if (!chunkData || typeof chunkData !== "object") return false;
  if (!mapData || typeof mapData !== "object") return false;

  // Converte o chunk para o formato flat esperado por isTileBlockedByWall
  const flatTiles = {};
  for (const [xy, layers] of Object.entries(chunkData)) {
    flatTiles[`${xy},${z}`] = layers;
  }
  return isTileBlockedByWall(x, y, z, flatTiles, mapData);
}

function _normalizeInventory(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= INVENTORY_SIZE) continue;
    if (!value || typeof value !== "object") continue;
    out[idx] = value;
  }
  return out;
}

async function _getAuthoritativeInventory(playerId, player) {
  const remoteRaw = await dbGet(P.inventory(playerId));
  if (remoteRaw && typeof remoteRaw === "object") {
    return _normalizeInventory(remoteRaw);
  }
  return _normalizeInventory(player?.inventory ?? {});
}

function _toSlotIndex(slotLike) {
  const n = Number(slotLike);
  return Number.isInteger(n) ? n : null;
}

function _isMapOriginWorldItem(item) {
  if (!item || typeof item !== "object") return false;
  return (
    item.sourceCoord != null &&
    item.sourceLayer != null &&
    item.sourceTileId != null
  );
}

function _buildMapClaimIdFromWorldItem(item) {
  if (!_isMapOriginWorldItem(item)) return null;
  return `${String(item.sourceCoord).replace(/,/g, "_")}_${Number(item.sourceLayer)}_${Number(item.sourceTileId)}`;
}

function _buildMapClaimPayload(item, playerId) {
  if (!_isMapOriginWorldItem(item)) return null;
  return {
    sourceCoord: String(item.sourceCoord),
    sourceLayer: Number(item.sourceLayer),
    sourceTileId: Number(item.sourceTileId),
    ts: Date.now(),
    by: String(playerId),
  };
}

function _sameItemIdentity(a, b) {
  if (!a || !b) return false;
  const aTile = _resolveItemTileId(a);
  const bTile = _resolveItemTileId(b);
  if (aTile != null && bTile != null) return aTile === bTile;
  return String(a.id ?? "") === String(b.id ?? "");
}

function _sameInventorySlotState(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (!_sameItemIdentity(a, b)) return false;

  const aQty = Number(a.quantity ?? a.count ?? 1);
  const bQty = Number(b.quantity ?? b.count ?? 1);
  const aCharges = Number(a.charges ?? 0);
  const bCharges = Number(b.charges ?? 0);

  return (
    Number.isFinite(aQty) &&
    Number.isFinite(bQty) &&
    Math.floor(aQty) === Math.floor(bQty) &&
    Math.floor(Number.isFinite(aCharges) ? aCharges : 0) ===
      Math.floor(Number.isFinite(bCharges) ? bCharges : 0)
  );
}

function _worldItemLockPath(worldItemId) {
  return `world_item_locks/${worldItemId}`;
}

async function _acquireWorldItemLock(worldItemId, actorId) {
  if (!worldItemId) return null;
  const path = _worldItemLockPath(worldItemId);
  const now = Date.now();
  const current = await dbGet(path);

  if (current && Number(current.expiresAt ?? 0) > now) {
    return null;
  }

  const token = `${actorId}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await dbSet(path, {
    token,
    actorId,
    acquiredAt: now,
    expiresAt: now + WORLD_ITEM_LOCK_TTL_MS,
  });

  const after = await dbGet(path);
  if (!after || after.token !== token) return null;

  return { path, token };
}

async function _releaseWorldItemLock(lock) {
  if (!lock?.path || !lock?.token) return;
  const current = await dbGet(lock.path);
  if (current?.token === lock.token) {
    await dbRemove(lock.path);
  }
}

async function _assertWorldItemStillUnchanged(worldItemId, expected) {
  const current = await dbGet(P.worldItem(worldItemId));
  if (!current || typeof current !== "object") return false;

  const expectedQty = Number(expected?.quantity ?? expected?.count ?? 1);
  const currentQty = Number(current?.quantity ?? current?.count ?? 1);

  return (
    String(current?.id ?? "") === String(expected?.id ?? "") &&
    Number(current?.x ?? 0) === Number(expected?.x ?? 0) &&
    Number(current?.y ?? 0) === Number(expected?.y ?? 0) &&
    Number(current?.z ?? 7) === Number(expected?.z ?? 7) &&
    Math.floor(Number.isFinite(currentQty) ? currentQty : 1) ===
      Math.floor(Number.isFinite(expectedQty) ? expectedQty : 1)
  );
}

async function _assertInventorySlotsStillUnchanged(
  playerId,
  inventorySnapshot,
  slotIndexes,
) {
  for (const slotIndex of slotIndexes) {
    const current = await dbGet(P.inventorySlot(playerId, slotIndex));
    const expected = inventorySnapshot?.[slotIndex] ?? null;
    if (!_sameInventorySlotState(current, expected)) {
      return false;
    }
  }
  return true;
}

async function _assertSlotStillHasItem(playerId, slotIndex, expectedItem) {
  const current = await dbGet(P.inventorySlot(playerId, slotIndex));
  if (!current || typeof current !== "object") return false;
  return _sameItemIdentity(current, expectedItem);
}

// =============================================================================
// PEGAR ITEM DO CHÃO → INVENTÁRIO
// =============================================================================

/**
 * @param {string} playerId
 * @param {string} worldItemId
 * @returns {Promise<{success:boolean, error?:string, slotIndex?:number}>}
 */
export async function pickUpItem(playerId, worldItemId) {
  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };
  const bypassRestrictions = _canBypassItemRestrictions(playerId, player);

  const worldItem = await dbGet(P.worldItem(worldItemId));
  if (!worldItem)
    return { success: false, error: "Item não encontrado no mundo" };

  const worldItemLock = await _acquireWorldItemLock(worldItemId, playerId);
  if (!worldItemLock) {
    return {
      success: false,
      error: "Item está sendo manipulado por outra ação. Tente novamente.",
    };
  }

  try {
    // Verificar se o item pode ser pego (map_data.json: is_pickupable)
    const ids = getItemDataService();
    const parsedId = Number(worldItem.id);
    const tileIdRaw =
      worldItem.tileId ??
      worldItem.spriteId ??
      worldItem.sourceTileId ??
      worldItem.originalItemId ??
      parsedId;
    const tileId = Number(tileIdRaw);
    if (!Number.isFinite(tileId) || tileId <= 0) {
      return {
        success: false,
        error: "Item inválido: tileId ausente para pickup",
      };
    }
    if (ids && _isMapOriginWorldItem(worldItem)) {
      if (!ids.canPickUp(tileId) && !ids.canMove(tileId)) {
        return { success: false, error: "Este item não pode ser pego" };
      }
    }

    // Verificar posse
    if (
      !bypassRestrictions &&
      worldItem.ownerId &&
      worldItem.ownerId !== playerId
    ) {
      return { success: false, error: "Item pertence a outro jogador" };
    }

    // Verificar expiração
    if (worldItem.expiresAt && Date.now() > worldItem.expiresAt) {
      await dbRemove(P.worldItem(worldItemId));
      return { success: false, error: "Item expirou" };
    }

    // Verificar distância (pulado para tiles do mapa — já estão "no chão" do tile)
    if (!bypassRestrictions && !worldItem.skipRangeCheck) {
      if (
        !_isWithinRange(
          player,
          worldItem.x ?? 0,
          worldItem.y ?? 0,
          RuntimeConfig.get("items.pickupRange", ITEM_CONFIG.pickupRange),
        )
      ) {
        return { success: false, error: "Item fora de alcance" };
      }
    }

    // Buscar inventário atual (do cache local ou Firebase)
    const inventory = await _getAuthoritativeInventory(playerId, player);

    const itemForSlot = {
      ...worldItem,
      id: String(tileId),
      tileId,
      stackable: ids?.isStackable(tileId) ?? !!worldItem.stackable,
      maxStack: Number(worldItem.maxStack ?? ids?.getMaxStack?.(tileId) ?? 1),
    };

    // Sanitizar item para inventário (remove campos de mundo)
    const {
      x,
      y,
      z,
      ownerId,
      expiresAt,
      droppedBy,
      droppedAt,
      movedBy,
      movedAt,
      splitFrom,
      splitAt,
      skipRangeCheck,
      fromMap,
      sourceCoord,
      sourceLayer,
      sourceTileId,
      ...rest
    } = worldItem;
    const inventoryItem = makeItem({
      ...rest,
      id: String(tileId),
      tileId,
      name: rest.name ?? ids?.getItemName?.(tileId) ?? `Item #${tileId}`,
      stackable: itemForSlot.stackable,
      maxStack: Number(rest.maxStack ?? ids?.getMaxStack?.(tileId) ?? 1),
      quantity: Number(worldItem.quantity ?? worldItem.count ?? 1),
      ...(worldItem.charges != null
        ? { charges: Number(worldItem.charges) }
        : {}),
    });

    const { valid, errors } = validateItem(inventoryItem, "inventory");
    if (!valid) return { success: false, error: errors.join("; ") };

    const isMapOrigin = _isMapOriginWorldItem(worldItem);
    const mapClaimId = isMapOrigin
      ? _buildMapClaimIdFromWorldItem(worldItem)
      : null;

    const updates = {};

    let slotIndex = null;
    const newInventory = { ...inventory };

    if (inventoryItem.stackable) {
      const { slotUpdates, remainingQty, firstSlotIndex } =
        _allocateStackableIntoInventory(inventory, inventoryItem);

      if (Object.keys(slotUpdates).length === 0) {
        return { success: false, error: "Inventário cheio" };
      }

      for (const [slot, value] of Object.entries(slotUpdates)) {
        const slotNum = Number(slot);
        updates[P.inventorySlot(playerId, slotNum)] = value;
        newInventory[slotNum] = value;
      }
      slotIndex = firstSlotIndex;

      if (remainingQty > 0) {
        updates[P.worldItem(worldItemId)] = {
          ...worldItem,
          quantity: remainingQty,
          count: remainingQty,
        };
      } else {
        updates[P.worldItem(worldItemId)] = null;
        if (mapClaimId) {
          updates[P.worldMapClaim(mapClaimId)] = _buildMapClaimPayload(
            worldItem,
            playerId,
          );
        }
      }
    } else {
      slotIndex = _findFreeSlot(inventory, inventoryItem);
      if (slotIndex === -1)
        return { success: false, error: "Inventário cheio" };

      updates[P.inventorySlot(playerId, slotIndex)] = inventoryItem;
      newInventory[slotIndex] = inventoryItem;
      updates[P.worldItem(worldItemId)] = null;
      if (mapClaimId) {
        updates[P.worldMapClaim(mapClaimId)] = _buildMapClaimPayload(
          worldItem,
          playerId,
        );
      }
    }
    const touchedSlots = Object.keys(updates)
      .filter((k) => k.startsWith(`players_data/${playerId}/inventory/`))
      .map((k) => Number(k.split("/").pop()))
      .filter((n) => Number.isFinite(n));

    const slotsStable = await _assertInventorySlotsStillUnchanged(
      playerId,
      inventory,
      touchedSlots,
    );
    if (!slotsStable) {
      return {
        success: false,
        error: "Inventário alterado durante o pickup. Tente novamente.",
      };
    }

    const worldStillSame = await _assertWorldItemStillUnchanged(
      worldItemId,
      worldItem,
    );
    if (!worldStillSame) {
      return {
        success: false,
        error: "Item alterado durante o pickup. Tente novamente.",
      };
    }

    await batchWrite(updates);

    // Atualizar cache local
    applyPlayersLocal(playerId, { inventory: newInventory });

    worldEvents.emit(EVENT_TYPES.ITEM_PICKED_UP, {
      playerId,
      itemId: worldItemId,
      itemName: inventoryItem.name,
      item: inventoryItem,
      slotIndex,
    });
    worldEvents.emit(EVENT_TYPES.INVENTORY_UPDATED, {
      playerId,
      inventory: newInventory,
    });

    return { success: true, slotIndex };
  } finally {
    await _releaseWorldItemLock(worldItemLock);
  }
}

// =============================================================================
// SOLTAR ITEM NO CHÃO
// =============================================================================

/**
 * @param {string} playerId
 * @param {number} slotIndex
 * @param {number|null} quantity  null = tudo
 * @param {number|null|undefined} toX
 * @param {number|null|undefined} toY
 * @param {number|null|undefined} toZ
 * @returns {Promise<{success:boolean, error?:string, worldItemId?:string}>}
 */
export async function dropItem(
  playerId,
  slotIndex,
  quantity = null,
  toX = null,
  toY = null,
  toZ = null,
) {
  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };
  const bypassRestrictions = _canBypassItemRestrictions(playerId, player);

  const fromSlot = _toSlotIndex(slotIndex);
  if (fromSlot == null || fromSlot < 0 || fromSlot >= INVENTORY_SIZE) {
    return { success: false, error: `Slot inválido: ${slotIndex}` };
  }

  const inventory = await _getAuthoritativeInventory(playerId, player);
  const item = inventory[fromSlot];
  if (!item) return { success: false, error: "Slot vazio" };
  if (!(await _assertSlotStillHasItem(playerId, fromSlot, item))) {
    return {
      success: false,
      error: "Inventário desatualizado. Reabra o inventário e tente novamente.",
    };
  }

  const dropQty = quantity ?? item.quantity ?? 1;
  const remaining = (item.quantity ?? 1) - dropQty;

  const targetX = Number.isFinite(Number(toX))
    ? Math.round(Number(toX))
    : Math.round(player.x);
  const targetY = Number.isFinite(Number(toY))
    ? Math.round(Number(toY))
    : Math.round(player.y);
  const targetZ = Number.isFinite(Number(toZ))
    ? Math.round(Number(toZ))
    : (player.z ?? 7);

  if (
    !bypassRestrictions &&
    !_isWithinRange(
      player,
      targetX,
      targetY,
      RuntimeConfig.get("items.dropRange", ITEM_CONFIG.dropRange),
    )
  ) {
    return {
      success: false,
      error: `DROP fora do alcance (${RuntimeConfig.get("items.dropRange", ITEM_CONFIG.dropRange)} SQM)`,
    };
  }

  if (
    !bypassRestrictions &&
    (await _isBlockedByWallAt(targetX, targetY, targetZ))
  ) {
    return { success: false, error: "Destino bloqueado (parede/obstáculo)" };
  }

  const worldItemId = `item_${playerId}_${Date.now()}`;
  const inferredTileId = _resolveItemTileId(item);
  const worldItem = makeItem({
    ...item,
    id: worldItemId,
    ...(inferredTileId != null ? { tileId: inferredTileId } : {}),
    originalItemId: item.id ?? null,
    x: targetX,
    y: targetY,
    z: targetZ,
    ownerId: null,
    expiresAt:
      Date.now() +
      RuntimeConfig.get("items.worldItemExpiry", ITEM_CONFIG.worldItemExpiry),
    droppedBy: playerId,
    droppedAt: Date.now(),
    quantity: dropQty,
  });

  const { valid, errors } = validateItem(worldItem, "world");
  if (!valid) return { success: false, error: errors.join("; ") };

  const updates = {
    [P.worldItem(worldItemId)]: worldItem,
    [P.inventorySlot(playerId, fromSlot)]:
      remaining > 0 && item.stackable
        ? { ...item, quantity: remaining, count: remaining }
        : null,
  };
  await batchWrite(updates);

  const newInventory = { ...inventory };
  if (remaining > 0 && item.stackable) {
    newInventory[fromSlot] = { ...item, quantity: remaining, count: remaining };
  } else {
    delete newInventory[fromSlot];
  }
  applyPlayersLocal(playerId, { inventory: newInventory });

  worldEvents.emit(EVENT_TYPES.ITEM_DROPPED, {
    playerId,
    itemId: worldItemId,
    itemName: item.name,
    x: worldItem.x,
    y: worldItem.y,
    z: worldItem.z,
    expiresAt: worldItem.expiresAt,
  });
  worldEvents.emit(EVENT_TYPES.INVENTORY_UPDATED, {
    playerId,
    inventory: newInventory,
  });

  return { success: true, worldItemId };
}

// =============================================================================
// MOVER ITEM NO CHÃO
// =============================================================================

/**
 * @param {string} playerId
 * @param {string} worldItemId
 * @param {number} toX
 * @param {number} toY
 * @param {number} [toZ]
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function moveWorldItem(playerId, worldItemId, toX, toY, toZ = 7) {
  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };
  const bypassRestrictions = _canBypassItemRestrictions(playerId, player);
  if (!worldItemId) return { success: false, error: "worldItemId ausente" };

  const worldItem = await dbGet(P.worldItem(worldItemId));
  if (!worldItem)
    return { success: false, error: "Item não encontrado no mundo" };

  const worldItemLock = await _acquireWorldItemLock(worldItemId, playerId);
  if (!worldItemLock) {
    return {
      success: false,
      error: "Item está sendo manipulado por outra ação. Tente novamente.",
    };
  }

  try {
    const nextX = Number(toX);
    const nextY = Number(toY);
    const nextZ = Number(toZ ?? worldItem.z ?? 7);
    if (
      !Number.isFinite(nextX) ||
      !Number.isFinite(nextY) ||
      !Number.isFinite(nextZ)
    ) {
      return { success: false, error: "Coordenadas de destino inválidas" };
    }

    const currX = Number(worldItem.x ?? 0);
    const currY = Number(worldItem.y ?? 0);
    const currZ = Number(worldItem.z ?? 7);
    const mapClaimId = _buildMapClaimIdFromWorldItem(worldItem);
    const mapClaimPayload = _buildMapClaimPayload(worldItem, playerId);

    if (!bypassRestrictions && !_isWithinRange(player, currX, currY, 2)) {
      return { success: false, error: "Só é possível mover itens a até 2 SQM" };
    }
    if (!bypassRestrictions && !_isWithinRange(player, nextX, nextY, 2)) {
      return { success: false, error: "Destino fora do alcance de 2 SQM" };
    }

    if (
      !bypassRestrictions &&
      (await _isBlockedByWallAt(nextX, nextY, nextZ))
    ) {
      return { success: false, error: "Destino bloqueado (parede/obstáculo)" };
    }

    if (currX === nextX && currY === nextY && currZ === nextZ) {
      return { success: true };
    }

    // ── Empilhamento: se o item é empilhável, verificar se já existe o mesmo
    // tileId no destino. Se sim, somar quantidades e remover o item arrastado.
    const itemDataService = await getItemDataService();
    const tileId = Number(worldItem.tileId ?? worldItem.id);
    const stackable =
      itemDataService?.isStackable(tileId) ?? !!worldItem.stackable;
    const worldItemQuantity = _normalizeQuantity(worldItem);

    if (stackable) {
      const allWorldItems = await dbGet("world_items");
      if (allWorldItems && typeof allWorldItems === "object") {
        const targetEntry = Object.entries(allWorldItems).find(([id, it]) => {
          if (id === worldItemId) return false; // não comparar consigo mesmo
          const itTileId = Number(it?.tileId ?? it?.id);
          return (
            itTileId === tileId &&
            Math.round(Number(it?.x)) === Math.round(nextX) &&
            Math.round(Number(it?.y)) === Math.round(nextY) &&
            Math.round(Number(it?.z ?? 7)) === Math.round(nextZ)
          );
        });

        if (targetEntry) {
          const [targetId, targetItem] = targetEntry;
          const targetQuantity = _normalizeQuantity(targetItem);
          const mergedQty =
            targetQuantity.quantity + worldItemQuantity.quantity;

          const worldStillSame = await _assertWorldItemStillUnchanged(
            worldItemId,
            worldItem,
          );
          if (!worldStillSame) {
            return {
              success: false,
              error: "Item alterado durante o movimento. Tente novamente.",
            };
          }

          await batchWrite({
            // Atualiza o item destino com a quantidade somada
            [P.worldItem(targetId)]: {
              ...targetItem,
              quantity: mergedQty,
              count: mergedQty,
              mergedAt: Date.now(),
            },
            // Remove o item arrastado
            [P.worldItem(worldItemId)]: null,
            ...(mapClaimId && mapClaimPayload
              ? { [P.worldMapClaim(mapClaimId)]: mapClaimPayload }
              : {}),
          });

          return { success: true, merged: true, targetId, quantity: mergedQty };
        }
      }
    }

    // Sem empilhamento: mover normalmente
    const worldStillSame = await _assertWorldItemStillUnchanged(
      worldItemId,
      worldItem,
    );
    if (!worldStillSame) {
      return {
        success: false,
        error: "Item alterado durante o movimento. Tente novamente.",
      };
    }

    await batchWrite({
      [P.worldItem(worldItemId)]: {
        ...worldItem,
        ...worldItemQuantity,
        x: Math.round(nextX),
        y: Math.round(nextY),
        z: Math.round(nextZ),
        movedBy: playerId,
        movedAt: Date.now(),
      },
      ...(mapClaimId && mapClaimPayload
        ? { [P.worldMapClaim(mapClaimId)]: mapClaimPayload }
        : {}),
    });

    return { success: true };
  } finally {
    await _releaseWorldItemLock(worldItemLock);
  }
}

// =============================================================================
// DIVIDIR ITEM EMPILHÁVEL NO CHÃO
// =============================================================================

/**
 * Divide um world_item empilhável em dois:
 *   - O item original fica com (qty - splitQty) na posição atual
 *   - Um novo world_item é criado em (toX, toY, toZ) com splitQty
 *
 * Se splitQty >= qty total, o item inteiro é apenas movido (sem duplicar).
 *
 * @param {string} playerId
 * @param {string} worldItemId
 * @param {number} splitQty   Quantidade a separar
 * @param {number} toX
 * @param {number} toY
 * @param {number} [toZ]
 * @returns {Promise<{success:boolean, error?:string, newItemId?:string}>}
 */
export async function splitWorldItem(
  playerId,
  worldItemId,
  splitQty,
  toX,
  toY,
  toZ = 7,
) {
  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };
  const bypassRestrictions = _canBypassItemRestrictions(playerId, player);
  if (!worldItemId) return { success: false, error: "worldItemId ausente" };

  const worldItem = await dbGet(P.worldItem(worldItemId));
  if (!worldItem)
    return { success: false, error: "Item não encontrado no mundo" };

  const worldItemLock = await _acquireWorldItemLock(worldItemId, playerId);
  if (!worldItemLock) {
    return {
      success: false,
      error: "Item está sendo manipulado por outra ação. Tente novamente.",
    };
  }

  try {
    const itemDataService = await getItemDataService();
    const tileId = Number(worldItem.tileId ?? worldItem.id);
    const stackable =
      itemDataService?.isStackable(tileId) ?? !!worldItem.stackable;
    if (!stackable) {
      return { success: false, error: "Item não é empilhável" };
    }

    const totalQty = Number(worldItem.quantity ?? worldItem.count ?? 1);
    const qty = Math.max(1, Math.min(Math.floor(Number(splitQty)), totalQty));

    const nextX = Math.round(Number(toX));
    const nextY = Math.round(Number(toY));
    const nextZ = Math.round(Number(toZ ?? worldItem.z ?? 7));

    const currX = Number(worldItem.x ?? 0);
    const currY = Number(worldItem.y ?? 0);
    if (!bypassRestrictions && !_isWithinRange(player, currX, currY, 2)) {
      return { success: false, error: "Só é possível mover itens a até 2 SQM" };
    }
    if (!bypassRestrictions && !_isWithinRange(player, nextX, nextY, 2)) {
      return { success: false, error: "Destino fora do alcance de 2 SQM" };
    }

    if (
      !bypassRestrictions &&
      (await _isBlockedByWallAt(nextX, nextY, nextZ))
    ) {
      return { success: false, error: "Destino bloqueado (parede/obstáculo)" };
    }

    // Se pede toda a pilha, apenas mover (delega ao moveWorldItem)
    if (qty >= totalQty) {
      return moveWorldItem(playerId, worldItemId, nextX, nextY, nextZ);
    }

    const remainingQty = totalQty - qty;
    const newItemId = `item_${playerId}_${Date.now()}`;
    const mapClaimId = _buildMapClaimIdFromWorldItem(worldItem);
    const mapClaimPayload = _buildMapClaimPayload(worldItem, playerId);

    const newWorldItem = {
      ...worldItem,
      id: newItemId,
      quantity: qty,
      count: qty,
      x: nextX,
      y: nextY,
      z: nextZ,
      splitFrom: worldItemId,
      splitAt: Date.now(),
      movedBy: playerId,
    };
    delete newWorldItem.fromMap;
    delete newWorldItem.sourceCoord;
    delete newWorldItem.sourceLayer;
    delete newWorldItem.sourceTileId;

    const worldStillSame = await _assertWorldItemStillUnchanged(
      worldItemId,
      worldItem,
    );
    if (!worldStillSame) {
      return {
        success: false,
        error: "Item alterado durante a divisão. Tente novamente.",
      };
    }

    await batchWrite({
      [P.worldItem(worldItemId)]: {
        ...worldItem,
        quantity: remainingQty,
        count: remainingQty,
      },
      [P.worldItem(newItemId)]: newWorldItem,
      ...(mapClaimId && mapClaimPayload
        ? { [P.worldMapClaim(mapClaimId)]: mapClaimPayload }
        : {}),
    });

    return { success: true, newItemId, quantity: qty, remaining: remainingQty };
  } finally {
    await _releaseWorldItemLock(worldItemLock);
  }
}

// =============================================================================
// EQUIPAR ITEM
// =============================================================================

/**
 * @param {string} playerId
 * @param {number} inventorySlot
 * @returns {Promise<{success:boolean, error?:string, slot?:string}>}
 */
export async function equipItem(playerId, inventorySlot) {
  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  const fromSlot = _toSlotIndex(inventorySlot);
  if (fromSlot == null || fromSlot < 0 || fromSlot >= INVENTORY_SIZE) {
    return { success: false, error: `Slot inválido: ${inventorySlot}` };
  }

  const inventory = await _getAuthoritativeInventory(playerId, player);
  const item = inventory[fromSlot];
  if (!item) return { success: false, error: "Slot de inventário vazio" };
  if (!(await _assertSlotStillHasItem(playerId, fromSlot, item))) {
    return {
      success: false,
      error: "Inventário desatualizado. Reabra o inventário e tente novamente.",
    };
  }

  const { valid, errors } = validateItem(item, "equipment");
  if (!valid) return { success: false, error: errors.join("; ") };

  // Verificar requisitos de nível/classe
  if (item.requiredClass && item.requiredClass !== player.class) {
    return {
      success: false,
      error: `Apenas ${item.requiredClass} pode usar este item`,
    };
  }
  if (item.requiredLevel && (player.stats?.level ?? 1) < item.requiredLevel) {
    return { success: false, error: `Requer nível ${item.requiredLevel}` };
  }

  const equipSlot = item.slot;
  const equipment =
    player.equipment ?? (await dbGet(P.equipment(playerId))) ?? {};

  // Verificar conflitos (ex: weapon 2H bloqueia shield)
  if (!_canEquipInSlot(player, item, equipSlot, equipment)) {
    return { success: false, error: "Conflito de equipamento" };
  }

  const previouslyEquipped = equipment[equipSlot] ?? null;

  // Montar novos estados
  const newEquipment = { ...equipment, [equipSlot]: item };
  const newInventory = { ...inventory };
  if (previouslyEquipped) {
    newInventory[fromSlot] = previouslyEquipped; // troca
  } else {
    delete newInventory[fromSlot];
  }

  // Recalcular stats com novo equipamento
  const { maxHp, maxMp, atk, def, agi } = await _recalcStats(
    player,
    newEquipment,
  );

  const updates = {
    [P.equipmentSlot(playerId, equipSlot)]: item,
    [P.inventorySlot(playerId, fromSlot)]: previouslyEquipped ?? null,
    [P.statsMaxHp(playerId)]: maxHp,
    [P.statsMaxMp(playerId)]: maxMp,
    [`players_data/${playerId}/stats/atk`]: atk,
    [`players_data/${playerId}/stats/def`]: def,
    [`players_data/${playerId}/stats/agi`]: agi,
  };

  // Preservar HP/MP atual proporcionalmente se maxHp mudou
  if (player.stats?.maxHp && maxHp !== player.stats.maxHp) {
    const ratio = (player.stats.hp ?? player.stats.maxHp) / player.stats.maxHp;
    updates[P.statsHp(playerId)] = Math.max(1, Math.floor(maxHp * ratio));
  }
  if (player.stats?.maxMp && maxMp !== player.stats.maxMp) {
    const ratio = (player.stats.mp ?? player.stats.maxMp) / player.stats.maxMp;
    updates[P.statsMp(playerId)] = Math.floor(maxMp * ratio);
  }

  await batchWrite(updates);

  applyPlayersLocal(playerId, {
    inventory: newInventory,
    equipment: newEquipment,
    stats: {
      ...player.stats,
      maxHp,
      maxMp,
      atk,
      def,
      agi,
      hp: updates[P.statsHp(playerId)] ?? player.stats?.hp,
      mp: updates[P.statsMp(playerId)] ?? player.stats?.mp,
    },
  });

  worldEvents.emit(EVENT_TYPES.ITEM_EQUIPPED, {
    playerId,
    itemId: item.id,
    itemName: item.name,
    slot: equipSlot,
    replaced: previouslyEquipped ?? null,
    newStats: { maxHp, maxMp, atk, def, agi },
  });
  worldEvents.emit(EVENT_TYPES.INVENTORY_UPDATED, {
    playerId,
    inventory: newInventory,
    equipment: newEquipment,
  });

  return { success: true, slot: equipSlot };
}

// =============================================================================
// DESEQUIPAR ITEM
// =============================================================================

/**
 * @param {string} playerId
 * @param {string} equipSlot
 * @param {number|null} targetInventorySlot  null = busca slot livre
 * @returns {Promise<{success:boolean, error?:string, slotIndex?:number}>}
 */
export async function unequipItem(
  playerId,
  equipSlot,
  targetInventorySlot = null,
) {
  if (!ITEM_SCHEMA.equipmentSlots.includes(equipSlot)) {
    return { success: false, error: `Slot inválido: ${equipSlot}` };
  }

  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  const equipment =
    player.equipment ?? (await dbGet(P.equipment(playerId))) ?? {};
  const item = equipment[equipSlot];
  if (!item)
    return { success: false, error: `Nenhum item no slot ${equipSlot}` };

  const inventory = await _getAuthoritativeInventory(playerId, player);
  const forcedSlot =
    targetInventorySlot == null ? null : _toSlotIndex(targetInventorySlot);
  if (
    targetInventorySlot != null &&
    (forcedSlot == null || forcedSlot < 0 || forcedSlot >= INVENTORY_SIZE)
  ) {
    return { success: false, error: `Slot inválido: ${targetInventorySlot}` };
  }
  const slotIndex = forcedSlot ?? _findFreeSlot(inventory, item);
  if (slotIndex === -1) return { success: false, error: "Inventário cheio" };

  const newEquipment = { ...equipment };
  delete newEquipment[equipSlot];
  const newInventory = { ...inventory, [slotIndex]: item };

  const { maxHp, maxMp, atk, def, agi } = await _recalcStats(
    player,
    newEquipment,
  );

  const updates = {
    [P.equipmentSlot(playerId, equipSlot)]: null,
    [P.inventorySlot(playerId, slotIndex)]: item,
    [P.statsMaxHp(playerId)]: maxHp,
    [P.statsMaxMp(playerId)]: maxMp,
    [`players_data/${playerId}/stats/atk`]: atk,
    [`players_data/${playerId}/stats/def`]: def,
    [`players_data/${playerId}/stats/agi`]: agi,
  };
  await batchWrite(updates);

  applyPlayersLocal(playerId, {
    inventory: newInventory,
    equipment: newEquipment,
    stats: { ...player.stats, maxHp, maxMp, atk, def, agi },
  });

  worldEvents.emit(EVENT_TYPES.ITEM_UNEQUIPPED, {
    playerId,
    itemName: item.name,
    slot: equipSlot,
    slotIndex,
    newStats: { maxHp, maxMp, atk, def, agi },
  });
  worldEvents.emit(EVENT_TYPES.INVENTORY_UPDATED, {
    playerId,
    inventory: newInventory,
    equipment: newEquipment,
  });

  return { success: true, slotIndex };
}

// =============================================================================
// MOVER ITEM ENTRE SLOTS DO INVENTÁRIO
// =============================================================================

/**
 * @param {string} playerId
 * @param {number} fromSlot
 * @param {number} toSlot
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function moveItem(playerId, fromSlot, toSlot) {
  const srcSlot = _toSlotIndex(fromSlot);
  const dstSlot = _toSlotIndex(toSlot);
  if (srcSlot == null || srcSlot < 0 || srcSlot >= INVENTORY_SIZE) {
    return { success: false, error: `Slot de origem inválido: ${fromSlot}` };
  }
  if (dstSlot == null || dstSlot < 0 || dstSlot >= INVENTORY_SIZE) {
    return { success: false, error: `Slot inválido: ${toSlot}` };
  }
  if (srcSlot === dstSlot) return { success: true };

  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  const inventory = await _getAuthoritativeInventory(playerId, player);
  const itemFrom = inventory[srcSlot];
  const itemTo = inventory[dstSlot] ?? null;

  if (!itemFrom) return { success: false, error: "Slot de origem vazio" };
  if (!(await _assertSlotStillHasItem(playerId, srcSlot, itemFrom))) {
    return {
      success: false,
      error: "Inventário desatualizado. Reabra o inventário e tente novamente.",
    };
  }

  let updates;
  const newInventory = { ...inventory };

  // Stack se mesmo id e stackável
  if (itemTo && _sameItemForStack(itemTo, itemFrom) && itemFrom.stackable) {
    const total = (itemFrom.quantity ?? 1) + (itemTo.quantity ?? 1);
    const newQtyTo = Math.min(total, itemFrom.maxStack ?? 99);
    const overflow = total - newQtyTo;
    const mergedTarget = {
      ...itemTo,
      quantity: newQtyTo,
      count: newQtyTo,
    };

    updates = {
      [P.inventorySlot(playerId, dstSlot)]: mergedTarget,
      [P.inventorySlot(playerId, srcSlot)]: null,
    };

    newInventory[dstSlot] = mergedTarget;
    delete newInventory[srcSlot];

    if (overflow > 0) {
      const overflowItem = {
        ...itemFrom,
        quantity: overflow,
        count: overflow,
      };

      const inventoryForOverflow = { ...newInventory };
      const { slotUpdates, remainingQty } = _allocateStackableIntoInventory(
        inventoryForOverflow,
        overflowItem,
      );

      if (remainingQty > 0) {
        return {
          success: false,
          error: "Inventário sem espaço para distribuir o overflow da pilha",
        };
      }

      for (const [slot, value] of Object.entries(slotUpdates)) {
        const slotNum = Number(slot);
        updates[P.inventorySlot(playerId, slotNum)] = value;
        newInventory[slotNum] = value;
      }
    }
  } else {
    // Swap simples
    updates = {
      [P.inventorySlot(playerId, srcSlot)]: itemTo ?? null,
      [P.inventorySlot(playerId, dstSlot)]: itemFrom,
    };

    if (itemTo == null) delete newInventory[srcSlot];
    else newInventory[srcSlot] = itemTo;
    newInventory[dstSlot] = itemFrom;
  }

  await batchWrite(updates);
  applyPlayersLocal(playerId, { inventory: newInventory });

  worldEvents.emit(EVENT_TYPES.ITEM_MOVED, {
    playerId,
    fromSlot: srcSlot,
    toSlot: dstSlot,
  });
  worldEvents.emit(EVENT_TYPES.INVENTORY_UPDATED, {
    playerId,
    inventory: newInventory,
  });

  return { success: true };
}

// =============================================================================
// USAR ITEM CONSUMÍVEL
// =============================================================================

/**
 * @param {string} playerId
 * @param {number} slotIndex
 * @returns {Promise<{success:boolean, error?:string, effect?:Object}>}
 */
export async function useItem(playerId, slotIndex) {
  const player = await _resolvePlayerForItemAction(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  const useSlot = _toSlotIndex(slotIndex);
  if (useSlot == null || useSlot < 0 || useSlot >= INVENTORY_SIZE) {
    return { success: false, error: `Slot inválido: ${slotIndex}` };
  }

  const inventory = await _getAuthoritativeInventory(playerId, player);
  const item = inventory[useSlot];
  if (!item) return { success: false, error: "Slot vazio" };
  if (!(await _assertSlotStillHasItem(playerId, useSlot, item))) {
    return {
      success: false,
      error: "Inventário desatualizado. Reabra o inventário e tente novamente.",
    };
  }

  const tileId = _resolveItemTileId(item);
  const itemDataService = getItemDataService?.() ?? null;
  const isUsableByMetadata =
    tileId != null ? (itemDataService?.isUsable?.(tileId) ?? false) : false;
  const hasEffect = !!item.effect;
  const canUseItem =
    item.type === "consumable" ||
    hasEffect ||
    isUsableByMetadata ||
    item.usable === true ||
    item.forceUse === true;

  if (!canUseItem) {
    return { success: false, error: "Item não pode ser usado" };
  }

  if (!_matchesUseRules(item.useConditions ?? item.onUseConditions, player)) {
    return {
      success: false,
      error: "Condições para usar este item não foram atendidas",
    };
  }

  if (!item.effect && item.type !== "consumable") {
    // Permite ONUSE para itens sem efeito quando a regra de uso aprovar,
    // mas sem aplicar mutações de stats/consumo por padrão.
    return {
      success: true,
      effect: null,
      consumed: false,
    };
  }

  // Cooldown de uso
  const lastUsed = player.itemCooldowns?.[item.id] ?? 0;
  const hasExplicitCooldown = item.cooldown != null;
  const cooldownMs = hasExplicitCooldown
    ? Number(item.cooldown)
    : item.type === "consumable"
      ? RuntimeConfig.get(
          "items.consumableCooldown",
          ITEM_CONFIG.consumableCooldown,
        )
      : 0;

  if (Number.isFinite(cooldownMs) && cooldownMs > 0) {
    if (Date.now() - lastUsed < cooldownMs) {
      return { success: false, error: "Aguarde antes de usar novamente" };
    }
  }

  const updates = {};

  // Aplicar efeito
  switch (item.effect.type) {
    case "heal": {
      const newHp = Math.min(
        player.stats?.maxHp ?? 100,
        (player.stats?.hp ?? 100) + (item.effect.value ?? 0),
      );
      updates[P.statsHp(playerId)] = newHp;
      break;
    }
    case "mana": {
      const newMp = Math.min(
        player.stats?.maxMp ?? 50,
        (player.stats?.mp ?? 50) + (item.effect.value ?? 0),
      );
      updates[P.statsMp(playerId)] = newMp;
      break;
    }
    case "set_storage": {
      const key = String(item.effect.key ?? "").trim();
      if (!key) {
        return { success: false, error: "Efeito set_storage sem chave" };
      }
      updates[`players_data/${playerId}/storage/${key}`] =
        item.effect.value ?? 1;
      break;
    }
    case "add_storage": {
      const key = String(item.effect.key ?? "").trim();
      if (!key) {
        return { success: false, error: "Efeito add_storage sem chave" };
      }
      const base = Number(player.storage?.[key] ?? 0);
      const delta = Number(item.effect.value ?? 1);
      updates[`players_data/${playerId}/storage/${key}`] = base + delta;
      break;
    }
    default:
      return {
        success: false,
        error: `Efeito não implementado: ${item.effect.type}`,
      };
  }

  const shouldConsume = _shouldConsumeOnUse(item, player);

  // Consumir item (stack ou remover) apenas quando a regra de consumo aprovar.
  const currentQty = Number(item.quantity ?? item.count ?? 1);
  const newQty = shouldConsume ? currentQty - 1 : currentQty;

  if (shouldConsume) {
    updates[P.inventorySlot(playerId, useSlot)] =
      newQty > 0 ? { ...item, quantity: newQty, count: newQty } : null;
  }

  // Registrar cooldown
  if (Number.isFinite(cooldownMs) && cooldownMs > 0) {
    updates[`players_data/${playerId}/itemCooldowns/${item.id}`] = Date.now();
  }

  await batchWrite(updates);

  const newInventory = { ...inventory };
  if (shouldConsume) {
    if (newQty > 0) {
      newInventory[useSlot] = { ...item, quantity: newQty, count: newQty };
    } else {
      delete newInventory[useSlot];
    }
  }

  const nextStorage = { ...(player.storage ?? {}) };
  for (const [path, value] of Object.entries(updates)) {
    const prefix = `players_data/${playerId}/storage/`;
    if (!path.startsWith(prefix)) continue;
    const key = path.slice(prefix.length);
    nextStorage[key] = value;
  }

  applyPlayersLocal(playerId, {
    inventory: newInventory,
    stats: {
      ...player.stats,
      hp: updates[P.statsHp(playerId)] ?? player.stats?.hp,
      mp: updates[P.statsMp(playerId)] ?? player.stats?.mp,
    },
    storage: nextStorage,
    itemCooldowns:
      Number.isFinite(cooldownMs) && cooldownMs > 0
        ? {
            ...(player.itemCooldowns ?? {}),
            [item.id]: Date.now(),
          }
        : (player.itemCooldowns ?? {}),
  });

  worldEvents.emit(EVENT_TYPES.ITEM_USED, {
    playerId,
    itemId: item.id,
    itemName: item.name,
    effect: item.effect,
    slotIndex: useSlot,
    consumed: shouldConsume,
  });
  worldEvents.emit(EVENT_TYPES.INVENTORY_UPDATED, {
    playerId,
    inventory: newInventory,
  });

  return { success: true, effect: item.effect, consumed: shouldConsume };
}

// =============================================================================
// LEITURA (helpers para UI)
// =============================================================================

export async function getInventory(playerId) {
  const player = getPlayer(playerId);
  return player?.inventory ?? (await dbGet(P.inventory(playerId))) ?? {};
}

export async function getEquipment(playerId) {
  const player = getPlayer(playerId);
  return player?.equipment ?? (await dbGet(P.equipment(playerId))) ?? {};
}

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

function _findFreeSlot(inventory, item) {
  // LIFO: empilha no slot mais recente com o mesmo item (índice mais alto primeiro)
  if (item?.stackable) {
    const incomingTileId = _resolveItemTileId(item);
    for (let i = INVENTORY_SIZE - 1; i >= 0; i--) {
      const slot = inventory[i];
      if (!slot) continue;
      const slotTileId = _resolveItemTileId(slot);
      const sameTile =
        incomingTileId != null && slotTileId != null
          ? incomingTileId === slotTileId
          : slot?.id === item?.id;
      if (sameTile && (slot.quantity ?? 1) < (slot.maxStack ?? 99)) return i;
    }
  }
  // Primeiro slot vazio (índice mais baixo disponível)
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    if (!inventory[i]) return i;
  }
  return -1;
}

function _isWithinRange(player, x, y, range = 1) {
  const px = Number(player?.x ?? 0);
  const py = Number(player?.y ?? 0);
  const tx = Number(x ?? 0);
  const ty = Number(y ?? 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
  const dx = Math.abs(Math.round(px) - Math.round(tx));
  const dy = Math.abs(Math.round(py) - Math.round(ty));
  return Math.max(dx, dy) <= range;
}

function _resolveItemTileId(item) {
  if (!item || typeof item !== "object") return null;
  const direct = Number(item.tileId ?? item.spriteId ?? item.id);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  return null;
}

function _shouldConsumeOnUse(item, player) {
  if (!item || typeof item !== "object") return false;

  if (item.consumeOnUse != null) {
    return _resolveConditionalFlag(
      item.consumeOnUse,
      player,
      item.type === "consumable",
    );
  }

  if (item.effect?.consume != null) {
    return _resolveConditionalFlag(
      item.effect.consume,
      player,
      item.type === "consumable",
    );
  }

  return item.type === "consumable";
}

function _resolveConditionalFlag(rule, player, defaultValue = false) {
  if (typeof rule === "boolean") return rule;

  if (rule && typeof rule === "object") {
    const when = rule.when ?? rule.conditions ?? null;
    if (when == null) {
      if (typeof rule.value === "boolean") return rule.value;
      return defaultValue;
    }

    if (_matchesUseRules(when, player)) {
      if (typeof rule.value === "boolean") return rule.value;
      return true;
    }

    if (typeof rule.else === "boolean") return rule.else;
    return defaultValue;
  }

  return defaultValue;
}

function _matchesUseRules(rules, player) {
  if (rules == null) return true;

  if (Array.isArray(rules)) {
    return rules.every((rule) => _matchesUseRules(rule, player));
  }

  if (typeof rules !== "object") return true;

  const mode = String(rules.mode ?? "all").toLowerCase();
  if (Array.isArray(rules.rules)) {
    if (mode === "any") {
      return rules.rules.some((rule) => _matchesUseRules(rule, player));
    }
    return rules.rules.every((rule) => _matchesUseRules(rule, player));
  }

  const key = String(rules.key ?? rules.storageKey ?? "").trim();
  if (!key) return true;

  const value = _getPlayerRuleValue(player, key);

  if (rules.exists === true && value == null) return false;
  if (rules.exists === false && value != null) return false;

  if (rules.equals != null && value !== rules.equals) return false;
  if (rules.notEquals != null && value === rules.notEquals) return false;

  const numeric = Number(value);
  if (rules.min != null) {
    const min = Number(rules.min);
    if (!Number.isFinite(numeric) || numeric < min) return false;
  }
  if (rules.max != null) {
    const max = Number(rules.max);
    if (!Number.isFinite(numeric) || numeric > max) return false;
  }

  return true;
}

function _getPlayerRuleValue(player, key) {
  if (!player || !key) return undefined;

  if (key.startsWith("storage.")) {
    return player.storage?.[key.slice(8)];
  }

  if (Object.prototype.hasOwnProperty.call(player.storage ?? {}, key)) {
    return player.storage?.[key];
  }

  const parts = key.split(".");
  let current = player;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function _sameItemForStack(a, b) {
  const aId = _resolveItemTileId(a);
  const bId = _resolveItemTileId(b);
  if (aId != null && bId != null) return aId === bId;
  return a?.id === b?.id;
}

function _mergeStackableItem(existingItem, incomingItem) {
  const existingQty = Number(
    existingItem?.quantity ?? existingItem?.count ?? 1,
  );
  const incomingQty = Number(
    incomingItem?.quantity ?? incomingItem?.count ?? 1,
  );
  const maxStack = Number(
    existingItem?.maxStack ?? incomingItem?.maxStack ?? 99,
  );
  const total = existingQty + incomingQty;
  const mergedQty = Math.min(total, maxStack);
  const remainingQty = Math.max(0, total - mergedQty);
  return { mergedQty, remainingQty, maxStack, total };
}

function _allocateStackableIntoInventory(inventory, incomingItem) {
  const slotUpdates = {};
  let firstSlotIndex = null;

  const qtyRaw = Number(incomingItem?.quantity ?? incomingItem?.count ?? 1);
  let remainingQty = Math.max(
    1,
    Math.floor(Number.isFinite(qtyRaw) ? qtyRaw : 1),
  );
  const incomingMaxStackRaw = Number(incomingItem?.maxStack ?? 100);
  const incomingMaxStack = Math.max(
    1,
    Math.floor(
      Number.isFinite(incomingMaxStackRaw) ? incomingMaxStackRaw : 100,
    ),
  );

  // Prioriza completar pilhas existentes (LIFO: slots mais altos primeiro)
  for (let i = INVENTORY_SIZE - 1; i >= 0 && remainingQty > 0; i--) {
    const slotItem = inventory?.[i];
    if (!slotItem || !_sameItemForStack(slotItem, incomingItem)) continue;

    const slotQtyRaw = Number(slotItem.quantity ?? slotItem.count ?? 1);
    const slotQty = Math.max(
      1,
      Math.floor(Number.isFinite(slotQtyRaw) ? slotQtyRaw : 1),
    );
    const slotMaxRaw = Number(slotItem.maxStack ?? incomingMaxStack);
    const slotMax = Math.max(
      1,
      Math.floor(Number.isFinite(slotMaxRaw) ? slotMaxRaw : incomingMaxStack),
    );
    const free = Math.max(0, slotMax - slotQty);
    if (free <= 0) continue;

    const add = Math.min(free, remainingQty);
    const nextQty = slotQty + add;
    slotUpdates[i] = {
      ...slotItem,
      stackable: true,
      maxStack: slotMax,
      quantity: nextQty,
      count: nextQty,
    };
    remainingQty -= add;
    if (firstSlotIndex == null) firstSlotIndex = i;
  }

  // Se ainda sobrou, cria novas pilhas em slots vazios
  for (let i = 0; i < INVENTORY_SIZE && remainingQty > 0; i++) {
    if (inventory?.[i]) continue;

    const placeQty = Math.min(incomingMaxStack, remainingQty);
    slotUpdates[i] = {
      ...incomingItem,
      stackable: true,
      maxStack: incomingMaxStack,
      quantity: placeQty,
      count: placeQty,
    };
    remainingQty -= placeQty;
    if (firstSlotIndex == null) firstSlotIndex = i;
  }

  return { slotUpdates, remainingQty, firstSlotIndex };
}

function _normalizeQuantity(item) {
  const qtyRaw = Number(item?.quantity ?? item?.count ?? 1);
  const qty = Math.max(1, Math.floor(Number.isFinite(qtyRaw) ? qtyRaw : 1));
  return { quantity: qty, count: qty };
}

function _canEquipInSlot(player, item, slot, equipment) {
  const rules = ITEM_CONFIG.equipmentRules[slot];
  if (!rules?.conflicts) return true;

  for (const conflictSlot of rules.conflicts) {
    const conflicting = equipment[conflictSlot];
    if (!conflicting) continue;
    // Só conflita se a arma for twoHanded ou se for escudo
    if (slot === "shield" && conflicting.twoHanded) return false;
    if (slot === "weapon" && item.twoHanded && equipment.shield) return false;
  }
  return true;
}

async function _recalcStats(player, newEquipment) {
  // Import dinâmico para evitar dependência circular
  const { calculateTotalStats } =
    await import("../progression/progressionSystem.js");

  const fakePlayer = { ...player, equipment: newEquipment };
  const base = calculateTotalStats(fakePlayer);

  // Somar bônus de stats de equipamentos
  let hpBonus = 0,
    mpBonus = 0,
    atkBonus = 0,
    defBonus = 0,
    agiBonus = 0;
  for (const item of Object.values(newEquipment)) {
    if (!item?.stats) continue;
    hpBonus += item.stats.hpBonus ?? 0;
    mpBonus += item.stats.mpBonus ?? 0;
    atkBonus += item.stats.atk ?? 0;
    defBonus += item.stats.def ?? 0;
    agiBonus += item.stats.agi ?? 0;
  }

  return {
    maxHp: Math.max(1, (base.maxHp ?? player.stats?.maxHp ?? 100) + hpBonus),
    maxMp: Math.max(0, (base.maxMp ?? player.stats?.maxMp ?? 50) + mpBonus),
    atk: Math.max(1, (base.atk ?? player.stats?.atk ?? 1) + atkBonus),
    def: Math.max(0, (base.def ?? player.stats?.def ?? 0) + defBonus),
    agi: Math.max(1, (base.agi ?? player.stats?.agi ?? 1) + agiBonus),
  };
}

// =============================================================================
// EXPORT PARA actionProcessor.js
// =============================================================================

export const itemActionHandlers = {
  pickUp: pickUpItem,
  drop: dropItem,
  equip: equipItem,
  unequip: unequipItem,
  move: moveItem,
  use: useItem,
};
