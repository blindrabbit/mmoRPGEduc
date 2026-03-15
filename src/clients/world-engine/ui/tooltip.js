// ═══════════════════════════════════════════════════════════════
// tooltip.js — Tooltip de hover sobre tiles do canvas
// ═══════════════════════════════════════════════════════════════
import { pickTopVisibleTileAtScreen } from "../input/tilePicker.js";

export class Tooltip {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {{ TILE_SIZE: number }} config
   */
  constructor(canvas, worldState, config) {
    this.canvas = canvas;
    this.worldState = worldState;
    this.tileSize = config?.TILE_SIZE ?? 32;

    this._el = document.getElementById("tooltip");
    this._hudHover = document.getElementById("hud-hover");

    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);

    canvas.addEventListener("mousemove", this._onMove);
    canvas.addEventListener("mouseleave", this._onLeave);
  }

  _onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const picked = pickTopVisibleTileAtScreen({
      worldState: this.worldState,
      px,
      py,
      tileSize: this.tileSize,
    });
    const tileX = picked.tileX;
    const tileY = picked.tileY;
    const tileZ = picked.tileZ;

    if (this._hudHover) {
      this._hudHover.innerText = `${tileX},${tileY},${tileZ}`;
    }

    const tile = picked.tile;

    if (!tile || !this._el) return;

    const items = this._extractItems(tile);
    const lines = items.map((item) => {
      const id = item?.id ?? item?.itemid ?? "?";
      const meta = this.worldState.assetsMgr?.getMapItemMetadata?.(id);
      const name = meta?.name ?? `id:${id}`;
      return name;
    });

    this._el.innerText = `[${tileX},${tileY},${tileZ}]\n${lines.join("\n")}`;
  }

  _extractItems(tile) {
    if (!tile) return [];
    if (Array.isArray(tile)) return tile;
    if (Array.isArray(tile.items)) return tile.items;

    const out = [];
    for (const value of Object.values(tile)) {
      if (Array.isArray(value)) out.push(...value);
    }
    return out;
  }

  _onLeave() {
    if (this._el) this._el.innerText = "Mova o mouse sobre o mapa...";
    if (this._hudHover) this._hudHover.innerText = "";
  }

  destroy() {
    this.canvas.removeEventListener("mousemove", this._onMove);
    this.canvas.removeEventListener("mouseleave", this._onLeave);
  }
}
