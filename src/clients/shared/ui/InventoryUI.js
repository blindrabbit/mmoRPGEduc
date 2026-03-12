// =============================================================================
// InventoryUI.js — mmoRPGEduc
// Interface visual do inventário e equipamento do jogador.
//
// Suporta dois modos de renderização:
//   • DOM-based: container HTML com grid de slots (padrão recomendado)
//   • Canvas-based: overlay sobre o canvas do jogo
//
// Arquitetura:
//   • Escuta INVENTORY_UPDATED, ITEM_EQUIPPED, ITEM_UNEQUIPPED do núcleo
//   • Integra com DragDropManager para drag & drop
//   • Não acessa Firebase diretamente — usa worldEngine.sendAction()
//
// Dependências: events.js, DragDropManager.js, schema.js, config.js
// =============================================================================

import { worldEvents, EVENT_TYPES } from '../../../core/events.js';
import { DragDropManager } from '../input/DragDropManager.js';
import { ITEM_SCHEMA } from '../../../core/schema.js';
import { TILE_SIZE } from '../../../core/config.js';

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

export const INVENTORY_CONFIG = Object.freeze({
  slots: 20,
  cols: 5, // grid 5×4

  // Layout visual dos slots de equipamento (linha/coluna no grid CSS)
  equipmentLayout: [
    { slot: "helmet", label: "Cab", row: 1, col: 2 },
    { slot: "ring", label: "Anel", row: 2, col: 1 },
    { slot: "armor", label: "Corp", row: 2, col: 2 },
    { slot: "amulet", label: "Amu", row: 2, col: 3 },
    { slot: "weapon", label: "Arma", row: 3, col: 1 },
    { slot: "backpack", label: "Moch", row: 3, col: 2 },
    { slot: "shield", label: "Esc", row: 3, col: 3 },
    { slot: "boots", label: "Bot", row: 4, col: 2 },
  ],

  // Cores de raridade (usadas no border-color do slot)
  rarity: {
    common: "#888",
    uncommon: "#4c4",
    rare: "#48f",
    epic: "#a4f",
    legendary: "#f84",
  },
});

// =============================================================================
// CLASSE PRINCIPAL
// =============================================================================

