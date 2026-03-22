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

// ─── calcFirstVisibleFloor ────────────────────────────────────────────────────
/**
 * Calcula o primeiro andar visível a partir da posição da câmera,
 * verificando tiles ao redor para detectar cobertura (tetos, paredes).
 *
 * Replica OTClient MapView::calcFirstVisibleFloor() + Position::coveredUp().
 * coveredUp(n): z-=n, x+=n, y+=n  — projeção isométrica de andares superiores.
 *
 * @param {number} cameraX   - tile X da câmera
 * @param {number} cameraY   - tile Y da câmera
 * @param {number} cameraZ   - andar da câmera
 * @param {Object} map       - mapa compacto {coord: tileData}
 * @param {Object} nexoData  - appearances_map {spriteId: metadata}
 * @param {typeof FLOOR_LIMITS} [limits]
 * @returns {number}         - primeiro andar visível (0..cameraZ)
 */
export function calcFirstVisibleFloor(cameraX, cameraY, cameraZ, map, nexoData, limits = FLOOR_LIMITS) {
  const oz = clampFloor(cameraZ, limits);

  // Underground: firstFloor limitado pelo range aware
  if (oz > limits.surfaceMax) {
    return Math.max(limits.min,
      oz - limits.undergroundDelta,
      limits.surfaceMax + 1
    );
  }

  // Superfície: verifica tiles ao redor (posições cardinais + centro)
  let firstFloor = 0;

  for (let ix = -1; ix <= 1 && firstFloor < oz; ix++) {
    for (let iy = -1; iy <= 1 && firstFloor < oz; iy++) {
      // Só posições cardinais e o centro (não diagonais puras) — igual ao OTClient
      if (ix !== 0 && iy !== 0) continue;

      let checkX = Math.floor(cameraX) + ix;
      let checkY = Math.floor(cameraY) + iy;
      let checkZ = oz;

      // coveredUp: a cada step, z-=1, x+=1, y+=1 (projeção isométrica)
      while (checkZ > firstFloor) {
        checkZ -= 1;
        checkX += 1;
        checkY += 1;

        const coord = `${checkX},${checkY},${checkZ}`;
        const tile = map?.[coord];
        if (!tile) continue;

        if (_tileLimitsFloor(tile, nexoData)) {
          firstFloor = checkZ + 1;
          break;
        }
      }
    }
  }

  return Math.max(0, Math.min(firstFloor, oz));
}

/**
 * Verifica se um tile limita a visão para andares inferiores.
 * Um tile limita a visão se tiver chão sólido (bank) ou parede que bloqueia projéteis.
 * Replica OTClient Tile::limitsFloorsView().
 */
function _tileLimitsFloor(tileData, nexoData) {
  if (!tileData || !nexoData) return false;

  // Flatten todos os sprite IDs do tile
  const ids = [];
  if (typeof tileData === "object" && !Array.isArray(tileData)) {
    for (const key of Object.keys(tileData)) {
      if (isNaN(Number(key))) continue;
      const layer = tileData[key];
      if (Array.isArray(layer)) {
        for (const it of layer) {
          ids.push(typeof it === "object" && it !== null ? it.id : it);
        }
      }
    }
  } else if (Array.isArray(tileData)) {
    for (const it of tileData) {
      ids.push(typeof it === "object" && it !== null ? it.id : it);
    }
  }

  for (const id of ids) {
    if (!id) continue;
    const meta = nexoData[String(id)];
    if (!meta) continue;
    const game = meta.game ?? {};
    const raw  = meta.flags_raw ?? {};

    // Ground tile sólido → limita visão (teto opaco)
    const bank  = game.bank  ?? raw.bank;
    const rl    = game.render_layer ?? game.layer;
    if (bank || rl === 0) return true;

    // Bottom item que bloqueia projéteis → limita visão (parede opaca)
    const bottom   = game.bottom ?? raw.bottom;
    const unsight  = game.unsight ?? raw.unsight ?? game.blocks_sight ?? game.blocks_missiles;
    if (bottom && unsight) return true;
  }

  return false;
}
