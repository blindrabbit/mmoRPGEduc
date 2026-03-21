// ═══════════════════════════════════════════════════════════════
// ItemMoveValidator.js — Validador de movimentação de itens
//
// ✅ SERVER AUTHORITY: toda lógica de negócio ocorre aqui
// ✅ Baseado nas regras do OpenTibia Canary (game.cpp / item.cpp)
// ✅ Compatível com migração futura para Node.js
//
// Ordem de validação (mesma do Canary):
//   1. Básicas      — player online, item existe
//   2. Propriedade  — ownerId, item travado
//   3. Stackables   — count válido, limite de stack
//   4. Por destino:
//      map          — flags de tile, PZ, house, distância, limite de itens
//      equipment    — slot, level, vocação, premium, two-hand
//      container    — espaço, merge de stack
//      inventory    — espaço livre
//
// @serverOnly — rodar apenas no contexto do worldEngine
// ═══════════════════════════════════════════════════════════════

import { MOVE_ERRORS, getUserMessage } from "../../../core/constants/moveErrors.js";
import {
  STACK_LIMITS,
  MAX_DROP_DISTANCE,
  MAX_PICKUP_DISTANCE,
  isSlotCompatible,
} from "../../../core/constants/itemConstants.js";
import {
  wsGetPlayer,
  wsGetWorldItem,
  wsGetInventorySlot,
  wsGetEquippedItem,
  wsFindEmptyInventorySlot,
  wsGetContainer,
  wsGetContainerItem,
  wsFindEmptyContainerSlot,
  wsGetTile,
  wsGetItemDefinition,
  wsCountWorldItemsAt,
} from "../services/WorldStore.js";

// ── Helpers ───────────────────────────────────────────────────

/**
 * Monta resposta de negação padronizada
 * @param {string} code - MOVE_ERRORS.*
 * @param {string} [debugMsg] - mensagem interna (não exibida ao jogador)
 * @returns {{ ok: false, code: string, userMessage: string }}
 */
function deny(code, debugMsg) {
  if (debugMsg) console.warn(`[ItemMoveValidator] DENY(${code}): ${debugMsg}`);
  return { ok: false, code, userMessage: getUserMessage(code) };
}

/**
 * Monta resposta de sucesso com metadados extras
 * @param {Object} [meta]
 * @returns {{ ok: true, code: string, meta: Object }}
 */
function allow(meta = {}) {
  return { ok: true, code: MOVE_ERRORS.SUCCESS, meta };
}

// ── Validador principal ───────────────────────────────────────

