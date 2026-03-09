// ═══════════════════════════════════════════════════════════════
// worldTick.js — Timer de tick do mundo + init dos watchers Firebase
// ═══════════════════════════════════════════════════════════════
import { initWorldStore, setTickRunning } from "../../../core/worldStore.js";

export class WorldTick {
  /**
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {number} intervalMs
   * @param {import("../engine/bootLogger.js").BootLogger} logger
   */
  constructor(worldState, intervalMs = 250, logger) {
    this.worldState = worldState;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this._timer = null;
  }

  start() {
    // Inicia watchers Firebase (monsters, players, effects, fields, chat)
    initWorldStore();

    this._timer = setInterval(() => {
      setTickRunning(true);
      this.worldState.tickCount = (this.worldState.tickCount ?? 0) + 1;
      setTickRunning(false);
    }, this.intervalMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
