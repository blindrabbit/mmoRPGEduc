// ═══════════════════════════════════════════════════════════════
// hudRenderer.js — Atualiza HUD de tick, GC e wake lock
// ═══════════════════════════════════════════════════════════════
export class HUDRenderer {
  /**
   * @param {import("../../../core/worldState.js").WorldState} worldState
   */
  constructor(worldState) {
    this.worldState = worldState;
    this._tickEl = document.getElementById("tick-hud");
    this._gcEl   = document.getElementById("hud-gc");
    this._wakeEl = document.getElementById("hud-wake");
  }

  /** Chamado a cada frame pelo GameLoop */
  update() {
    const ws = this.worldState;

    if (this._tickEl) {
      this._tickEl.innerText = `tick #${ws.tickCount ?? 0}`;
      this._tickEl.classList.toggle("active", (ws.tickCount ?? 0) > 0);
    }

    if (this._gcEl) {
      this._gcEl.innerText = ws.gcCount ?? 0;
    }

    if (this._wakeEl) {
      this._wakeEl.innerText = ws.wakeLockActive ? "ON" : "OFF";
    }
  }
}
