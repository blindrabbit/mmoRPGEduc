// ═══════════════════════════════════════════════════════════════
// floorHUD.js — Indicador visual de floors (pills)
// ═══════════════════════════════════════════════════════════════
export class FloorHUD {
  /**
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {number} floorRange — pisos visíveis acima/abaixo do ativo
   */
  constructor(worldState, floorRange) {
    this.worldState = worldState;
    this.floorRange = floorRange ?? 2;
    this._el = document.getElementById("floor-hud");
    this._hudZ = document.getElementById("hud-z");
  }

  /** Renderiza as pills de floor e atualiza hud-z */
  update() {
    const active = this.worldState.activeZ ?? 7;
    if (this._hudZ) this._hudZ.innerText = active;
    if (!this._el) return;

    const pills = [];
    for (let z = active + this.floorRange; z >= active - this.floorRange; z--) {
      let cls = "floor-pill";
      if (z === active)   cls += " active";
      else if (z > active) cls += " above";
      else                 cls += " below";

      pills.push(`<span class="${cls}" title="Floor ${z}">${z}</span>`);
    }
    this._el.innerHTML = pills.join("");
  }
}
