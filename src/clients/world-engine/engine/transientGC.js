// ═══════════════════════════════════════════════════════════════
// transientGC.js — Garbage collector de effects/fields expirados
// ═══════════════════════════════════════════════════════════════
import { getEffects, getFields } from "../../../core/worldStore.js";
import { RuntimeConfig } from "../../../core/runtimeConfig.js";
import {
  batchWrite,
  dbGet,
  removeEffect,
  removeField,
} from "../../../core/db.js";

export class TransientGC {
  /**
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {import("../engine/bootLogger.js").BootLogger} logger
   */
  constructor(worldState, logger) {
    this.worldState = worldState;
    this.logger = logger;
    this._timer = null;
    this._lastMapClaimSweepAt = 0;
    this._currentIntervalMs = null;
  }

  start() {
    const intervalMs = RuntimeConfig.get("gc.transientIntervalMs", 5_000);
    this._currentIntervalMs = intervalMs;
    this._timer = setInterval(() => this._run(), intervalMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _run() {
    const now = Date.now();
    let removedTransient = 0;
    let removedClaims = 0;

    // Hot-reload: reinicia o timer se o intervalo foi alterado no Firebase.
    const newIntervalMs = RuntimeConfig.get("gc.transientIntervalMs", 5_000);
    if (newIntervalMs !== this._currentIntervalMs && newIntervalMs > 0) {
      clearInterval(this._timer);
      this._currentIntervalMs = newIntervalMs;
      this._timer = setInterval(() => this._run(), newIntervalMs);
    }

    for (const [id, e] of Object.entries(getEffects())) {
      if (e?.expiry && now > e.expiry) {
        removeEffect(id).catch(() => {});
        removedTransient++;
      }
    }

    for (const [id, f] of Object.entries(getFields())) {
      if (f?.expiry && now > f.expiry) {
        removeField(id).catch(() => {});
        removedTransient++;
      }
    }

    const gcEnabled = RuntimeConfig.get("features.enableMapClaimGC", true);
    const sweepIntervalMs = RuntimeConfig.get(
      "gc.mapClaimSweepIntervalMs",
      60_000,
    );
    if (gcEnabled && now - this._lastMapClaimSweepAt >= sweepIntervalMs) {
      this._lastMapClaimSweepAt = now;
      removedClaims = await this._cleanupExpiredMapClaims(now);
    }

    this.worldState.gcCount = (this.worldState.gcCount ?? 0) + 1;
    const removedTotal = removedTransient + removedClaims;
    if (removedTotal > 0) {
      const parts = [];
      if (removedTransient > 0) parts.push(`${removedTransient} transientes`);
      if (removedClaims > 0) parts.push(`${removedClaims} claims`);
      this.worldState.gcLastSummary = `${parts.join(" + ")} removidos`;
    }
  }

  async _cleanupExpiredMapClaims(now) {
    try {
      const claims = await dbGet("world_map_claims");
      if (!claims || typeof claims !== "object") return 0;

      const updates = {};
      let removed = 0;

      for (const [claimId, claim] of Object.entries(claims)) {
        if (!claim || typeof claim !== "object") continue;

        const ts = Number(claim.ts ?? claim.claimedAt ?? claim.createdAt ?? 0);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        const ttlMs = RuntimeConfig.get("gc.mapClaimTtlMs", 10 * 60 * 1000);
        if (now - ts <= ttlMs) continue;

        updates[`world_map_claims/${claimId}`] = null;
        removed++;
      }

      if (removed > 0) {
        await batchWrite(updates);
      }

      return removed;
    } catch (err) {
      this.logger?.warn?.(
        `[TransientGC] Falha ao limpar world_map_claims expiradas: ${err?.message ?? err}`,
      );
      return 0;
    }
  }
}
