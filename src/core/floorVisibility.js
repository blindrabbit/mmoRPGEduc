import { GROUND_Z } from "./config.js";

export const FLOOR_LIMITS = Object.freeze({
  min: 0,
  max: 15,
  surfaceMax: GROUND_Z,
  undergroundDelta: 2,
});

// ─── isFloorVisible ───────────────────────────────────────────────────────────
/**
 * Verifica se um floor (tileZ) é visível da posição da câmera (cameraZ).
 *
 * Regra Canary / Tibia:
 *   • Superfície (cameraZ ≤ 7): vê todos os floors 0-7
 *   • Underground (cameraZ > 7): vê apenas ±2 do floor atual (e apenas ≥ 8)
 *
 * Alias legível para canSeeFloor — use este nos novos módulos.
 *
 * @param {number} cameraZ
 * @param {number} tileZ
 * @param {typeof FLOOR_LIMITS} [limits]
 * @returns {boolean}
 */
export function isFloorVisible(cameraZ, tileZ, limits = FLOOR_LIMITS) {
  return canSeeFloor(cameraZ, tileZ, limits);
}

/**
 * Atualiza a flag `isVisible` de cada FloorLayer com base no cameraZ.
 * Chame antes do loop de renderização a cada frame.
 *
 * @param {Record<number, { isVisible: boolean }>} floorLayers
 * @param {number} cameraZ
 * @param {typeof FLOOR_LIMITS} [limits]
 */
export function updateFloorVisibility(floorLayers, cameraZ, limits = FLOOR_LIMITS) {
  for (let z = limits.min; z <= limits.max; z++) {
    if (floorLayers[z]) {
      floorLayers[z].isVisible = canSeeFloor(cameraZ, z, limits);
    }
  }
}

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
