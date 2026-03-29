// ═══════════════════════════════════════════════════════════════
// ItemMoveHandler.js — Execução de movimentação de itens
//
// Fluxo:
//   1. Chama ItemMoveValidator.validate()
//   2. Se OK: aplica mudanças no Firebase via batchWrite
//   3. Escreve resultado em player_actions_results/{actionId}
//   4. Se DENY: escreve resultado e retorna sem alterar estado
//
// @serverOnly — rodar apenas no contexto do worldEngine
// ═══════════════════════════════════════════════════════════════

import { batchWrite, dbSet, PATHS } from "../../../core/db.js";
import { MOVE_ERRORS } from "../../../core/constants/moveErrors.js";
import { ItemMoveValidator } from "../validators/ItemMoveValidator.js";
import {
  wsGetWorldItem,
  wsGetInventorySlot,
  wsGetEquippedItem,
  wsGetContainerItem,
  wsFindEmptyInventorySlot,
} from "../services/WorldStore.js";
import { normalizeSlotName } from "../../../core/constants/itemConstants.js";
import { EQUIPMENT_DATA } from "../../../core/equipmentData.js";

const _validator = new ItemMoveValidator();

// ── API pública ───────────────────────────────────────────────

/**
 * Processa ação MOVE_ITEM completa: valida → executa → persiste.
 *
 * @param {string} actionId - ID da ação (usado para escrever resultado)
 * @param {Object} action   - { playerId, type, payload }
 * @returns {Promise<{ status: 'success'|'denied', code: string, userMessage?: string }>}
 */
export async function handleItemMove(actionId, action) {
  try {
    // ✅ FORÇA SYNC DA POSIÇÃO: Antes de validar, garante que o player
    // mais recente seja lido do Firebase (não apenas do cache)
    const { wsGetPlayer } = await import("../services/WorldStore.js");
    const freshPlayer = await wsGetPlayer(action.playerId);
    if (freshPlayer) {
      // Atualiza cache local com a posição mais recente
      const { applyPlayersLocal } = await import("../../../core/worldStore.js");
      applyPlayersLocal(action.playerId, {
        x: freshPlayer.x,
        y: freshPlayer.y,
        z: freshPlayer.z,
        direcao: freshPlayer.direcao,
        lastMoveTime: freshPlayer.lastMoveTime,
      });
    }

    // 1. Validação
    const validation = await _validator.validate(action);
    if (!validation.ok) {
      await _writeResult(actionId, { status: "denied", code: validation.code });
      return {
        status: "denied",
        code: validation.code,
        userMessage: validation.userMessage,
      };
    }

    // 2. Execução
    const changes = await _executeMove(action, validation.meta);

    // 3. Persistência no Firebase
    if (Object.keys(changes).length > 0) {
      await batchWrite(changes);
    }

    // 4. Resultado de sucesso
    await _writeResult(actionId, { status: "success" });
    return { status: "success", code: MOVE_ERRORS.SUCCESS };
  } catch (error) {
    console.error("[ItemMoveHandler] Erro inesperado:", error);
    await _writeResult(actionId, {
      status: "denied",
      code: MOVE_ERRORS.INTERNAL_ERROR,
    });
    return { status: "denied", code: MOVE_ERRORS.INTERNAL_ERROR };
  }
}

// ── Execução de mudanças de estado ────────────────────────────