export class ItemMoveValidator {
  /**
   * Valida movimentação completa de item.
   *
   * @param {Object} action
   * @param {string} action.playerId
   * @param {string} action.type - 'MOVE_ITEM'
   * @param {Object} action.payload
   * @param {Object} action.payload.from  - { type: 'inventory'|'equipment'|'container'|'world', slotIndex?, containerId? }
   * @param {Object} action.payload.to    - { type: 'inventory'|'equipment'|'container'|'map', slotId?, position?, containerId?, containerSlot? }
   * @param {string} action.payload.itemId      - UUID do item (em world_items) ou composite key
   * @param {number|string} action.payload.itemTypeId - ID numérico do tipo de item (sprite ID)
   * @param {number} [action.payload.count]     - Quantidade a mover (stackables)
   *
   * @returns {Promise<{ ok: boolean, code: string, userMessage?: string, meta?: Object }>}
   */
  async validate(action) {
    const { playerId, payload } = action;
    const { from, to, itemId, itemTypeId, count } = payload ?? {};

    // ──────────────────────────────────────────────────────────
    // 1. VALIDAÇÕES BÁSICAS
    // ──────────────────────────────────────────────────────────

    if (!playerId || !from || !to) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, "payload incompleto");
    }

    const player = await wsGetPlayer(playerId);
    if (!player) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, `player ${playerId} não encontrado`);
    }

    // ──────────────────────────────────────────────────────────
    // 2. ITEM DE ORIGEM
    // ──────────────────────────────────────────────────────────

    const item = await this._resolveFromItem(from, playerId);
    if (!item) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, `item não encontrado em from=${JSON.stringify(from)}`);
    }

    // ──────────────────────────────────────────────────────────
    // 3. PROPRIEDADE
    // ──────────────────────────────────────────────────────────

    if (item.ownerId && item.ownerId !== playerId) {
      return deny(MOVE_ERRORS.ITEMISNOTYOURS, `ownerId=${item.ownerId} !== playerId=${playerId}`);
    }
    if (item.locked) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, "item travado (trade/house)");
    }

    // ──────────────────────────────────────────────────────────
    // 4. STACKABLES — valida count
    // ──────────────────────────────────────────────────────────

    const resolvedItemTypeId = itemTypeId ?? item.id ?? item.tileId;
    const itemDef = wsGetItemDefinition(resolvedItemTypeId);
    const isStackable = !!(itemDef?.game?.is_stackable || itemDef?.flags_raw?.cumulative);

    if (isStackable && count != null) {
      // count === null significa "mover tudo" — permitido
      const actualCount = item.count ?? item.quantity ?? 1;
      if (count <= 0 || count > actualCount) {
        return deny(MOVE_ERRORS.NOTPOSSIBLE, `count inválido: ${count} (tem ${actualCount})`);
      }
      if (count > STACK_LIMITS.MAX_STACK) {
        return deny(MOVE_ERRORS.STACK_LIMIT_EXCEEDED, `count ${count} > ${STACK_LIMITS.MAX_STACK}`);
      }
    }

    // ──────────────────────────────────────────────────────────
    // 5. DISTÂNCIA DE PICKUP (world → inventory)
    // ──────────────────────────────────────────────────────────

    if (from.type === "world" && to.type === "inventory") {
      const px = player.x ?? player.position?.x ?? 0;
      const py = player.y ?? player.position?.y ?? 0;
      const ix = item.x ?? 0;
      const iy = item.y ?? 0;
      if (Math.max(Math.abs(px - ix), Math.abs(py - iy)) > MAX_PICKUP_DISTANCE) {
        return deny(MOVE_ERRORS.THEREISNOWAY, `item fora de alcance de pickup (> ${MAX_PICKUP_DISTANCE} SQM)`);
      }
    }

    // ──────────────────────────────────────────────────────────
    // 6. VALIDAÇÃO POR TIPO DE DESTINO
    // ──────────────────────────────────────────────────────────

    switch (to.type) {
      case "map":
        return this._validateMapDrop(item, to, player, itemDef);
      case "equipment":
        return this._validateEquipment(item, to, player, itemDef);
      case "container":
        return this._validateContainer(item, to, player, itemDef, isStackable);
      case "inventory":
        return this._validateInventory(item, to, player, itemDef);
      default:
        return deny(MOVE_ERRORS.NOTPOSSIBLE, `destino desconhecido: ${to.type}`);
    }
  }

  // ── Resolução do item de origem ────────────────────────────

  async _resolveFromItem(from, playerId) {
    switch (from.type) {
      case "world":
        return await wsGetWorldItem(from.itemId);
      case "inventory":
        return await wsGetInventorySlot(playerId, from.slotIndex);
      case "equipment":
        return await wsGetEquippedItem(playerId, from.slotId);
      case "container": {
        if (!from.containerId) return null;
        const slot = from.containerSlot ?? 0;
        return await wsGetContainerItem(from.containerId, slot);
      }
      default:
        return null;
    }
  }

  // ── DROP NO MAPA ───────────────────────────────────────────

  async _validateMapDrop(item, to, player, itemDef) {
    const pos = to.position;
    if (!pos || pos.x == null || pos.y == null || pos.z == null) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, "posição de destino inválida");
    }

    // Distância Chebyshev (Tibia usa distância ≤ 1 para drops manuais)
    const dx = Math.abs((player.x ?? player.position?.x ?? 0) - pos.x);
    const dy = Math.abs((player.y ?? player.position?.y ?? 0) - pos.y);
    if (Math.max(dx, dy) > MAX_DROP_DISTANCE) {
      return deny(MOVE_ERRORS.THEREISNOWAY, `distância ${Math.max(dx, dy)} > ${MAX_DROP_DISTANCE}`);
    }

    const tile = await wsGetTile(pos);
    if (!tile) {
      return deny(MOVE_ERRORS.CANNOTTHROWITEMTHERE, `tile (${pos.x},${pos.y},${pos.z}) não existe`);
    }

    // Tile bloqueia drops (parede, água profunda, etc.)
    if (tile.flags?.noItemDrop) {
      return deny(MOVE_ERRORS.CANNOTTHROWITEMTHERE, "tile tem flag noItemDrop");
    }

    // Tile não é chão walkable — não pode dropar
    if (!tile.isWalkable) {
      return deny(MOVE_ERRORS.CANNOTTHROWITEMTHERE, "tile não é walkable");
    }

    // Protection Zone
    if (tile.protectionZone && itemDef?.game?.is_pickupable) {
      return deny(MOVE_ERRORS.CANNOTTHROWITEMTHERE, "área de proteção");
    }

    // House tile
    if (tile.houseId) {
      const house = null; // TODO: wsGetHouse quando implementado
      if (!house?.invited?.includes(player.id)) {
        return deny(MOVE_ERRORS.CANNOTTHROWITEMTHERE, "sem permissão na casa");
      }
    }

    // Limite de world_items por tile (conta itens realmente dropados, não layers do mapa)
    const droppedCount = await wsCountWorldItemsAt(pos);
    if (droppedCount >= STACK_LIMITS.MAX_ITEMS_PER_TILE) {
      return deny(MOVE_ERRORS.NOTENOUGHROOM, `tile cheio (${droppedCount} itens no chão)`);
    }

    return allow({ tilePos: pos });
  }

  // ── EQUIPAMENTO ────────────────────────────────────────────

  async _validateEquipment(item, to, player, itemDef) {
    const { slotId } = to;
    if (slotId == null) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, "slotId não especificado");
    }

    if (!itemDef) {
      return deny(MOVE_ERRORS.CANNOTBEDRESSED, "sem metadata de equipamento");
    }

    // Slot de roupa: obtido via flags_raw.clothes.slot ou game.equip_slot
    const itemSlotNum = itemDef.flags_raw?.clothes?.slot;
    const itemSlotType = itemDef.game?.equip_slot ?? itemDef.game?.category_type;

    // Verifica compatibilidade de slot pelo tipo de item
    if (itemSlotType && !isSlotCompatible(itemSlotType, Number(slotId))) {
      return deny(MOVE_ERRORS.CANNOTBEDRESSED, `${itemSlotType} não encaixa em slotId=${slotId}`);
    }

    // Level mínimo
    const minLevel = itemDef.game?.min_level ?? itemDef.flags_raw?.minLevel;
    if (minLevel && (player.stats?.level ?? player.level ?? 1) < minLevel) {
      return deny(MOVE_ERRORS.LEVELTOLOW, `level ${player.stats?.level} < ${minLevel}`);
    }

    // Vocação (array de vocações permitidas)
    const vocations = itemDef.game?.vocations ?? itemDef.flags_raw?.vocations;
    if (vocations?.length && !vocations.includes(player.vocation)) {
      return deny(MOVE_ERRORS.VOCATIONMISMATCH, `vocação ${player.vocation} não está em ${vocations}`);
    }

    // Premium
    const needsPremium = itemDef.game?.premium_only ?? itemDef.flags_raw?.premium;
    if (needsPremium && !player.premium) {
      return deny(MOVE_ERRORS.PREMIUMREQUIRED, "item requer premium");
    }

    // Arma two-hand: mão esquerda deve estar livre
    const isTwoHand = itemDef.game?.two_hand ?? itemDef.flags_raw?.twoHand;
    if (isTwoHand && Number(slotId) === 5) { // RIGHT slot
      const leftSlotItem = await wsGetEquippedItem(player.id, 6);
      if (leftSlotItem) {
        return deny(MOVE_ERRORS.NOTENOUGHROOM, "arma de duas mãos requer slot esquerdo livre");
      }
    }

    // Verifica se haverá swap (slot ocupado por outro item)
    const existingItem = await wsGetEquippedItem(player.id, slotId);
    return allow({ willSwap: !!existingItem, swappedItem: existingItem ?? null });
  }

  // ── CONTAINER ──────────────────────────────────────────────

  async _validateContainer(item, to, player, itemDef, isStackable) {
    const { containerId, containerSlot } = to;
    if (!containerId) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, "containerId não especificado");
    }

    const container = await wsGetContainer(containerId);
    if (!container) {
      return deny(MOVE_ERRORS.NOTPOSSIBLE, `container ${containerId} não encontrado`);
    }

    if (container.ownerId && container.ownerId !== player.id) {
      return deny(MOVE_ERRORS.ITEMISNOTYOURS, "container pertence a outro player");
    }

    // Slot específico solicitado
    if (containerSlot != null) {
      const existing = await wsGetContainerItem(containerId, containerSlot);
      if (existing) {
        // Tentativa de merge de stack
        if (isStackable && existing.tileId === item.tileId) {
          const newCount = (existing.count ?? 1) + (item.count ?? 1);
          if (newCount > STACK_LIMITS.MAX_STACK) {
            return deny(MOVE_ERRORS.STACK_LIMIT_EXCEEDED, `merge resultaria em ${newCount}`);
          }
          return allow({ willMerge: true, newCount, targetSlot: containerSlot });
        }
        return deny(MOVE_ERRORS.NOTENOUGHROOM, `slot ${containerSlot} ocupado`);
      }
      return allow({ targetSlot: containerSlot });
    }

    // Auto-alocação: encontra primeiro slot vazio
    const emptySlot = await wsFindEmptyContainerSlot(containerId);
    if (emptySlot === null) {
      return deny(MOVE_ERRORS.CONTAINERNOTENOUGHROOM, "container cheio");
    }
    return allow({ targetSlot: emptySlot });
  }

  // ── INVENTÁRIO ─────────────────────────────────────────────

  async _validateInventory(item, to, player, itemDef) {
    const { slotIndex } = to;

    // Slot específico solicitado
    if (slotIndex != null) {
      const existing = await wsGetInventorySlot(player.id, slotIndex);
      if (existing) {
        return deny(MOVE_ERRORS.NOTENOUGHROOM, `slot de inventário ${slotIndex} ocupado`);
      }
      return allow({ targetSlot: slotIndex });
    }

    // Auto-alocação
    const emptySlot = await wsFindEmptyInventorySlot(player.id);
    if (emptySlot === null) {
      return deny(MOVE_ERRORS.NOTENOUGHROOM, "inventário cheio");
    }
    return allow({ targetSlot: emptySlot });
  }
}
