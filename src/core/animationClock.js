// =============================================================================
// animationClock.js — relógio global de animação (determinístico por cliente)
// =============================================================================

const DEFAULT_MAX_DELTA_MS = 100;

export class AnimationClock {
  constructor({ speed = 1, maxDeltaMs = DEFAULT_MAX_DELTA_MS } = {}) {
    this._speed = Number.isFinite(Number(speed)) ? Number(speed) : 1;
    this._maxDeltaMs = Number.isFinite(Number(maxDeltaMs))
      ? Math.max(1, Number(maxDeltaMs))
      : DEFAULT_MAX_DELTA_MS;
    this._lastTs = null;
    this._elapsed = 0;
    this._delta = 0;
  }

  tick(ts) {
    const nowTs = Number(ts);
    if (!Number.isFinite(nowTs)) {
      return { now: this._elapsed, delta: 0, rawDelta: 0 };
    }

    if (this._lastTs == null) {
      this._lastTs = nowTs;
      this._delta = 0;
      return { now: this._elapsed, delta: 0, rawDelta: 0 };
    }

    const rawDelta = Math.max(0, nowTs - this._lastTs);
    this._lastTs = nowTs;

    const clampedDelta = Math.min(rawDelta, this._maxDeltaMs);
    this._delta = clampedDelta * this._speed;
    this._elapsed += this._delta;

    return { now: this._elapsed, delta: this._delta, rawDelta };
  }

  reset(ts = null) {
    this._elapsed = 0;
    this._delta = 0;
    this._lastTs = Number.isFinite(Number(ts)) ? Number(ts) : null;
  }

  setSpeed(speed = 1) {
    this._speed = Number.isFinite(Number(speed)) ? Number(speed) : 1;
  }

  get now() {
    return this._elapsed;
  }

  get delta() {
    return this._delta;
  }
}

export function createAnimationClock(options = {}) {
  return new AnimationClock(options);
}
