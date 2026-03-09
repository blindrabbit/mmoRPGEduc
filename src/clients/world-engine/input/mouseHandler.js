// ═══════════════════════════════════════════════════════════════
// mouseHandler.js — Clique no canvas para inspecionar tile
// ═══════════════════════════════════════════════════════════════
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
    const rect  = this._canvas.getBoundingClientRect();
    const zoom  = this.worldState.zoom ?? 1;
    const tsize = this.tileSize * zoom;

    const tileX = Math.floor(this.worldState.camera.x + (e.clientX - rect.left)  / tsize);
    const tileY = Math.floor(this.worldState.camera.y + (e.clientY - rect.top)   / tsize);
    const tileZ = this.worldState.activeZ ?? 7;

    const key  = `${tileX},${tileY},${tileZ}`;
    const tile = this.worldState.map?.[key];

    if (tile) {
      console.log(`[MouseHandler] tile ${key}:`, tile);
    }
  }

  destroy() {
    this._canvas.removeEventListener("click", this._onClick);
  }
}
