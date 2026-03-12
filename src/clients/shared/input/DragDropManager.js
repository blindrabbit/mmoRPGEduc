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

import { worldEvents, EVENT_TYPES } from '../../../core/events.js';
import { TILE_SIZE } from '../../../core/config.js';

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
    dragging: 'item-dragging',
    ghost: 'item-drag-ghost',
    dropValid: 'drop-zone-valid',
    dropInvalid: 'drop-zone-invalid',
    originDragging: 'slot-origin-dragging',
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
    this._container.addEventListener('pointerdown', this._onPointerDown);
    document.addEventListener('pointermove', this._onPointerMove, { passive: true });
    document.addEventListener('pointerup', this._onPointerUp);
    document.addEventListener('keydown', this._onKeyDown);

    // Suporte canvas: itens no mapa arrastáveis via worldRenderer
    if (this._canvas) {
      this._canvas.addEventListener('pointerdown', this._onCanvasPointerDownBound);
    }
  }

  unmount() {
    this._container.removeEventListener('pointerdown', this._onPointerDown);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('keydown', this._onKeyDown);

    if (this._canvas) {
      this._canvas.removeEventListener('pointerdown', this._onCanvasPointerDownBound);
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

    // Verifica se há item do mundo na posição
    const worldItem = this._getWorldItemAt(worldPos.x, worldPos.y, worldPos.z ?? 7);
    if (!worldItem) return;

    // Valida via ItemDataService: só inicia drag se o item puder ser movido/pego
    if (this._itemDataService) {
      const tileId = worldItem.tileId ?? worldItem.id;
      if (!this._itemDataService.canPickUp(tileId) && !this._itemDataService.canMove(tileId)) {
        return; // item fixo — não pode ser arrastado
      }
    }

    e.stopPropagation(); // não propaga para o handler DOM abaixo

    this._drag = {
      ..._emptyDrag(),
      active: false, // ativa após threshold
      pending: true,
      source: 'world',
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

    const itemEl = e.target.closest('[data-item-source]');
    if (!itemEl) return;

    e.preventDefault();

    const source = itemEl.dataset.itemSource;
    const slotIndex = itemEl.dataset.itemSlot != null
      ? parseInt(itemEl.dataset.itemSlot, 10)
      : null;
    const equipSlot = itemEl.dataset.itemEquipSlot ?? null;
    const worldItemId = itemEl.dataset.itemWorldId ?? null;
    const key = slotIndex ?? equipSlot ?? worldItemId;

    const itemData = this._getItemData(source, key);
    if (!itemData) return;

    // Valida via ItemDataService: itens de inventário/equipamento sempre podem
    // ser arrastados; itens do mundo (source==='world') verificam canPickUp/canMove
    if (source === 'world' && this._itemDataService) {
      const tileId = itemData.tileId ?? itemData.id;
      if (!this._itemDataService.canPickUp(tileId) && !this._itemDataService.canMove(tileId)) {
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
    this._updateDropHighlight(this._getDropZoneAt(e.clientX, e.clientY));
  }

  _onPointerUp(e) {
    if (!this._drag.active && !this._drag.pending) return;

    if (this._drag.active) {
      const dropEl = this._getDropZoneAt(e.clientX, e.clientY);

      if (dropEl) {
        this._executeDrop(dropEl);
      } else if (this._canvas && this._isOverCanvas(e.clientX, e.clientY)) {
        // Drop no chão do mapa (canvas)
        this._executeDropOnGround(e.clientX, e.clientY);
      } else {
        worldEvents.emit(EVENT_TYPES.ITEM_DROP_INVALID, {
          source: this._drag.source,
          slotIndex: this._drag.slotIndex,
          reason: 'no-drop-zone',
        });
      }
    }

    this._cancelDrag();
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && (this._drag.active || this._drag.pending)) {
      worldEvents.emit(EVENT_TYPES.ITEM_DROP_INVALID, {
        source: this._drag.source,
        reason: 'cancelled',
      });
      this._cancelDrag();
    }
  }

  // ---------------------------------------------------------------------------
  // Ativar drag (após threshold)
  // ---------------------------------------------------------------------------

  _activateDrag() {
    const { source, slotIndex, equipSlot, worldItemId, itemData, originEl } = this._drag;

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
    const dropSlot = dropEl.dataset.dropSlot != null
      ? parseInt(dropEl.dataset.dropSlot, 10)
      : null;
    const dropEquipSlot = dropEl.dataset.dropEquipSlot ?? null;
    const { source, slotIndex, equipSlot, worldItemId } = this._drag;

    let action = null;

    if (source === 'inventory' && dropZone === 'inventory') {
      if (slotIndex !== dropSlot) {
        action = { itemAction: 'move', slotIndex, toSlot: dropSlot };
      }
    } else if (source === 'inventory' && dropZone === 'equipment') {
      action = { itemAction: 'equip', slotIndex };
    } else if (source === 'equipment' && dropZone === 'inventory') {
      action = { itemAction: 'unequip', equipSlot, slotIndex: dropSlot };
    } else if (source === 'equipment' && dropZone === 'equipment') {
      if (equipSlot !== dropEquipSlot) {
        // Desequipa — o servidor move para inventário; depois o cliente re-equipa
        action = { itemAction: 'unequip', equipSlot };
      }
    } else if (source === 'world' && dropZone === 'inventory') {
      action = { itemAction: 'pickUp', worldItemId };
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

    if (source === 'inventory' && slotIndex != null) {
      this._sendAction({ itemAction: 'drop', slotIndex });
    } else if (source === 'equipment' && equipSlot) {
      this._sendAction({ itemAction: 'unequip', equipSlot });
    } else if (source === 'world' && worldItemId && worldPos) {
      const isStackable = this._itemDataService?.isStackable(
        this._drag.itemData?.tileId ?? this._drag.itemData?.id,
      ) ?? !!this._drag.itemData?.stackable;
      const totalQty = Number(this._drag.itemData?.quantity ?? this._drag.itemData?.count ?? 1);
      const doSplit = this._drag.shiftKey && isStackable && totalQty > 1;

      if (doSplit) {
        const splitQty = Math.max(1, Math.floor(totalQty / 2));
        this._sendAction({
          itemAction: 'splitWorld',
          worldItemId,
          splitQty,
          toX: worldPos.x,
          toY: worldPos.y,
          toZ: worldPos.z ?? 7,
        });
      } else {
        this._sendAction({
          itemAction: 'moveWorld',
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

    this._engine.sendAction({
      type: 'item',
      payload: { ...payload, playerId: this._playerId },
    }).catch((err) => console.error('[DragDropManager] sendAction failed:', err));
  }

  // ---------------------------------------------------------------------------
  // Ghost DOM Element
  // ---------------------------------------------------------------------------

  _createGhost(x, y) {
    const { originEl, itemData } = this._drag;

    let ghost;
    if (originEl) {
      ghost = originEl.cloneNode(true);
    } else if (this._createGhostElement) {
      // Sprite do canvas — usa callback externo para renderizar o sprite correto
      ghost = this._createGhostElement(itemData);
    } else {
      // Fallback genérico
      ghost = document.createElement('div');
      ghost.style.width = `${TILE_SIZE}px`;
      ghost.style.height = `${TILE_SIZE}px`;
      ghost.style.background = '#666';
      ghost.style.border = '1px solid #aaa';
      ghost.style.borderRadius = '4px';
    }

    Object.assign(ghost.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '9999',
      opacity: DRAG_CONFIG.ghostAlpha,
      transform: 'translate(-50%, -50%) scale(1.1)',
      transition: 'none',
      left: `${x}px`,
      top: `${y}px`,
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
  }

  _removeGhost() {
    this._drag.ghostEl?.remove();
    this._drag.ghostEl = null;
  }

  // ---------------------------------------------------------------------------
  // Drop Zone
  // ---------------------------------------------------------------------------

  _getDropZoneAt(x, y) {
    const g = this._drag.ghostEl;
    if (g) g.style.visibility = 'hidden';
    const el = document.elementFromPoint(x, y);
    if (g) g.style.visibility = '';
    return el?.closest('[data-drop-zone]') ?? null;
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

    if (zone === 'equipment') {
      // Só equipamentos com slot correto
      const targetSlot = dropEl.dataset.dropEquipSlot;
      return itemData?.type === 'equipment' && itemData?.slot === targetSlot;
    }
    if (zone === 'inventory') {
      return true; // Qualquer item vai para inventário
    }
    if (zone === 'ground') {
      return source !== 'world'; // Não pode dropar no chão o que já está no chão
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
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom
    );
  }

  _getWorldItemAt(x, y, z) {
    // Delegate para callback externo se disponível
    if (typeof this._getItemData === 'function') {
      return this._getItemData('world', `${x},${y},${z}`);
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
  };
}
