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

export function pickTopVisibleTileAtScreen({
  worldState,
  px,
  py,
  tileSize = 32,
}) {
  const zoom = worldState.zoom ?? 1;
  const tsize = tileSize * zoom;
  const activeZ = Number(worldState.activeZ ?? 7);
  const visibleFloors = getVisibleFloors(activeZ);

  // Último floor desenhado deve ter prioridade no picking.
  const pickOrder = [...visibleFloors].reverse();

  for (const z of pickOrder) {
    const floorOffsetSqm = Math.max(0, activeZ - z);
    const tileX = Math.floor(worldState.camera.x + px / tsize + floorOffsetSqm);
    const tileY = Math.floor(worldState.camera.y + py / tsize + floorOffsetSqm);
    const key = `${tileX},${tileY},${z}`;
    const tile = worldState.map?.[key];
    if (!_hasRenderableContent(tile)) continue;

    return {
      tileX,
      tileY,
      tileZ: z,
      key,
      tile,
    };
  }

  const fallbackX = Math.floor(worldState.camera.x + px / tsize);
  const fallbackY = Math.floor(worldState.camera.y + py / tsize);
  return {
    tileX: fallbackX,
    tileY: fallbackY,
    tileZ: activeZ,
    key: `${fallbackX},${fallbackY},${activeZ}`,
    tile: null,
  };
}
