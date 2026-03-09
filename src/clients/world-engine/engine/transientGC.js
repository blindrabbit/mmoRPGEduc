// ═══════════════════════════════════════════════════════════════
// transientGC.js — Garbage collector de effects/fields expirados
// ═══════════════════════════════════════════════════════════════
import { getEffects, getFields } from "../../../core/worldStore.js";
import { removeEffect, removeField } from "../../../core/db.js";

const GC_INTERVAL_MS = 5_000;

export class TransientGC {
  /**
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {import("../engine/bootLogger.js").BootLogger} logger
   */
  constructor(worldState, logger) {
    this.worldState = worldState;
    this.logger = logger;
    this._timer = null;
  }

  start() {
    this._timer = setInterval(() => this._run(), GC_INTERVAL_MS);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _run() {
    const now = Date.now();
    let removed = 0;

    for (const [id, e] of Object.entries(getEffects())) {
      if (e?.expiry && now > e.expiry) {
        removeEffect(id).catch(() => {});
        removed++;
      }
    }

    for (const [id, f] of Object.entries(getFields())) {
      if (f?.expiry && now > f.expiry) {
        removeField(id).catch(() => {});
        removed++;
      }
    }

    this.worldState.gcCount = (this.worldState.gcCount ?? 0) + 1;
    if (removed > 0) {
      this.worldState.gcLastSummary = `${removed} removidos`;
    }
  }
}
