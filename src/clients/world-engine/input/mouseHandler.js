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

    const picked = pickTopVisibleTileAtScreen({
      worldState: this.worldState,
      px,
      py,
      tileSize: this.tileSize,
    });

    if (picked?.tile) {
      console.log(`[MouseHandler] tile ${picked.key}:`, picked.tile);
    }
  }

  destroy() {
    this._canvas.removeEventListener("click", this._onClick);
  }
}
