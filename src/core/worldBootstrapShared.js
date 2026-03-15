import { dbGet, PATHS } from "./db.js";
import { MapChunkSubscriber } from "./MapChunkSubscriber.js";
import { getVisibleFloors } from "./floorVisibility.js";
import { loadAllSprites } from "../render/assetLoader.js";

export async function loadFirebaseTilesData() {
  const remoteTilesData = await dbGet(PATHS.tilesData);
  if (!remoteTilesData || typeof remoteTilesData !== "object") {
    throw new Error("tilesData indisponivel no Firebase");
  }
  return remoteTilesData;
}

export async function ensureWorldTilesAvailable() {
  const existingChunks = await dbGet(PATHS.tiles);
  if (
    !existingChunks ||
    typeof existingChunks !== "object" ||
    Object.keys(existingChunks).length === 0
  ) {
    throw new Error("world_tiles indisponivel no Firebase");
  }
  return existingChunks;
}

export function createFirebaseChunkSubscriber({
  spawn,
  cols,
  rows,
  onFloorIndexUpdate,
}) {
  const spawnX = Number(spawn?.x ?? 100);
  const spawnY = Number(spawn?.y ?? 100);
  const spawnZ = Number(spawn?.z ?? 7);

  const subscriber = new MapChunkSubscriber({ onFloorIndexUpdate });
  const floors = getVisibleFloors(spawnZ);
  subscriber.update(spawnX, spawnY, floors, cols, rows);

  return {
    subscriber,
    map: subscriber.map,
    spawnX,
    spawnY,
    spawnZ,
  };
}

export function updateChunkSubscriberForObserver({
  subscriber,
  x,
  y,
  z,
  cols,
  rows,
}) {
  if (!subscriber) return;
  const floors = getVisibleFloors(z);
  subscriber.update(x, y, floors, cols, rows);
}

export function createChunkUpdateTracker() {
  let lastX = -Infinity;
  let lastY = -Infinity;
  let lastZ = -Infinity;

  return {
    needsCameraUpdate({ x, y, z, chunkSize }) {
      const threshold = Math.max(1, Number(chunkSize ?? 16) / 2);
      if (
        Math.abs(Number(x) - lastX) >= threshold ||
        Math.abs(Number(y) - lastY) >= threshold ||
        Number(z) !== lastZ
      ) {
        lastX = Number(x);
        lastY = Number(y);
        lastZ = Number(z);
        return true;
      }
      return false;
    },

    needsTileUpdate({ x, y, z }) {
      const tx = Math.round(Number(x));
      const ty = Math.round(Number(y));
      const tz = Number(z);

      if (tx !== lastX || ty !== lastY || tz !== lastZ) {
        lastX = tx;
        lastY = ty;
        lastZ = tz;
        return true;
      }
      return false;
    },
  };
}

export async function loadSharedRenderAssets({
  assets,
  mapData,
  basePath = "./assets/",
}) {
  const atlasLoaded = await assets.loadMapAssets?.(basePath, {
    mapData,
    useMapDataVariantCoords: false,
  });
  if (!atlasLoaded) {
    throw new Error("Falha ao carregar atlas de mapa");
  }

  const totalPacks = await loadAllSprites(assets, basePath);

  return {
    atlasCount: assets.mapAtlases?.length ?? 0,
    totalPacks,
  };
}
