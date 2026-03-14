// =============================================================================
// DragDropManager.js — mmoRPGEduc
// Gerencia drag & drop de itens entre inventário, equipamento e mapa.
//
// Arquitetura:
//   • Suporta dois modos: DOM-based (UI HTML) e Canvas-based (mapa do jogo)
//   • Ghost item renderizado como elemento DOM flutuante
//   • Drop zones podem ser elementos DOM ou regiões do canvas
//   • Emite eventos: ITEM_DRAG_START, ITEM_DRAG_END, ITEM_DROP_VALID/INVALID
//   • Ao confirmar drop, chama worldEngine.sendAction({ type: 'item', ... })
//
// Atributos HTML esperados (modo DOM):
//   data-item-source="inventory|equipment|world"
//   data-item-slot="0"              (inventário)
//   data-item-equip-slot="weapon"   (equipamento)
//   data-item-world-id="xyz"        (mundo)
//   data-drop-zone="inventory|equipment|ground"
//   data-drop-slot="0"              (slot destino)
//   data-drop-equip-slot="armor"    (slot equip destino)
//
// Dependências: events.js, config.js
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../../core/events.js";
import { TILE_SIZE } from "../../../core/config.js";
import { getPlayer } from "../../../core/worldStore.js";

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

export const DRAG_CONFIG = Object.freeze({
  // Threshold em px antes de iniciar drag (evita micro-movimentos)
  dragThreshold: 4,

  // Delay anti-spam (ms)
  minDragInterval: 100,

  // Janela para bloquear envio duplicado da mesma ação
  duplicateActionWindowMs: 220,

  // Opacidade do ghost
  ghostAlpha: 0.85,

  // Classes CSS para feedback
  classes: {
    dragging: "item-dragging",
    ghost: "item-drag-ghost",
    dropValid: "drop-zone-valid",
    dropInvalid: "drop-zone-invalid",
    originDragging: "slot-origin-dragging",
  },
});

// =============================================================================
// CLASSE PRINCIPAL
// =============================================================================

