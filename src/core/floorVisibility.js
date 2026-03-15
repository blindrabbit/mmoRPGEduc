import { GROUND_Z } from "./config.js";

export const FLOOR_LIMITS = Object.freeze({
  min: 0,
  max: 15,
  surfaceMax: GROUND_Z,
  undergroundDelta: 2,
});

function _toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function clampFloor(z, limits = FLOOR_LIMITS) {
  const floor = _toInt(z, limits.surfaceMax);
  return Math.max(limits.min, Math.min(limits.max, floor));
}

export function canSeeFloor(observerZ, floorZ, limits = FLOOR_LIMITS) {
  const oz = clampFloor(observerZ, limits);
  const tz = clampFloor(floorZ, limits);

  if (oz <= limits.surfaceMax) {
    return tz <= limits.surfaceMax;
  }
  return Math.abs(oz - tz) <= limits.undergroundDelta;
}

export function getVisibleFloors(observerZ, limits = FLOOR_LIMITS) {
  const oz = clampFloor(observerZ, limits);

  if (oz <= limits.surfaceMax) {
    const out = [];
    for (let z = limits.surfaceMax; z >= limits.min; z--) {
      out.push(z);
    }
    return out;
  }

  const maxZ = Math.min(limits.max, oz + limits.undergroundDelta);
  const minZ = Math.max(limits.min, oz - limits.undergroundDelta);
  const out = [];
  for (let z = maxZ; z >= minZ; z--) {
    out.push(z);
  }
  return out;
}
