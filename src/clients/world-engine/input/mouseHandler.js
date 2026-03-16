// ═══════════════════════════════════════════════════════════════
// mouseHandler.js — Clique no canvas para inspecionar tile
// ═══════════════════════════════════════════════════════════════
import { pickTopVisibleTileAtScreen } from "./tilePicker.js";

export class MouseHandler {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {{ TILE_SIZE: number }} config
   */
  constructor(canvas, worldState, config) {
    this.worldState = worldState;
    this.tileSize = config?.TILE_SIZE ?? 32;

    this._onClick = this._onClick.bind(this);
    canvas.addEventListener("click", this._onClick);
    this._canvas = canvas;
  }

  _onClick(e) {
    const rect = this._canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Ctrl+Click: força busca apenas no floor ativo (evita pegar tiles de outros Z)
    const forceFloor = e.ctrlKey
      ? Number(this.worldState.activeZ ?? 7)
      : null;

    const picked = pickTopVisibleTileAtScreen({
      worldState: this.worldState,
      px,
      py,
      tileSize: this.tileSize,
      forceFloor,
    });

    if (picked) {
      const modeLabel = forceFloor !== null ? ` [Ctrl→Z${forceFloor}]` : "";
      console.log(`[MouseHandler] tile ${picked.key}${modeLabel} (floorZ=${picked.floorZ}):`, picked.tile);
    }
  }

  destroy() {
    this._canvas.removeEventListener("click", this._onClick);
  }
}
