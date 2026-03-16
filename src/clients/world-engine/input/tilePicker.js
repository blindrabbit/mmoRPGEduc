// ═══════════════════════════════════════════════════════════════
// tilePicker.js — Conversão screen → tile com isolamento por floor
//
// Clique normal  : retorna tile do floor ativo mais próximo
// Ctrl+Click     : usa `forceFloor` — busca apenas no floor especificado
// ═══════════════════════════════════════════════════════════════
import { getVisibleFloors } from "../../../core/floorVisibility.js";

function _hasRenderableContent(tile) {
  if (!tile) return false;
  if (Array.isArray(tile)) return tile.length > 0;
  if (tile && typeof tile === "object") {
    if (Array.isArray(tile.items)) return tile.items.length > 0;
    for (const value of Object.values(tile)) {
      if (Array.isArray(value) && value.length > 0) return true;
    }
    return Object.keys(tile).length > 0;
  }
  return false;
}

/**
 * Converte coordenadas de screen (px, py) no tile do mundo visível.
 *
 * @param {Object}  opts
 * @param {Object}  opts.worldState          - estado global do jogo
 * @param {number}  opts.px                  - X em pixels no canvas
 * @param {number}  opts.py                  - Y em pixels no canvas
 * @param {number}  [opts.tileSize=32]
 * @param {number|null} [opts.forceFloor]    - quando não-null, ignora todos os outros floors
 *                                             e retorna o tile exato neste Z (Ctrl+Click)
 * @returns {{ tileX, tileY, tileZ, key, tile, items, floorZ } | null}
 */
export function pickTopVisibleTileAtScreen({
  worldState,
  px,
  py,
  tileSize = 32,
  forceFloor = null,
}) {
  const zoom   = worldState.zoom ?? 1;
  const tsize  = tileSize * zoom;
  const activeZ = Number(worldState.activeZ ?? 7);

  // ── Modo forceFloor (Ctrl+Click): busca apenas no floor especificado ──
  if (forceFloor !== null && Number.isFinite(Number(forceFloor))) {
    const z = Math.floor(Number(forceFloor));
    const floorOffsetSqm = activeZ - z; // assinado: positivo=acima, negativo=abaixo
    const tileX = Math.floor(worldState.camera.x + px / tsize + floorOffsetSqm);
    const tileY = Math.floor(worldState.camera.y + py / tsize + floorOffsetSqm);
    const key   = `${tileX},${tileY},${z}`;
    const tile  = worldState.map?.[key] ?? null;
    return {
      tileX,
      tileY,
      tileZ: z,
      floorZ: z,                // ⚠️ floor REAL do tile
      key,
      tile,
      items: _extractItems(tile),
    };
  }

  // ── Modo normal: busca reversa (último desenhado = topo visual) ──
  const visibleFloors = getVisibleFloors(activeZ);
  // Último floor desenhado deve ter prioridade no picking.
  const pickOrder = [...visibleFloors].reverse();

  for (const z of pickOrder) {
    const floorOffsetSqm = activeZ - z; // assinado: positivo=acima, negativo=abaixo
    const tileX = Math.floor(worldState.camera.x + px / tsize + floorOffsetSqm);
    const tileY = Math.floor(worldState.camera.y + py / tsize + floorOffsetSqm);
    const key   = `${tileX},${tileY},${z}`;
    const tile  = worldState.map?.[key];
    if (!_hasRenderableContent(tile)) continue;

    return {
      tileX,
      tileY,
      tileZ: z,
      floorZ: z,                // ⚠️ CRUCIAL: floor REAL do tile
      key,
      tile,
      items: _extractItems(tile),
    };
  }

  // Fallback: floor ativo, sem conteúdo
  const fallbackX = Math.floor(worldState.camera.x + px / tsize);
  const fallbackY = Math.floor(worldState.camera.y + py / tsize);
  return {
    tileX:  fallbackX,
    tileY:  fallbackY,
    tileZ:  activeZ,
    floorZ: activeZ,
    key:    `${fallbackX},${fallbackY},${activeZ}`,
    tile:   null,
    items:  [],
  };
}

/** Extrai array plano de itens de qualquer estrutura de tile. */
function _extractItems(tile) {
  if (!tile) return [];
  if (Array.isArray(tile)) return [...tile];
  if (Array.isArray(tile.items)) return [...tile.items];
  if (typeof tile === "object") {
    const out = [];
    for (const val of Object.values(tile)) {
      if (Array.isArray(val)) out.push(...val);
    }
    return out;
  }
  return [];
}