export class InventoryUI {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Elemento raiz do painel
   * @param {Object} options.worldEngine - Instância de WorldEngineInterface
   * @param {string} options.playerId
   * @param {HTMLCanvasElement} [options.canvas] - Canvas do jogo (para drag de itens do chão)
   * @param {Object} [options.worldRenderer] - Renderer com screenToWorld()
   */
  constructor({
    container,
    worldEngine,
    playerId,
    canvas = null,
    worldRenderer = null,
    itemDataService = null,
    createGhostElement = null,
    createItemIconElement = null,
    getItemDescription = null,
  } = {}) {
    this._container = container;
    this._engine = worldEngine;
    this._playerId = playerId;

    /** @type {Object.<number, Object>} slot → item */
    this._inventory = {};
    /** @type {Object.<string, Object>} equipSlot → item */
    this._equipment = {};

    this._dragDrop = new DragDropManager({
      worldEngine,
      playerId,
      getItemData: (source, key) => this._resolveItemData(source, key),
      container,
      canvas,
      worldRenderer,
      itemDataService,
      createGhostElement,
    });

    this._createItemIconElement = createItemIconElement;
    this._getItemDescription = getItemDescription;

    this._unsubs = [];
    this._visible = false;
    this._feedbackTimeout = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  mount() {
    this._injectStyles();
    this._render();
    this._dragDrop.mount();
    this._setupEventListeners();
  }

  unmount() {
    this._dragDrop.unmount();
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    clearTimeout(this._feedbackTimeout);
  }

  show() {
    this._visible = true;
    const panel = this._container.querySelector(".inventory-panel");
    if (panel) panel.classList.add("visible");
  }

  hide() {
    this._visible = false;
    const panel = this._container.querySelector(".inventory-panel");
    if (panel) panel.classList.remove("visible");
  }

  toggle() {
    this._visible ? this.hide() : this.show();
  }

  // ---------------------------------------------------------------------------
  // Atualização de estado (chamado ao receber snapshot do Firebase)
  // ---------------------------------------------------------------------------

  setInventory(inventory) {
    this._inventory = inventory ?? {};
    this._renderInventoryGrid();
  }

  setEquipment(equipment) {
    this._equipment = equipment ?? {};
    this._renderEquipmentGrid();
  }

  // ---------------------------------------------------------------------------
  // Event Listeners do Núcleo
  // ---------------------------------------------------------------------------

  _setupEventListeners() {
    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.INVENTORY_UPDATED, (e) => {
        if (e.playerId !== this._playerId) return;
        if (e.inventory) {
          this._inventory = e.inventory;
          this._renderInventoryGrid();
        }
        if (e.equipment) {
          this._equipment = e.equipment;
          this._renderEquipmentGrid();
        }
      }),
    );

    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.ITEM_EQUIPPED, (e) => {
        if (e.playerId !== this._playerId) return;
        this._equipment[e.slot] = e.item ?? null;
        this._renderEquipmentGrid();
        if (e.newStats) this._renderStatsPreview(e.newStats);
      }),
    );

    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.ITEM_UNEQUIPPED, (e) => {
        if (e.playerId !== this._playerId) return;
        delete this._equipment[e.slot];
        this._renderEquipmentGrid();
        if (e.newStats) this._renderStatsPreview(e.newStats);
      }),
    );

    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.ITEM_DRAG_START, () => {
        this._container.classList.add("is-dragging");
      }),
    );

    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.ITEM_DRAG_END, () => {
        this._container.classList.remove("is-dragging");
      }),
    );

    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.ITEM_DROP_VALID, () =>
        this._showFeedback("valid"),
      ),
    );

    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.ITEM_DROP_INVALID, () =>
        this._showFeedback("invalid"),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render() {
    this._container.innerHTML = `
      <div class="inventory-panel" role="dialog" aria-label="Inventário">
        <div class="inventory-header">
          <span class="inventory-title">Inventário</span>
          <div class="inventory-stats-preview"></div>
          <button class="inventory-close" aria-label="Fechar inventário">✕</button>
        </div>
        <div class="inventory-body">
          <div class="equipment-section">
            <p class="section-label">Equipamento</p>
            <div class="equipment-grid"></div>
          </div>
          <div class="inventory-section">
            <p class="section-label">Bolsa</p>
            <div class="inventory-grid"></div>
          </div>
        </div>
        <div class="inventory-feedback" aria-live="polite"></div>
      </div>
    `;

    this._container
      .querySelector(".inventory-close")
      ?.addEventListener("click", () => this.hide());

    this._renderInventoryGrid();
    this._renderEquipmentGrid();
  }

  _renderInventoryGrid() {
    const grid = this._container.querySelector(".inventory-grid");
    if (!grid) return;

    const slots = Array.from({ length: INVENTORY_CONFIG.slots }, (_, i) => {
      return this._buildInventorySlot(i, this._inventory[i] ?? null);
    });
    grid.replaceChildren(...slots);
  }

  _renderEquipmentGrid() {
    const grid = this._container.querySelector(".equipment-grid");
    if (!grid) return;

    const slots = INVENTORY_CONFIG.equipmentLayout.map(
      ({ slot, label, row, col }) => {
        const item = this._equipment[slot] ?? null;
        const el = this._buildEquipmentSlot(slot, label, item);
        el.style.gridRow = row;
        el.style.gridColumn = col;
        return el;
      },
    );
    grid.replaceChildren(...slots);
  }

  _renderStatsPreview(stats) {
    const el = this._container.querySelector(".inventory-stats-preview");
    if (!el) return;
    const parts = [];
    if (stats.atk != null) parts.push(`ATK ${stats.atk}`);
    if (stats.def != null) parts.push(`DEF ${stats.def}`);
    if (stats.maxHp != null) parts.push(`HP ${stats.maxHp}`);
    el.textContent = parts.join("  ");
  }

  // ---------------------------------------------------------------------------
  // Builders
  // ---------------------------------------------------------------------------

  _buildInventorySlot(slotIndex, item) {
    const el = document.createElement("div");
    el.className = "inventory-slot";
    el.dataset.dropZone = "inventory";
    el.dataset.dropSlot = slotIndex;

    if (item) {
      el.classList.add("has-item");
      el.dataset.itemSource = "inventory";
      el.dataset.itemSlot = slotIndex;
      if (item.rarity)
        el.style.borderColor = INVENTORY_CONFIG.rarity[item.rarity] ?? "";

      const icon = document.createElement("div");
      const builtIcon = this._buildItemIcon(item);
      if (builtIcon) {
        builtIcon.setAttribute("aria-label", item.name ?? "item");
        el.appendChild(builtIcon);
      } else {
        icon.className = "item-icon";
        if (item.spriteId != null) icon.dataset.spriteId = item.spriteId;
        icon.setAttribute("aria-label", item.name);
        el.appendChild(icon);
      }

      if (item.stackable && (item.quantity ?? 1) > 1) {
        const qty = document.createElement("span");
        qty.className = "item-qty";
        qty.textContent = item.quantity;
        el.appendChild(qty);
      }

      el.title = this._buildTooltipText(item);
      el.addEventListener("dblclick", () =>
        this._onInventoryDblClick(slotIndex, item),
      );
    }

    return el;
  }

  _buildEquipmentSlot(slot, label, item) {
    const el = document.createElement("div");
    el.className = `equipment-slot equip-${slot}`;
    el.dataset.dropZone = "equipment";
    el.dataset.dropEquipSlot = slot;
    el.setAttribute("aria-label", label);

    if (item) {
      el.classList.add("has-item");
      el.dataset.itemSource = "equipment";
      el.dataset.itemEquipSlot = slot;
      if (item.rarity)
        el.style.borderColor = INVENTORY_CONFIG.rarity[item.rarity] ?? "";

      const icon = this._buildItemIcon(item);
      if (icon) {
        icon.setAttribute("aria-label", item.name ?? "item");
        el.appendChild(icon);
      } else {
        const fallbackIcon = document.createElement("div");
        fallbackIcon.className = "item-icon";
        if (item.spriteId != null)
          fallbackIcon.dataset.spriteId = item.spriteId;
        fallbackIcon.setAttribute("aria-label", item.name);
        el.appendChild(fallbackIcon);
      }
      el.title = this._buildTooltipText(item);
      el.addEventListener("dblclick", () =>
        this._sendAction({ itemAction: "unequip", equipSlot: slot }),
      );
    } else {
      const lbl = document.createElement("span");
      lbl.className = "slot-label";
      lbl.textContent = label;
      el.appendChild(lbl);
    }

    return el;
  }

  // ---------------------------------------------------------------------------
  // Duplo clique: ação rápida
  // ---------------------------------------------------------------------------

  _onInventoryDblClick(slotIndex, item) {
    if (item.type === "equipment") {
      this._sendAction({ itemAction: "equip", slotIndex });
    } else if (item.type === "consumable") {
      this._sendAction({ itemAction: "use", slotIndex });
    }
  }

  _sendAction(payload) {
    if (!this._engine) return;
    this._engine
      .sendAction({
        type: "item",
        payload: { ...payload, playerId: this._playerId },
      })
      .catch((err) => console.error("[InventoryUI] sendAction error:", err));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _resolveItemData(source, key) {
    if (source === "inventory") return this._inventory[key] ?? null;
    if (source === "equipment") return this._equipment[key] ?? null;
    return null;
  }

  _showFeedback(type) {
    const el = this._container.querySelector(".inventory-feedback");
    if (!el) return;
    el.textContent = type === "invalid" ? "Local inválido" : "";
    el.className = `inventory-feedback feedback-${type}`;
    clearTimeout(this._feedbackTimeout);
    this._feedbackTimeout = setTimeout(() => {
      if (el) {
        el.textContent = "";
        el.className = "inventory-feedback";
      }
    }, 1200);
  }

  _buildItemIcon(item) {
    if (typeof this._createItemIconElement !== "function") return null;
    try {
      const built = this._createItemIconElement(item);
      if (built instanceof HTMLElement) return built;
      return null;
    } catch {
      return null;
    }
  }

  _buildTooltipText(item) {
    const lines = [`${item.name} [${item.type}]`];
    const externalDesc =
      typeof this._getItemDescription === "function"
        ? this._getItemDescription(item)
        : null;
    if (item.description) lines.push(item.description);
    else if (externalDesc) lines.push(String(externalDesc));
    if (item.stats) {
      lines.push(
        Object.entries(item.stats)
          .map(([k, v]) => `${k}: ${v > 0 ? "+" : ""}${v}`)
          .join("  "),
      );
    }
    if (item.effect)
      lines.push(`Efeito: ${item.effect.type} +${item.effect.value ?? ""}`);
    if (item.value) lines.push(`Valor: ${item.value} gold`);
    if (item.weight) lines.push(`Peso: ${item.weight}`);
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // CSS injetado dinamicamente (evita dependência de arquivo .css externo)
  // ---------------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById("inventory-ui-styles")) return;
    const style = document.createElement("style");
    style.id = "inventory-ui-styles";
    style.textContent = `
      .inventory-panel {
        display: none;
        position: absolute;
        top: 60px; right: 12px;
        background: #0d1117;
        border: 1px solid #1a2a3a;
        border-radius: 8px;
        padding: 10px;
        min-width: 270px;
        font-family: monospace;
        font-size: 11px;
        color: #ddd;
        user-select: none;
        z-index: 200;
      }
      .inventory-panel.visible { display: block; }

      .inventory-header {
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 8px;
      }
      .inventory-title { font-weight: bold; font-size: 12px; flex: 1; color: #2ecc71; }
      .inventory-stats-preview { font-size: 10px; color: #aaa; }
      .inventory-close {
        background: #111827; border: 1px solid #1a2a3a; color: #aaa;
        border-radius: 4px; width: 20px; height: 20px;
        cursor: pointer; font-size: 11px; line-height: 1;
      }
      .inventory-close:hover { background: #1a2a3a; color: #fff; }

      .inventory-body { display: flex; gap: 12px; }
      .section-label { font-size: 10px; color: #7f8c8d; margin: 0 0 4px; }

      /* Equipment grid: 3 cols × 3 rows */
      .equipment-grid {
        display: grid;
        grid-template-columns: repeat(3, ${TILE_SIZE}px);
        grid-template-rows: repeat(4, ${TILE_SIZE}px);
        gap: 4px;
        padding: 6px;
      }

      /* Inventory grid: COLS cols */
      .inventory-grid {
        display: grid;
        grid-template-columns: repeat(${INVENTORY_CONFIG.cols}, ${TILE_SIZE}px);
        gap: 3px;
        padding: 6px;
      }

      .inventory-slot, .equipment-slot {
        width: ${TILE_SIZE}px; height: ${TILE_SIZE}px;
        background: #111827;
        border: 1px solid #1a2a3a;
        border-radius: 3px;
        position: relative;
        cursor: default;
        display: flex; align-items: center; justify-content: center;
        box-sizing: border-box;
      }
      .inventory-slot:hover, .equipment-slot:hover {
        border-color: #2ecc71;
      }
      .inventory-slot.has-item, .equipment-slot.has-item { cursor: grab; }
      .inventory-slot.has-item:active, .equipment-slot.has-item:active { cursor: grabbing; }

      .slot-label {
        position: absolute; top: 2px; left: 3px;
        font-size: 8px; color: #444; pointer-events: none;
      }

      .item-icon {
        width: ${TILE_SIZE - 6}px; height: ${TILE_SIZE - 6}px;
        background: #444;
        border-radius: 3px;
        image-rendering: pixelated;
      }

      .item-qty {
        position: absolute; bottom: 1px; right: 3px;
        font-size: 9px; color: #ff8; font-weight: bold;
        text-shadow: 0 0 2px #000;
        pointer-events: none;
      }

      /* Drag & drop feedback */
      .drop-zone-valid {
        border-color: #4c9 !important;
        box-shadow: 0 0 6px #4c9;
      }
      .drop-zone-invalid {
        border-color: #c44 !important;
        box-shadow: 0 0 6px #c44;
      }
      .slot-origin-dragging { opacity: 0.4; }

      /* Ghost item */
      .item-drag-ghost {
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }

      .inventory-feedback {
        min-height: 14px; font-size: 10px;
        margin-top: 6px; text-align: center;
        color: #c44;
      }
      .feedback-valid { color: #4c9; }
    `;
    document.head.appendChild(style);
  }
}