async function _executeMove(action, meta) {
  const { playerId, payload } = action;
  const { from, to, itemId, itemTypeId, count } = payload;
  const changes = {};

  // Obtém o item de origem para copiar os dados
  const item = await _resolveFromItem(from, playerId);
  if (!item)
    throw new Error(`item de origem não encontrado: ${JSON.stringify(from)}`);

  // ── Remove da origem ──────────────────────────────────────
  switch (from.type) {
    case "world":
      changes[`world_items/${from.itemId}`] = null;
      break;
    case "inventory":
      changes[`players_data/${playerId}/inventory/${from.slotIndex}`] = null;
      break;
    case "equipment":
      changes[`players_data/${playerId}/equipment/${normalizeSlotName(String(from.slotId ?? ""))}`] = null;
      break;
    case "container":
      changes[`world_items/${from.containerId}/slots/${from.containerSlot}`] =
        null;
      break;
  }

  // ── Adiciona no destino ───────────────────────────────────
  switch (to.type) {
    case "map": {
      const newItemId = _genItemId(playerId);
      changes[`world_items/${newItemId}`] = {
        id: newItemId,
        tileId: itemTypeId ?? item.tileId ?? item.id,
        count: count ?? item.count ?? 1,
        x: to.position.x,
        y: to.position.y,
        z: to.position.z,
        droppedBy: playerId,
        droppedAt: Date.now(),
      };
      break;
    }

    case "equipment": {
      // Normaliza o slot de destino (aceita "weapon"→"right", "hand"→"right", etc.)
      const canonicalSlot = normalizeSlotName(String(to.slotId ?? ""));

      // Se há swap, move o item antigo para o inventário
      if (meta?.willSwap && meta.swappedItem) {
        const emptySlot = await wsFindEmptyInventorySlot(playerId);
        if (emptySlot !== null) {
          changes[`players_data/${playerId}/inventory/${emptySlot}`] =
            meta.swappedItem;
        }
        // Se não houver slot livre, o item anterior é perdido (Canary comportamento)
      }

      // Enriquece com EQUIPMENT_DATA para garantir type/slot corretos no Firebase
      const tileIdNum = Number(itemTypeId ?? item.tileId ?? item.id ?? 0);
      const equipMeta = EQUIPMENT_DATA[tileIdNum] ?? null;
      const equipEnrich = equipMeta
        ? { type: "equipment", slot: equipMeta.slot, name: equipMeta.name ?? item.name }
        : {};

      changes[`players_data/${playerId}/equipment/${canonicalSlot}`] = {
        tileId: tileIdNum || (itemTypeId ?? item.tileId ?? item.id),
        count: count ?? item.count ?? 1,
        ..._pickItemFields(item),
        ...equipEnrich,
      };
      break;
    }

    case "container": {
      const targetSlot = meta?.targetSlot ?? 0;
      if (meta?.willMerge) {
        // Atualiza apenas o count
        changes[`world_items/${to.containerId}/slots/${targetSlot}/count`] =
          meta.newCount;
      } else {
        changes[`world_items/${to.containerId}/slots/${targetSlot}`] = {
          tileId: itemTypeId ?? item.tileId ?? item.id,
          count: count ?? item.count ?? 1,
          ..._pickItemFields(item),
        };
      }
      break;
    }

    case "inventory": {
      const targetSlot = meta?.targetSlot ?? to.slotIndex;
      changes[`players_data/${playerId}/inventory/${targetSlot}`] = {
        tileId: itemTypeId ?? item.tileId ?? item.id,
        count: count ?? item.count ?? 1,
        ..._pickItemFields(item),
      };
      break;
    }
  }

  return changes;
}

// ── Helpers ───────────────────────────────────────────────────

async function _resolveFromItem(from, playerId) {
  switch (from.type) {
    case "world":
      return await wsGetWorldItem(from.itemId);
    case "inventory":
      return await wsGetInventorySlot(playerId, from.slotIndex);
    case "equipment":
      return await wsGetEquippedItem(playerId, from.slotId);
    case "container":
      return await wsGetContainerItem(from.containerId, from.containerSlot);
    default:
      return null;
  }
}

/** Copia campos extras do item (encantamentos, durabilidade, etc.) */
function _pickItemFields(item) {
  const extra = {};
  if (item.enchant) extra.enchant = item.enchant;
  if (item.durability) extra.durability = item.durability;
  if (item.charges) extra.charges = item.charges;
  if (item.inscription) extra.inscription = item.inscription;
  return extra;
}

function _genItemId(playerId) {
  return `${playerId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function _writeResult(actionId, result) {
  await dbSet(`player_actions_results/${actionId}`, {
    ...result,
    ts: Date.now(),
  });
}
