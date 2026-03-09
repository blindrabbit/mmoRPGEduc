// ═══════════════════════════════════════════════════════════════
// worldStateHUD.js — Exibe status do world_state do Firebase
// ═══════════════════════════════════════════════════════════════
import { watchWorldState } from "../../../core/db.js";

export class WorldStateHUD {
  constructor() {
    this._el = document.getElementById("hud-world");
    this._unsubscribe = null;
  }

  init() {
    if (!this._el) return;
    this._unsubscribe = watchWorldState((data) => {
      if (!data) {
        this._el.innerText = "N/A";
        return;
      }
      const status = data.status ?? "?";
      const ready  = data.isReadyToPlay ? "✓" : "✗";
      this._el.innerText = `${status} ${ready}`;
    });
  }

  destroy() {
    this._unsubscribe?.();
  }
}