export class DragDropManager {
  /**
   * @param {Object} options
   * @param {Object} options.worldEngine - Instância de WorldEngineInterface
   * @param {string} options.playerId
   * @param {Function} [options.getItemData] - (source, key) => item | null
   * @param {HTMLElement} [options.container] - Raiz para listeners DOM (padrão: document)
   * @param {HTMLCanvasElement} [options.canvas] - Canvas do mapa (opcional)
   * @param {Object} [options.worldRenderer] - Renderer com screenToWorld() (opcional)
   * @param {import('../../../../gameplay/items/ItemDataService.js').ItemDataService} [options.itemDataService]
   * @param {Function} [options.createGhostElement] - (itemData) => HTMLElement  (sprite do canvas)
   */
  constructor({
    worldEngine,
    playerId,
    getItemData,
    container = document,
    canvas = null,
    worldRenderer = null,
    itemDataService = null,
    createGhostElement = null,
  } = {}) {
    this._engine = worldEngine;
    this._playerId = playerId;
    this._getItemData = getItemData ?? (() => null);
    this._container = container;
    this._canvas = canvas;
    this._worldRenderer = worldRenderer;
    this._itemDataService = itemDataService;
    this._createGhostElement = createGhostElement;

    /** @type {import('./DragDropManager.js').DragState} */
    this._drag = _emptyDrag();
    this._listeners = [];
    this._dropZones = [];
    this._currentHighlight = null;
    this._lastActionSentAt = 0;
    this._lastActionSignature = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onCanvasPointerDownBound = this._onCanvasPointerDown.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  mount() {
    this._container.addEventListener("pointerdown", this._onPointerDown);
    document.addEventListener("pointermove", this._onPointerMove, {
      passive: true,
    });
    document.addEventListener("pointerup", this._onPointerUp);
    document.addEventListener("keydown", this._onKeyDown);

    // Suporte canvas: itens no mapa arrastáveis via worldRenderer
    if (this._canvas) {
      this._canvas.addEventListener(
        "pointerdown",
        this._onCanvasPointerDownBound,
      );
    }

    this._refreshDropZones();
  }

  unmount() {
    this._container.removeEventListener("pointerdown", this._onPointerDown);
    document.removeEventListener("pointermove", this._onPointerMove);
    document.removeEventListener("pointerup", this._onPointerUp);
    document.removeEventListener("keydown", this._onKeyDown);

    if (this._canvas) {
      this._canvas.removeEventListener(
        "pointerdown",
        this._onCanvasPointerDownBound,
      );
    }

    this._cancelDrag();
  }

  // ---------------------------------------------------------------------------
  // Canvas: detecta itens no mapa (world_items)
  // ---------------------------------------------------------------------------

  _onCanvasPointerDown(e) {
    if (e.button !== 0) return;

    // Converte posição de tela para coordenada de tile
    const worldPos = this._screenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;

    // Verifica se há item do mundo na posição.
    // Nota: _getItemData já filtra por canPickUp para tiles do mapa;
    // Firebase world_items são sempre arrastáveis (foram colocados intencionalmente).
    const worldItem = this._getWorldItemAt(
      worldPos.x,
      worldPos.y,
      worldPos.z ?? 7,
    );
    if (!worldItem) return;

    e.stopPropagation(); // não propaga para o handler DOM abaixo

    this._drag = {
      ..._emptyDrag(),
      active: false, // ativa após threshold
      pending: true,
      source: "world",
      worldItemId: worldItem.id ?? worldItem.instanceId,
      itemData: worldItem,
      originEl: null,
      startX: e.clientX,
      startY: e.clientY,
      shiftKey: !!e.shiftKey,
    };
  }

  // ---------------------------------------------------------------------------
  // DOM: detecta drag em elementos com [data-item-source]
  // ---------------------------------------------------------------------------

  _onPointerDown(e) {
    if (e.button !== 0) return;

    // Já tem drag pendente do canvas?
    if (this._drag.pending) return;

    const itemEl = e.target.closest("[data-item-source]");
    if (!itemEl) return;

    e.preventDefault();

    const source = itemEl.dataset.itemSource;
    const slotIndex =
      itemEl.dataset.itemSlot != null
        ? parseInt(itemEl.dataset.itemSlot, 10)
        : null;
    const equipSlot = itemEl.dataset.itemEquipSlot ?? null;
    const worldItemId = itemEl.dataset.itemWorldId ?? null;
    const key = slotIndex ?? equipSlot ?? worldItemId;

    const itemData = this._getItemData(source, key);
    if (!itemData) return;

    // Valida via ItemDataService: itens de inventário/equipamento sempre podem
    // ser arrastados; itens do mundo (source==='world') verificam canPickUp/canMove
    if (source === "world" && this._itemDataService) {
      const tileId = itemData.tileId ?? itemData.id;
      if (
        !this._itemDataService.canPickUp(tileId) &&
        !this._itemDataService.canMove(tileId)
      ) {
        return;
      }
    }

    this._drag = {
      ..._emptyDrag(),
      active: false,
      pending: true,
      source,
      slotIndex,
      equipSlot,
      worldItemId,
      itemData,
      originEl: itemEl,
      startX: e.clientX,
      startY: e.clientY,
      shiftKey: !!e.shiftKey,
    };
  }

  _onPointerMove(e) {
    if (!this._drag.pending && !this._drag.active) return;

    const dx = e.clientX - this._drag.startX;
    const dy = e.clientY - this._drag.startY;

    // Ativa drag após threshold para distinguir de clique
    if (!this._drag.active) {
      if (Math.hypot(dx, dy) < DRAG_CONFIG.dragThreshold) return;

      this._drag.active = true;
      this._drag.pending = false;
      this._activateDrag();
    }

    this._moveGhost(e.clientX, e.clientY);
    this._checkDropZones(e.clientX, e.clientY);
  }

  _onPointerUp(e) {
    if (!this._drag.active && !this._drag.pending) return;

    if (this._drag.active) {
      const isOverCanvas =
        this._canvas && this._isOverCanvas(e.clientX, e.clientY);
      const directDropEl = this._getDropZoneAt(e.clientX, e.clientY);
      const scoredDropEl =
        !isOverCanvas && this._drag.bestDropZone?.score > 0
          ? this._drag.bestDropZone.el
          : null;
      const dropEl = directDropEl ?? scoredDropEl;

      if (dropEl) {
        this._executeDrop(dropEl);
      } else if (isOverCanvas) {
        // Drop no chão do mapa (canvas)
        this._executeDropOnGround(e.clientX, e.clientY);
      } else {
        worldEvents.emit(EVENT_TYPES.ITEM_DROP_INVALID, {
          source: this._drag.source,
          slotIndex: this._drag.slotIndex,
          reason: "no-drop-zone",
        });
      }
    }

    this._cancelDrag();
  }

  _onKeyDown(e) {
    if (e.key === "Escape" && (this._drag.active || this._drag.pending)) {
      worldEvents.emit(EVENT_TYPES.ITEM_DROP_INVALID, {
        source: this._drag.source,
        reason: "cancelled",
      });
      this._cancelDrag();
    }
  }

  // ---------------------------------------------------------------------------
  // Ativar drag (após threshold)
  // ---------------------------------------------------------------------------

  _activateDrag() {
    const { source, slotIndex, equipSlot, worldItemId, itemData, originEl } =
      this._drag;

    if (originEl) {
      originEl.classList.add(DRAG_CONFIG.classes.originDragging);
    }
    document.body.classList.add(DRAG_CONFIG.classes.dragging);

    this._createGhost(this._drag.startX, this._drag.startY);

    worldEvents.emit(EVENT_TYPES.ITEM_DRAG_START, {
      source,
      slotIndex,
      equipSlot,
      worldItemId,
      itemData,
    });
  }

  // ---------------------------------------------------------------------------
  // Drop Execution
  // ---------------------------------------------------------------------------

  _executeDrop(dropEl) {
    const dropZone = dropEl.dataset.dropZone;
    const dropSlot =
      dropEl.dataset.dropSlot != null
        ? parseInt(dropEl.dataset.dropSlot, 10)
        : null;
    const dropEquipSlot = dropEl.dataset.dropEquipSlot ?? null;
    const { source, slotIndex, equipSlot, worldItemId } = this._drag;

    let action = null;

    if (source === "inventory" && dropZone === "inventory") {
      if (slotIndex !== dropSlot) {
        action = { itemAction: "move", slotIndex, toSlot: dropSlot };
      }
    } else if (source === "inventory" && dropZone === "equipment") {
      action = { itemAction: "equip", slotIndex };
    } else if (source === "equipment" && dropZone === "inventory") {
      action = { itemAction: "unequip", equipSlot, slotIndex: dropSlot };
    } else if (source === "equipment" && dropZone === "equipment") {
      if (equipSlot !== dropEquipSlot) {
        // Desequipa — o servidor move para inventário; depois o cliente re-equipa
        action = { itemAction: "unequip", equipSlot };
      }
    } else if (source === "world" && dropZone === "inventory") {
      action = { itemAction: "pickUp", worldItemId };
    }

    if (action) {
      this._sendAction(action);
      worldEvents.emit(EVENT_TYPES.ITEM_DROP_VALID, {
        source,
        dropZone,
        slotIndex,
        dropSlot,
        itemData: this._drag.itemData,
      });
    } else {
      worldEvents.emit(EVENT_TYPES.ITEM_DROP_INVALID, { source, dropZone });
    }
  }

  _executeDropOnGround(clientX, clientY) {
    const { source, slotIndex, equipSlot, worldItemId } = this._drag;
    const worldPos = this._screenToWorld(clientX, clientY);

    if (source === "inventory" && slotIndex != null && worldPos) {
      this._sendAction({
        itemAction: "drop",
        slotIndex,
        toX: worldPos.x,
        toY: worldPos.y,
        toZ: worldPos.z ?? 7,
      });
    } else if (source === "equipment" && equipSlot) {
      this._sendAction({ itemAction: "unequip", equipSlot });
    } else if (source === "world" && worldItemId && worldPos) {
      const isStackable =
        this._itemDataService?.isStackable(
          this._drag.itemData?.tileId ?? this._drag.itemData?.id,
        ) ?? !!this._drag.itemData?.stackable;
      const totalQty = Number(
        this._drag.itemData?.quantity ?? this._drag.itemData?.count ?? 1,
      );
      const doSplit = this._drag.shiftKey && isStackable && totalQty > 1;

      if (doSplit) {
        const splitQty = Math.max(1, Math.floor(totalQty / 2));
        this._sendAction({
          itemAction: "splitWorld",
          worldItemId,
          splitQty,
          toX: worldPos.x,
          toY: worldPos.y,
          toZ: worldPos.z ?? 7,
        });
      } else {
        this._sendAction({
          itemAction: "moveWorld",
          worldItemId,
          toX: worldPos.x,
          toY: worldPos.y,
          toZ: worldPos.z ?? 7,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // sendAction
  // ---------------------------------------------------------------------------

  _sendAction(payload) {
    if (!this._engine || !this._playerId) return;

    const now = Date.now();
    const signature = JSON.stringify(payload ?? {});
    const duplicateWindow = Math.max(
      DRAG_CONFIG.duplicateActionWindowMs,
      DRAG_CONFIG.minDragInterval,
    );

    if (
      this._lastActionSignature === signature &&
      now - this._lastActionSentAt < duplicateWindow
    ) {
      return;
    }

    this._lastActionSignature = signature;
    this._lastActionSentAt = now;

    this._engine
      .sendAction({
        type: "item",
        payload: { ...payload, playerId: this._playerId },
      })
      .catch((err) =>
        console.error("[DragDropManager] sendAction failed:", err),
      );
  }

  // ---------------------------------------------------------------------------
  // Ghost DOM Element
  // ---------------------------------------------------------------------------

  _createGhost(x, y) {
    const { originEl, itemData } = this._drag;

    let ghost;
    if (this._createGhostElement) {
      // Sprite do canvas — usa callback externo para renderizar o sprite correto
      ghost = this._createGhostElement(itemData);
    } else if (originEl) {
      ghost = originEl.cloneNode(true);
    } else {
      // Fallback genérico: canvas semi-transparente sem borda
      ghost = document.createElement("canvas");
      ghost.width = TILE_SIZE;
      ghost.height = TILE_SIZE;
      const gCtx = ghost.getContext("2d");
      gCtx.fillStyle = "rgba(150,150,150,0.5)";
      gCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    }

    // Garante que canvas ghosts renderizem com tamanho fixo e sem distorção
    if (ghost instanceof HTMLCanvasElement) {
      ghost.style.width = `${TILE_SIZE}px`;
      ghost.style.height = `${TILE_SIZE}px`;
      ghost.style.imageRendering = "pixelated";
    }

    Object.assign(ghost.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "9999",
      opacity: DRAG_CONFIG.ghostAlpha,
      transform: "translate(-50%, -50%) scale(1.1)",
      transition: "none",
      left: `${x}px`,
      top: `${y}px`,
      boxShadow: "none",
      filter: "none",
      border: "none",
      background: "transparent",
    });
    ghost.classList.add(DRAG_CONFIG.classes.ghost);
    document.body.appendChild(ghost);
    this._drag.ghostEl = ghost;
  }

  _moveGhost(x, y) {
    const g = this._drag.ghostEl;
    if (!g) return;
    g.style.left = `${x}px`;
    g.style.top = `${y}px`;

    // Atualiza o indicador de destino no canvas quando o cursor estiver sobre ele
    if (this._canvas && this._isOverCanvas(x, y)) {
      const worldPos = this._screenToWorld(x, y);
      if (worldPos) this._showTileTarget(worldPos, x, y);
    } else {
      this._hideTileTarget();
    }
  }

  _removeGhost() {
    this._drag.ghostEl?.remove();
    this._drag.ghostEl = null;
    this._hideTileTarget();
  }

  // ---------------------------------------------------------------------------
  // Tile-target indicator (quadrado de destino no canvas)
  // ---------------------------------------------------------------------------

  _showTileTarget(worldPos, clientX, clientY) {
    const canvas = this._canvas;
    if (!canvas) return;

    // Usa worldToScreen (câmera-aware) se disponível; senão fallback simples
    let tileScreenX, tileScreenY, tilePxW, tilePxH;
    if (this._worldRenderer?.worldToScreen) {
      const sp = this._worldRenderer.worldToScreen(worldPos.x, worldPos.y);
      tileScreenX = sp.x;
      tileScreenY = sp.y;
      tilePxW = sp.tilePxW;
      tilePxH = sp.tilePxH;
    } else {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      tilePxW = TILE_SIZE / scaleX;
      tilePxH = TILE_SIZE / scaleY;
      tileScreenX =
        rect.left +
        (Math.floor(((clientX - rect.left) * scaleX) / TILE_SIZE) * TILE_SIZE) /
          scaleX;
      tileScreenY =
        rect.top +
        (Math.floor(((clientY - rect.top) * scaleY) / TILE_SIZE) * TILE_SIZE) /
          scaleY;
    }

    if (!this._tileTargetEl) {
      const el = document.createElement("canvas");
      el.style.position = "fixed";
      el.style.pointerEvents = "none";
      el.style.zIndex = "9998";
      el.style.imageRendering = "pixelated";
      document.body.appendChild(el);
      this._tileTargetEl = el;
    }

    const el = this._tileTargetEl;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.ceil(tilePxW * dpr);
    const pxH = Math.ceil(tilePxH * dpr);

    el.width = pxW;
    el.height = pxH;
    el.style.width = `${tilePxW}px`;
    el.style.height = `${tilePxH}px`;
    el.style.left = `${tileScreenX}px`;
    el.style.top = `${tileScreenY}px`;

    const ctx = el.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reseta transform acumulado
    ctx.clearRect(0, 0, pxW, pxH);
    ctx.scale(dpr, dpr);

    const w = tilePxW;
    const h = tilePxH;
    const b = 1; // espessura da borda em px lógicos
    const pad = 3;

    // Borda sutil branca
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = b;
    ctx.strokeRect(b / 2, b / 2, w - b, h - b);

    // Cruz discreta no centro
    const cx = w / 2;
    const cy = h / 2;
    const arm = Math.min(w, h) * 0.18;
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();

    // Cantos (réticos)
    const cr = Math.min(w, h) * 0.18;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    // ┌
    ctx.beginPath();
    ctx.moveTo(pad, pad + cr);
    ctx.lineTo(pad, pad);
    ctx.lineTo(pad + cr, pad);
    ctx.stroke();
    // ┐
    ctx.beginPath();
    ctx.moveTo(w - pad - cr, pad);
    ctx.lineTo(w - pad, pad);
    ctx.lineTo(w - pad, pad + cr);
    ctx.stroke();
    // └
    ctx.beginPath();
    ctx.moveTo(pad, h - pad - cr);
    ctx.lineTo(pad, h - pad);
    ctx.lineTo(pad + cr, h - pad);
    ctx.stroke();
    // ┘
    ctx.beginPath();
    ctx.moveTo(w - pad - cr, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(w - pad, h - pad - cr);
    ctx.stroke();
  }

  _hideTileTarget() {
    if (this._tileTargetEl) {
      this._tileTargetEl.remove();
      this._tileTargetEl = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Drop Zone
  // ---------------------------------------------------------------------------

  _getDropZoneAt(x, y) {
    const g = this._drag.ghostEl;
    if (g) g.style.visibility = "hidden";
    const el = document.elementFromPoint(x, y);
    if (g) g.style.visibility = "";
    return el?.closest("[data-drop-zone]") ?? null;
  }

  _refreshDropZones() {
    this._dropZones = Array.from(
      this._container.querySelectorAll?.("[data-drop-zone]") ?? [],
    );
  }

  _checkDropZones(x, y) {
    if (!this._dropZones.length) this._refreshDropZones();

    let connectedCount = 0;
    for (const zoneEl of this._dropZones) {
      if (zoneEl?.isConnected) connectedCount += 1;
    }
    if (connectedCount === 0) {
      this._refreshDropZones();
    }

    let best = null;
    for (const zoneEl of this._dropZones) {
      if (!zoneEl?.isConnected) continue;
      const score = this._calculateDropScore(zoneEl, x, y);
      if (!best || score > best.score) {
        best = { el: zoneEl, score };
      }
    }

    if (!best || best.score <= 0) {
      this._drag.bestDropZone = null;
      this._updateDropHighlight(null);
      this._clearDropPreview();
      return null;
    }

    this._drag.bestDropZone = best;
    this._updateDropHighlight(best.el);
    this._emitDropPreview(best.el, best.score);
    return best;
  }

  _calculateDropScore(dropEl, pointerX, pointerY) {
    const rect = dropEl.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return -1000;

    const expand = 18;
    const insideExpandedRect =
      pointerX >= rect.left - expand &&
      pointerX <= rect.right + expand &&
      pointerY >= rect.top - expand &&
      pointerY <= rect.bottom + expand;
    if (!insideExpandedRect) return -1000;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(pointerX - centerX, pointerY - centerY);
    const proximity = Math.max(0, 100 - distance);
    const valid = this._isValidDropZone(dropEl);

    let score = valid ? 100 + proximity : -50 + proximity * 0.1;
    const zone = dropEl.dataset.dropZone;
    const itemData = this._drag.itemData ?? {};

    if (zone === "equipment" && itemData?.type === "equipment") {
      score += 30;
      const targetSlot = dropEl.dataset.dropEquipSlot;
      if (itemData?.slot === targetSlot) score += 20;
    }

    if (zone === "inventory") score += 10;

    if (this._drag.source === "world" && zone === "inventory") {
      score += 15;
      const player = getPlayer(this._playerId);
      const currentWeight = Number(
        player?.stats?.inventoryWeight ?? player?.inventoryWeight ?? 0,
      );
      const maxWeight = Number(player?.stats?.maxInventoryWeight ?? 500);
      if (maxWeight > 0 && currentWeight / maxWeight >= 0.9) {
        score -= 15;
      }
    }

    return score;
  }

  _emitDropPreview(dropEl, score) {
    const payload = this._generateDropPreview(dropEl, score);
    if (!payload) return;

    worldEvents.emit(EVENT_TYPES.ITEM_DROP_PREVIEW, payload);
  }

  _generateDropPreview(dropEl, score) {
    if (!dropEl) return null;

    const zone = dropEl.dataset.dropZone;
    const base = {
      source: this._drag.source,
      worldItemId: this._drag.worldItemId,
      slotIndex: this._drag.slotIndex,
      equipSlot: this._drag.equipSlot,
      zone,
      score,
      isValid: this._isValidDropZone(dropEl),
      itemData: this._drag.itemData,
    };

    if (zone === "equipment") {
      return this._showEquipPreview(base, dropEl.dataset.dropEquipSlot ?? null);
    }

    if (zone === "inventory") {
      return {
        ...base,
        dropSlot:
          dropEl.dataset.dropSlot != null
            ? parseInt(dropEl.dataset.dropSlot, 10)
            : null,
        previewAction: this._drag.source === "world" ? "pickUp" : "move",
      };
    }

    if (zone === "ground") {
      return {
        ...base,
        previewAction: this._drag.source === "world" ? "moveWorld" : "drop",
      };
    }

    return base;
  }

  _showEquipPreview(base, targetSlot) {
    const canEquip =
      base?.itemData?.type === "equipment" &&
      base?.itemData?.slot === targetSlot;
    return {
      ...base,
      dropEquipSlot: targetSlot,
      canEquip,
      previewAction: canEquip ? "equip" : "none",
    };
  }

  _clearDropPreview() {
    worldEvents.emit(EVENT_TYPES.ITEM_DROP_PREVIEW, {
      source: this._drag.source,
      zone: null,
      score: 0,
      isValid: false,
      cleared: true,
    });
  }

  _updateDropHighlight(dropEl) {
    if (this._currentHighlight && this._currentHighlight !== dropEl) {
      this._currentHighlight.classList.remove(
        DRAG_CONFIG.classes.dropValid,
        DRAG_CONFIG.classes.dropInvalid,
      );
    }

    if (dropEl) {
      const isValid = this._isValidDropZone(dropEl);
      dropEl.classList.toggle(DRAG_CONFIG.classes.dropValid, isValid);
      dropEl.classList.toggle(DRAG_CONFIG.classes.dropInvalid, !isValid);
      this._currentHighlight = dropEl;
    } else {
      this._currentHighlight = null;
    }
  }

  _isValidDropZone(dropEl) {
    const { source, itemData } = this._drag;
    const zone = dropEl.dataset.dropZone;

    if (zone === "equipment") {
      // Só equipamentos com slot correto
      const targetSlot = dropEl.dataset.dropEquipSlot;
      return itemData?.type === "equipment" && itemData?.slot === targetSlot;
    }
    if (zone === "inventory") {
      return true; // Qualquer item vai para inventário
    }
    if (zone === "ground") {
      return source !== "world"; // Não pode dropar no chão o que já está no chão
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Canvas Utils
  // ---------------------------------------------------------------------------

  _screenToWorld(clientX, clientY) {
    if (this._worldRenderer?.screenToWorld) {
      return this._worldRenderer.screenToWorld(clientX, clientY);
    }
    if (this._canvas) {
      const rect = this._canvas.getBoundingClientRect();
      return {
        x: Math.floor((clientX - rect.left) / TILE_SIZE),
        y: Math.floor((clientY - rect.top) / TILE_SIZE),
        z: 7,
      };
    }
    return null;
  }

  _isOverCanvas(clientX, clientY) {
    if (!this._canvas) return false;
    const rect = this._canvas.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  _getWorldItemAt(x, y, z) {
    // Delegate para callback externo se disponível
    if (typeof this._getItemData === "function") {
      return this._getItemData("world", `${x},${y},${z}`);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  _cancelDrag() {
    this._drag.originEl?.classList.remove(DRAG_CONFIG.classes.originDragging);
    this._currentHighlight?.classList.remove(
      DRAG_CONFIG.classes.dropValid,
      DRAG_CONFIG.classes.dropInvalid,
    );
    this._currentHighlight = null;

    this._clearDropPreview();

    this._removeGhost();
    document.body.classList.remove(DRAG_CONFIG.classes.dragging);

    if (this._drag.active || this._drag.pending) {
      worldEvents.emit(EVENT_TYPES.ITEM_DRAG_END, {
        source: this._drag.source,
        slotIndex: this._drag.slotIndex,
      });
    }

    this._drag = _emptyDrag();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _emptyDrag() {
  return {
    active: false,
    pending: false,
    source: null,
    slotIndex: null,
    equipSlot: null,
    worldItemId: null,
    itemData: null,
    originEl: null,
    ghostEl: null,
    startX: 0,
    startY: 0,
    shiftKey: false,
    bestDropZone: null,
  };
}
