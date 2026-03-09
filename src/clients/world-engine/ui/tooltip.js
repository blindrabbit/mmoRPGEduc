// ═══════════════════════════════════════════════════════════════
// tooltip.js — Tooltip de hover sobre tiles do canvas
// ═══════════════════════════════════════════════════════════════
export class Tooltip {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {{ TILE_SIZE: number }} config
   */
  constructor(canvas, worldState, config) {
    this.canvas     = canvas;
    this.worldState = worldState;
    this.tileSize   = config?.TILE_SIZE ?? 32;

    this._el      = document.getElementById("tooltip");
    this._hudHover = document.getElementById("hud-hover");

    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);

    canvas.addEventListener("mousemove",  this._onMove);
    canvas.addEventListener("mouseleave", this._onLeave);
  }

  _onMove(e) {
    const rect  = this.canvas.getBoundingClientRect();
    const zoom  = this.worldState.zoom ?? 1;
    const tsize = this.tileSize * zoom;

    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const tileX = Math.floor(this.worldState.camera.x + px / tsize);
    const tileY = Math.floor(this.worldState.camera.y + py / tsize);
    const tileZ = this.worldState.activeZ ?? 7;

    if (this._hudHover) {
      this._hudHover.innerText = `${tileX},${tileY}`;
    }

    const key  = `${tileX},${tileY},${tileZ}`;
    const tile = this.worldState.map?.[key];

    if (!tile || !this._el) return;

    const items = Array.isArray(tile) ? tile : [tile];
    const lines = items.map((item) => {
      const id   = item?.id ?? item?.itemid ?? "?";
      const meta = this.worldState.assetsMgr?.getMapItemMetadata?.(id);
      const name = meta?.name ?? `id:${id}`;
      return name;
    });

    this._el.innerText = `[${tileX},${tileY},${tileZ}]\n${lines.join("\n")}`;
  }

  _onLeave() {
    if (this._el) this._el.innerText = "Mova o mouse sobre o mapa...";
    if (this._hudHover) this._hudHover.innerText = "";
  }

  destroy() {
    this.canvas.removeEventListener("mousemove",  this._onMove);
    this.canvas.removeEventListener("mouseleave", this._onLeave);
  }
}
