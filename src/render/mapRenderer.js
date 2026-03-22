// ═══════════════════════════════════════════════════════════════
// mapRenderer.js — Módulo de renderização de mapa (v4.0 OTClient Compatible)
// ✅ Implementação fiel das regras do OTClient (opentibiabr/otclient)
// ✅ Dois passes de renderização: drawGround() + draw()
// ✅ Classificação por flags: bank, clip, bottom, top
// ✅ Posicionamento bottom-right anchor com shift
// ✅ Sistema de elevation acumulativo
// ✅ Suporte a ASSETS_NOVO (metadata Python)
// ═══════════════════════════════════════════════════════════════
import { TILE_SIZE, GROUND_Z, WORLD_ENGINE } from "../core/config.js";
import { resolveStackPosition } from "../core/stackPosition.js";
import { AtlasBatchRenderer } from "./batchRenderer.js";
import { getVisibleFloors } from "../core/floorVisibility.js";

// ═══════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════
const USE_NEW_ASSETS = true; // true = ASSETS_NOVO, false = ASSETS (legado)
const MAX_DRAW_ELEVATION = 16; // Limite máximo de elevation (OTClient)

function _boundedMap(maxSize = 2000) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      if (m.size >= maxSize) m.delete(m.keys().next().value);
      m.set(k, v);
    },
    has: (k) => m.has(k),
    delete: (k) => m.delete(k),
    clear: () => m.clear(),
    get size() { return m.size; },
  };
}

const _variantCache = _boundedMap(5000);
const _sortedKeysCache = _boundedMap(3000);
let _floorAlphaCache = null;
let _floorAlphaCacheKey = "";
const _spriteCategoryCache = _boundedMap(2000); // spriteId -> { meta, category }
const _spriteElevationCache = _boundedMap(2000); // spriteId -> { meta, elevation }
const _anyVariantLookupCache = _boundedMap(2000); // spriteId -> lookup|null

function _flattenTileItems(tileLayers, layerKeys) {
  const keys =
    layerKeys ??
    Object.keys(tileLayers)
      .map((k) => parseInt(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

  const out = [];
  for (const layer of keys) {
    const arr = tileLayers[String(layer)];
    if (Array.isArray(arr) && arr.length) out.push(...arr);
  }
  return out;
}

function _flattenTileEntries(tileLayers, layerKeys) {
  const keys =
    layerKeys ??
    Object.keys(tileLayers)
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

  const out = [];
  for (const layer of keys) {
    const arr = tileLayers[String(layer)];
    if (!Array.isArray(arr) || !arr.length) continue;
    for (const item of arr) {
      out.push({ tileLayer: layer, item });
    }
  }
  return out;
}

function _resolveRenderLayer(metadata, category = "common") {
  // New format: game.layer; old format fallback: game.render_layer
  const rawLayer = Number(metadata?.game?.layer ?? metadata?.game?.render_layer);
  if (Number.isFinite(rawLayer)) {
    return Math.max(0, Math.min(3, Math.floor(rawLayer)));
  }

  if (category === "ground") return 0;
  if (category === "groundBorder") return 1;
  if (category === "top") return 3;
  return 2;
}

function _getSpriteCategory(spriteId, nexoData) {
  const sid = String(spriteId);
  const spriteMeta = nexoData?.[sid];
  if (!spriteMeta) return "common";

  const cached = _spriteCategoryCache.get(sid);
  if (cached?.meta === spriteMeta) return cached.category;

  const category = classifyItemOT(spriteMeta);
  _spriteCategoryCache.set(sid, { meta: spriteMeta, category });
  return category;
}

function _getSpriteElevation(spriteId, nexoData) {
  const sid = String(spriteId);
  const spriteMeta = nexoData?.[sid];
  if (!spriteMeta) return 0;

  const cached = _spriteElevationCache.get(sid);
  if (cached?.meta === spriteMeta) return cached.elevation;

  const elevation = spriteMeta?.game?.height_elevation ?? 0;
  _spriteElevationCache.set(sid, { meta: spriteMeta, elevation });
  return elevation;
}

// ═══════════════════════════════════════════════════════════════
// SETUP DE CANVAS
// ═══════════════════════════════════════════════════════════════
export function setupCanvas(canvas, cols, rows) {
  canvas.width = cols * TILE_SIZE;
  canvas.height = rows * TILE_SIZE;
  return { canvasW: canvas.width, canvasH: canvas.height, cols, rows };
}

// ═══════════════════════════════════════════════════════════════
// CÂMERA
// ═══════════════════════════════════════════════════════════════
export function centerCamera(worldPos, cols, rows) {
  return {
    x: worldPos.x - Math.floor(cols / 2),
    y: worldPos.y - Math.floor(rows / 2),
  };
}

export function screenToTile(px, py, camera, zoom = 1) {
  return {
    tx: Math.floor(px / TILE_SIZE / zoom + camera.x),
    ty: Math.floor(py / TILE_SIZE / zoom + camera.y),
  };
}

// ═══════════════════════════════════════════════════════════════
// ÍNDICE POR FLOOR
// ═══════════════════════════════════════════════════════════════
export function buildFloorIndex(map) {
  const index = new Map();
  for (const [key, value] of Object.entries(map)) {
    const parts = key.split(",");
    const tx = parseInt(parts[0]);
    const ty = parseInt(parts[1]);
    const z = parseInt(parts[2]);
    let tileRecord;

    if (Array.isArray(value)) {
      tileRecord = { tx, ty, items: value, flatItems: value };
    } else if (value && typeof value === "object") {
      if (Array.isArray(value.items)) {
        tileRecord = { tx, ty, items: value.items, flatItems: value.items };
      } else {
        const layerKeys = Object.keys(value)
          .map((k) => parseInt(k))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        tileRecord = {
          tx,
          ty,
          layers: value,
          layerKeys,
          flatItems: _flattenTileItems(value, layerKeys),
        };
      }
    } else {
      tileRecord = { tx, ty, items: [], flatItems: [] };
    }

    if (!index.has(z)) index.set(z, new Map());
    index.get(z).set(key, tileRecord);
  }
  return index;
}

export function getTileDrawElevation({
  map = null,
  floorIndex = null,
  nexoData = null,
  assets = null,
  x,
  y,
  z,
}) {
  const tx = Number.isFinite(Number(x)) ? Math.floor(Number(x)) : null;
  const ty = Number.isFinite(Number(y)) ? Math.floor(Number(y)) : null;
  const tz = Number.isFinite(Number(z)) ? Math.floor(Number(z)) : null;
  if (tx == null || ty == null || tz == null) return 0;

  const metaIndex = nexoData ?? assets?.mapData ?? null;
  if (!metaIndex || typeof metaIndex !== "object") return 0;

  let items = null;
  const coord = `${tx},${ty},${tz}`;
  const fromIndex = floorIndex?.get?.(tz)?.get?.(coord);

  if (fromIndex) {
    items =
      fromIndex.flatItems ??
      (fromIndex.layers
        ? _flattenTileItems(fromIndex.layers, fromIndex.layerKeys)
        : (fromIndex.items ?? []));
  } else {
    const tileValue = map?.[coord];
    if (!tileValue) return 0;
    if (Array.isArray(tileValue)) {
      items = tileValue;
    } else if (Array.isArray(tileValue?.items)) {
      items = tileValue.items;
    } else if (tileValue && typeof tileValue === "object") {
      const layerKeys = Object.keys(tileValue)
        .map((k) => parseInt(k, 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      items = _flattenTileItems(tileValue, layerKeys);
    }
  }

  if (!Array.isArray(items) || items.length === 0) return 0;

  let elevation = 0;
  for (const item of items) {
    const spriteId = typeof item === "object" && item !== null ? item.id : item;
    if (spriteId == null || spriteId === 0) continue;

    const spriteMeta = metaIndex[String(spriteId)];
    const category = classifyItemOT(spriteMeta);
    if (
      category === "ground" ||
      category === "groundBorder" ||
      category === "top"
    ) {
      continue;
    }

    const elev = _getSpriteElevation(spriteId, metaIndex);
    elevation = Math.min(elevation + elev, MAX_DRAW_ELEVATION);
  }

  return elevation;
}

// ═══════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DE ITEMS (OTClient ThingAttr)
// ═══════════════════════════════════════════════════════════════
/**
 * Classifica item conforme flags do OTClient
 * Referência: thingtype.h - enum ThingAttr
 */
function classifyItemOT(metadata) {
  if (!metadata) return "common";

  const game = metadata.game || {};
  const raw = metadata.flags_raw || {};

  // ✅ Novo formato: flags planos em game (sem nested flags.movement/visual)
  // Fallback: flags_raw (formato legado do protobuf)
  const bank      = game.bank      ?? raw.bank;
  const clip      = game.clip      ?? raw.clip;
  const bottom    = game.bottom    ?? raw.bottom;
  const top       = game.top       ?? raw.top;
  const topeffect = game.topeffect ?? raw.topeffect;

  // ThingFlagAttrGround — bank (waypoints > 0) ou layer 0
  // Paredes com bank (ex: 1128) → bottom, não ground
  if (bank || (game.layer ?? game.render_layer) === 0) {
    if (game.category_type === "wall") return "bottom";
    return "ground";
  }

  // ThingFlagAttrGroundBorder — clip sem bottom
  if (clip && !bottom) return "groundBorder";

  // ThingFlagAttrOnBottom — bottom flag
  if (bottom) return "bottom";

  // ThingFlagAttrOnTop — top ou topeffect flag
  if (top || topeffect) return "top";

  // Default: common item
  return "common";
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function _tileHasAnySprites(tileValue) {
  if (!tileValue) return false;
  if (Array.isArray(tileValue)) return tileValue.length > 0;
  if (tileValue && typeof tileValue === "object") {
    if (Array.isArray(tileValue.items)) return tileValue.items.length > 0;
    for (const arr of Object.values(tileValue)) {
      if (Array.isArray(arr) && arr.length > 0) return true;
    }
  }
  return false;
}

function _indexTileHasAnySprites(tileRecord) {
  if (!tileRecord) return false;
  if (Array.isArray(tileRecord.flatItems))
    return tileRecord.flatItems.length > 0;
  if (Array.isArray(tileRecord.items)) return tileRecord.items.length > 0;
  if (tileRecord.layers) {
    for (const layer of tileRecord.layerKeys ??
      Object.keys(tileRecord.layers)) {
      const arr = tileRecord.layers[String(layer)];
      if (Array.isArray(arr) && arr.length > 0) return true;
    }
  }
  return false;
}

function _getIsoOffsetSqm(z, activeZ) {
  const baseZ = Number.isFinite(Number(activeZ))
    ? Math.floor(Number(activeZ))
    : GROUND_Z;
  // Offset isométrico ASSINADO: activeZ - z
  //   z < activeZ (andares acima)  → positivo → desloca UP-LEFT  (floorOffset negativo em px)
  //   z = activeZ (andar ativo)    → 0        → sem deslocamento
  //   z > activeZ (andares abaixo) → negativo → desloca DOWN-RIGHT (floorOffset positivo em px)
  // Exemplos com activeZ=6:
  //   z=5 → +1 SQM UP-LEFT  |  z=6 → 0  |  z=7 → -1 SQM → floorOffset=+32px (DOWN-RIGHT)
  return baseZ - z;
}

function _createUpperLayerOcclusionChecker({
  floorIndex,
  visibleFloors,
  activeZ,
  nexoData,
  layerMin,
  layerMax,
  zPredicate,
  spritePredicate,
  pass,
}) {
  const cache = new Map();

  return function isOccludedByUpperFloor({
    projectedX,
    projectedY,
    currentZ,
    renderLayer,
  }) {
    if (!floorIndex || !Number.isFinite(Number(renderLayer))) return false;

    const key = `${pass}|${currentZ}|${renderLayer}|${projectedX},${projectedY}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    for (const upperZ of visibleFloors) {
      if (upperZ >= currentZ) continue;

      const dz = upperZ - activeZ;
      if (
        typeof zPredicate === "function" &&
        !zPredicate(upperZ, dz, activeZ)
      ) {
        continue;
      }

      const upperOffsetSqm = _getIsoOffsetSqm(upperZ, activeZ);
      const tx = projectedX + upperOffsetSqm;
      const ty = projectedY + upperOffsetSqm;
      const tile = floorIndex.get(upperZ)?.get(`${tx},${ty},${upperZ}`);
      if (!_indexTileHasAnySprites(tile)) continue;

      const tileEntries = tile.layers
        ? _flattenTileEntries(tile.layers, tile.layerKeys)
        : (tile.flatItems ?? tile.items ?? []).map((item) => ({
            tileLayer: null,
            item,
          }));

      for (const entry of tileEntries) {
        const item = entry.item;
        const spriteId =
          typeof item === "object" && item !== null ? item.id : item;
        if (spriteId == null || spriteId === 0) continue;

        const spriteMeta = nexoData?.[String(spriteId)];
        const category = _getSpriteCategory(spriteId, nexoData);
        const itemLayer = _resolveRenderLayer(spriteMeta, category);

        if (itemLayer < layerMin || itemLayer > layerMax) continue;
        if (itemLayer !== renderLayer) continue;

        if (pass === "ground") {
          if (category !== "ground" && category !== "groundBorder") continue;
        } else if (category === "ground" || category === "groundBorder") {
          continue;
        }

        const info = {
          spriteId,
          spriteMeta,
          category,
          stackPosition: resolveStackPosition(spriteMeta, category),
          renderLayer: itemLayer,
          tileLayer: Number.isFinite(Number(entry?.tileLayer))
            ? Number(entry.tileLayer)
            : -1,
          count:
            typeof item === "object" && item !== null ? (item.count ?? 1) : 1,
          tx,
          ty,
          z: upperZ,
          dz,
          activeZ,
        };

        if (
          typeof spritePredicate === "function" &&
          spritePredicate(spriteId, spriteMeta, info) === false
        ) {
          continue;
        }

        cache.set(key, true);
        return true;
      }
    }

    cache.set(key, false);
    return false;
  };
}

// ═══════════════════════════════════════════════════════════════
// CÁLCULO DE POSIÇÃO (OTClient thingtype.cpp)
// ═══════════════════════════════════════════════════════════════
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FÓRMULA FINAL — NÃO ALTERAR                                 ║
 * ║  Validada visualmente em 08/03/2026 — todos os sprites       ║
 * ║  do mapa alinhados: grounds, borders, multi-tile, elevação   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Âncora BOTTOM-RIGHT para sprites multi-tile (w ou h > 32):
 *   sizeW = ceil(sprite.w / 32)  → quantos tiles horizontais o sprite ocupa
 *   sizeH = ceil(sprite.h / 32)  → quantos tiles verticais
 *   drawX = screenX - (sizeW-1)*32 + bbox.x - shift.x - elevation
 *   drawY = screenY - (sizeH-1)*32 + bbox.y - shift.y - elevation
 *
 * Sprites < 32px usam bbox.x/y para posicionamento DENTRO do tile:
 *   - borda topo (32×8, bbox @0,0)   → drawY = sy (topo do tile)
 *   - borda base (32×9, bbox @0,23)  → drawY = sy+23 (base do tile)
 *   - borda esq  (8×32, bbox @0,0)   → drawX = sx (esquerda do tile)
 *   - borda dir  (9×32, bbox @23,0)  → drawX = sx+23 (direita do tile)
 *
 * Elevation desloca em AMBOS os eixos (stacking isométrico OTClient).
 * Usa dimensões REAIS do atlas (w/h) para o tile-span, NÃO o bbox.width/height.
 */
function calculateSpritePosition(
  tileScreenX,
  tileScreenY,
  spriteInfo,
  metadata,
  elevation = 0,
) {
  const _bb = metadata?.bounding_box;
  const bbox = (Array.isArray(_bb) ? _bb[0] : _bb) || { x: 0, y: 0 };
  // ✅ Novo: game.shift (plano); Fallback: flags_raw.shift (legado)
  const shift = metadata?.game?.shift || metadata?.flags_raw?.shift || { x: 0, y: 0 };

  // Quantos tiles de 32px o sprite ocupa (dimensões REAIS do atlas)
  const sizeW = Math.ceil(spriteInfo.w / 32);
  const sizeH = Math.ceil(spriteInfo.h / 32);

  // Offset multi-tile (âncora bottom-right) + offset dentro do tile (bbox.x/y)
  // Elevation em X e Y para stacking isométrico (itens elevados sobem e vão para esquerda)
  const drawX =
    tileScreenX - (sizeW - 1) * 32 + (bbox.x || 0) - (shift.x || 0) - elevation;
  const drawY =
    tileScreenY - (sizeH - 1) * 32 + (bbox.y || 0) - (shift.y || 0) - elevation;

  return { x: drawX, y: drawY };
}

// ═══════════════════════════════════════════════════════════════
// HASH E VARIAÇÃO
// ═══════════════════════════════════════════════════════════════
function tileHash(tx, ty, spriteId) {
  let h = (tx * 73856093) ^ (ty * 19349663) ^ (spriteId * 83492791);
  h = (((h >>> 16) ^ h) * 0x45d9f3b) | 0;
  h = (((h >>> 16) ^ h) * 0x45d9f3b) | 0;
  h = (h >>> 16) ^ h;
  return Math.abs(h);
}

export function getVariationIndex(tx, ty, spriteId, numVariacoes) {
  if (numVariacoes <= 1) return 0;
  const key = `${tx},${ty},${spriteId}`;
  if (!_variantCache.has(key)) {
    _variantCache.set(key, tileHash(tx, ty, spriteId) % numVariacoes);
  }
  return _variantCache.get(key);
}

// ═══════════════════════════════════════════════════════════════
// ANIMAÇÃO
// ═══════════════════════════════════════════════════════════════
export function getAnimFrameIndex(spriteData, animClock) {
  const anim = spriteData.animation;
  if (!anim) return 0;

  let durations;
  if (Array.isArray(anim.durations) && anim.durations.length) {
    durations = anim.durations;
  } else if (Array.isArray(anim.phases) && anim.phases.length) {
    durations = anim.phases.map((p) => p.d || 200);
  } else {
    return 0;
  }

  const totalMs = durations.reduce((s, d) => s + d, 0);
  const clock = animClock % totalMs;
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    acc += durations[i];
    if (clock < acc) return i;
  }
  return durations.length - 1;
}

/**
 * Retorna o frame de animação para sprites com pattern W×H > 1.
 * Quando o exporter declara total_frames > numFrames reais (ex: 14 frames
 * declarados mas apenas 4 frames × 3 rows = 12 variants), truncamos o
 * durations para numFrames a fim de que cada frame visual dure exatamente
 * o tempo declarado — sem o ciclo inflado por total_frames extras.
 */
function _getPatternAnimFrame(spriteData, effectiveClock, numFrames) {
  if (!spriteData.is_animated) return 0;
  const anim = spriteData.animation;
  const rawDurations =
    Array.isArray(anim?.durations) && anim.durations.length
      ? anim.durations
      : Array.isArray(anim?.phases) && anim.phases.length
        ? anim.phases.map((p) => p.d || 200)
        : null;
  if (!rawDurations) return 0;
  // Se total_frames > numFrames, usa apenas os primeiros numFrames durations
  const durations =
    numFrames < rawDurations.length
      ? rawDurations.slice(0, numFrames)
      : rawDurations;
  const totalMs = durations.reduce((s, d) => s + d, 0);
  const clock = effectiveClock % totalMs;
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    acc += durations[i];
    if (clock < acc) return i;
  }
  return durations.length - 1;
}

// ═══════════════════════════════════════════════════════════════
// RESOLUÇÃO DE VARIANT (OTClient thingtype.cpp)
// ═══════════════════════════════════════════════════════════════
/** Retorna a CHAVE string da variante selecionada */
function resolveVariantKey(spriteData, tx, ty, animClock) {
  let sortedKeys = _sortedKeysCache.get(spriteData.id);
  if (!sortedKeys) {
    // Sort by physical atlas position (y row first, then x column).
    // This is required because the Python exporter stores keys 10–13 before
    // keys 1–9 in the atlas strip — numeric sort would produce wrong frame order.
    sortedKeys = Object.keys(spriteData.variants)
      .map(Number)
      .sort((a, b) => {
        const va = spriteData.variants[String(a)];
        const vb = spriteData.variants[String(b)];
        if (va.y !== vb.y) return va.y - vb.y;
        return va.x - vb.x;
      });
    _sortedKeysCache.set(spriteData.id, sortedKeys);
  }

  const total = sortedKeys.length;
  if (total === 0) return "0";

  // Para itens não-sincronizados: cada tile usa um offset de fase diferente
  let effectiveClock = animClock;
  if (spriteData.is_animated && spriteData.animation?.synchronized === false) {
    const anim = spriteData.animation;
    const totalMs =
      Array.isArray(anim.durations) && anim.durations.length
        ? anim.durations.reduce((s, d) => s + d, 0)
        : (anim.total_frames ?? 1) * 200;
    effectiveClock = animClock + (tileHash(tx, ty, 0) % totalMs);
  }

  const W = spriteData.pattern?.width ?? 1;
  const H = spriteData.pattern?.height ?? 1;

  if (W === 1 && H === 1) {
    const frame = spriteData.is_animated
      ? getAnimFrameIndex(spriteData, effectiveClock) % total
      : 0;
    return String(sortedKeys[frame]);
  }

  // Posição modulo (OTClient spec): variante determinada pela posição do tile no grid
  // Garante que tiles adjacentes do mesmo tipo encaixem corretamente
  const numVar = W * H;
  const numFrames = Math.max(1, Math.floor(total / numVar));
  const base = (ty % H) * W + (tx % W);
  const frame = _getPatternAnimFrame(spriteData, effectiveClock, numFrames);
  return String(sortedKeys[Math.min(base + frame * numVar, total - 1)]);
}

export function resolveVariant(spriteData, tx, ty, animClock) {
  let sortedKeys = _sortedKeysCache.get(spriteData.id);
  if (!sortedKeys) {
    sortedKeys = Object.keys(spriteData.variants)
      .map(Number)
      .sort((a, b) => {
        const va = spriteData.variants[String(a)];
        const vb = spriteData.variants[String(b)];
        if (va.y !== vb.y) return va.y - vb.y;
        return va.x - vb.x;
      });
    _sortedKeysCache.set(spriteData.id, sortedKeys);
  }

  const total = sortedKeys.length;

  // Para itens não-sincronizados: cada tile usa um offset de fase diferente
  let effectiveClock = animClock;
  if (spriteData.is_animated && spriteData.animation?.synchronized === false) {
    const anim = spriteData.animation;
    const totalMs =
      Array.isArray(anim.durations) && anim.durations.length
        ? anim.durations.reduce((s, d) => s + d, 0)
        : (anim.total_frames ?? 1) * 200;
    effectiveClock = animClock + (tileHash(tx, ty, 0) % totalMs);
  }

  const W = spriteData.pattern?.width ?? 1;
  const H = spriteData.pattern?.height ?? 1;

  if (W === 1 && H === 1) {
    const animFrame = spriteData.is_animated
      ? getAnimFrameIndex(spriteData, effectiveClock) % total
      : 0;
    return spriteData.variants[String(sortedKeys[animFrame])];
  }

  // Posição modulo (OTClient spec)
  const numVariacoes = W * H;
  const numFrames = Math.max(1, Math.floor(total / numVariacoes));
  const tipoBase = (ty % H) * W + (tx % W);
  const animFrame = _getPatternAnimFrame(spriteData, effectiveClock, numFrames);
  const variantIdx = tipoBase + animFrame * numVariacoes;
  const clampedIdx = Math.min(variantIdx, total - 1);
  return spriteData.variants[String(sortedKeys[clampedIdx])];
}

// ═══════════════════════════════════════════════════════════════
// VARIANTE PARA STACKABLES (OTClient spec)
// ═══════════════════════════════════════════════════════════════
/**
 * Retorna a chave de variante para liquid containers baseada no content_type.
 * Mapeamento Tibia: empty→0, water→1, blood→2, beer→3, slime→4,
 *   lemonade→5, milk→6, mana→7, lifefluid→8, urine→9, rum→10, fruitjuice→11
 */
const LIQUID_TYPE_VARIANT = {
  empty: "0",
  water: "1",
  blood: "2",
  beer: "3",
  slime: "4",
  lemonade: "5",
  milk: "6",
  mana: "7",
  lifefluid: "8",
  urine: "9",
  rum: "10",
  fruitjuice: "11",
};
export function getLiquidVariantKey(contentType) {
  return LIQUID_TYPE_VARIANT[contentType] ?? "0";
}

/**
 * Retorna a chave de variante para itens stackables baseada na quantidade.
 * Mapeamento: 0→0  1→1  2→2  3→3  4-9→4  10-24→5  25-49→6  50+→7
 */
function getStackableVariantKey(count) {
  if (!count || count <= 1) return "0";
  if (count === 2) return "1";
  if (count === 3) return "2";
  if (count <= 9) return "3";
  if (count <= 24) return "4";
  if (count <= 49) return "5";
  if (count <= 99) return "6";
  return "7";
}

// ═══════════════════════════════════════════════════════════════
// DRAW SPRITE (com posicionamento OTClient)
// ═══════════════════════════════════════════════════════════════
/**
 * Desenha sprite usando o multi-atlas do AssetManager.
 * Animação: cada frame é uma entrada separada em data.variants —
 * resolveVariantKey já retorna a chave correta para o frame atual.
 *
 * @param {number} elevation - elevação acumulada do tile (para bottom/common)
 * @param {number} count     - quantidade do item (para stackables)
 */
function _drawSpriteFromAssets(
  ctx,
  assets,
  nexoData,
  spriteId,
  sx,
  sy,
  tx,
  ty,
  animClock,
  alpha,
  elevation = 0,
  count = 1,
  batchRenderer = null,
  contentType = null,
) {
  const sid = String(spriteId);
  const data = nexoData?.[sid] ?? null;

  // Stackables usam variante por quantidade; liquid containers por content_type; demais por posição modulo
  let varKey;
  if (data?.game?.is_stackable) {
    varKey = getStackableVariantKey(count);
  } else if (data?.game?.is_liquid_container) {
    // Liquid containers SEMPRE usam content_type para variante
    // Se content_type for null/undefined/"", usa "0" (empty)
    const liquidType = contentType ?? "empty";
    varKey = getLiquidVariantKey(liquidType);
  } else {
    varKey = resolveVariantKey(data, tx, ty, animClock);
  }

  let lookup =
    assets.mapAtlasLookup?.get(`${sid}_${varKey}`) ??
    assets.mapAtlasLookup?.get(`${sid}_0`);

  // Se metadata do Firebase estiver incompleta para um item/variant,
  // procura qualquer variante disponível no atlas local para evitar "buracos".
  if (!lookup && assets.mapAtlasLookup) {
    const cached = _anyVariantLookupCache.get(sid);
    if (cached !== undefined) {
      lookup = cached || null;
    } else {
      let found = null;
      for (const [key, value] of assets.mapAtlasLookup.entries()) {
        if (key.startsWith(`${sid}_`)) {
          found = value;
          break;
        }
      }
      _anyVariantLookupCache.set(sid, found || null);
      lookup = found;
    }
  }

  if (!lookup) return;

  // Usa mapAtlasesById (Map<atlas_index, atlas>) para lookup robusto
  const atlasEntry =
    assets.mapAtlasesById?.get(lookup.atlasIndex) ??
    assets.mapAtlases?.[lookup.atlasIndex];
  const atlasImage = atlasEntry?.image;
  if (!atlasImage) return;

  const { x: ax, y: ay, w, h } = lookup.variant;

  // Calcular posição com bottom-right anchor + elevation
  const pos = calculateSpritePosition(
    sx,
    sy,
    { x: ax, y: ay, w, h },
    data,
    elevation,
  );

  if (batchRenderer) {
    batchRenderer.queue({
      atlasImage,
      sx: ax,
      sy: ay,
      sw: w,
      sh: h,
      dx: pos.x,
      dy: pos.y,
      dw: w,
      dh: h,
      alpha,
    });
    return;
  }

  if (alpha < 1.0) {
    ctx.save();
    ctx.globalAlpha = alpha;
  }
  ctx.drawImage(atlasImage, ax, ay, w, h, pos.x, pos.y, w, h);
  if (alpha < 1.0) ctx.restore();
}

/**
 * Draw sprite legado (fallback)
 * @param {number} elevation - elevação acumulada do tile
 */
export function drawSprite(
  ctx,
  atlas,
  nexoData,
  spriteId,
  sx,
  sy,
  tx,
  ty,
  animClock,
  alpha = 1.0,
  elevation = 0,
) {
  if (spriteId === 0) return;

  const data = nexoData[String(spriteId)];
  if (!data) {
    if (window.DEBUG_MISSING_SPRITES !== true) {
      window.DEBUG_MISSING_SPRITES = true;
      console.warn(
        `[mapRenderer] Sprite ${spriteId} não encontrado em nexoData`,
      );
    }
    return;
  }

  const variant = resolveVariant(data, tx, ty, animClock);
  if (!variant) return;

  const { x: atlasX, y: atlasY, w, h } = variant;

  // Calcular posição com bottom-right anchor + elevation
  const pos = calculateSpritePosition(
    sx,
    sy,
    { x: atlasX, y: atlasY, w, h },
    data,
    elevation,
  );

  if (alpha < 1.0) {
    ctx.save();
    ctx.globalAlpha = alpha;
  }
  ctx.drawImage(atlas, atlasX, atlasY, w, h, pos.x, pos.y, w, h);
  if (alpha < 1.0) ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// ROOF FADE
// ═══════════════════════════════════════════════════════════════
function _floorHasTilesNearPlayer(map, z, camera, activeZ, cols, rows, radius) {
  const cx = Math.floor(camera.x + cols / 2);
  const cy = Math.floor(camera.y + rows / 2);
  const offsetSqm = _getIsoOffsetSqm(z, activeZ);
  const baseX = cx + offsetSqm;
  const baseY = cy + offsetSqm;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tile = map[`${baseX + dx},${baseY + dy},${z}`];
      if (_tileHasAnySprites(tile)) return true;
    }
  }
  return false;
}

function _calcFloorAlphas(
  map,
  camera,
  activeZ,
  cols,
  rows,
  roofFadeRadius,
  visibleFloors,
) {
  const alphas = new Map();
  for (const z of visibleFloors) {
    alphas.set(z, 1.0);
  }

  // Verifica cobertura usando raio estrito (1 tile) para não esconder andares
  // visíveis do lado de fora de construções. O roofFadeRadius controla apenas
  // se o sistema de fade está ativo, mas o raio de detecção é sempre 1.
  const checkRadius = roofFadeRadius > 0 ? 1 : 0;

  let fadeFromZ = null;
  if (roofFadeRadius > 0) {
    for (const z of visibleFloors) {
      if (z >= activeZ) continue;
      if (
        _floorHasTilesNearPlayer(
          map,
          z,
          camera,
          activeZ,
          cols,
          rows,
          checkRadius,
        )
      ) {
        fadeFromZ = z;
        break;
      }
    }
  }

  // Esconde o andar detectado e todos os andares acima dele (z menor),
  // que é o comportamento esperado ao entrar sob cobertura.
  for (const z of visibleFloors) {
    if (z >= activeZ) continue;
    alphas.set(z, fadeFromZ !== null && z <= fadeFromZ ? 0.0 : 1.0);
  }
  return alphas;
}

// ═══════════════════════════════════════════════════════════════
// RENDER DO MAPA (DOIS PASSES - OTClient)
// ═══════════════════════════════════════════════════════════════
/**
 * Renderiza mapa seguindo ordem OTClient (tile.cpp)
 *
export function clearRenderCaches() {
  _variantCache.clear();
  _sortedKeysCache.clear();
  _spriteCategoryCache.clear();
  _spriteElevationCache.clear();
  _anyVariantLookupCache.clear();
}

 * PASSO 1: drawGround() para TODOS os tiles
 *   → Ground + GroundBorder
 *
 * PASSO 2: draw() para TODOS os tiles
 *   → Bottom Items (acumula elevation)
 *   → Common Items (acumula elevation)
 *   → Creatures (usam elevation)
 *   → Effects (usam elevation)
 *   → Top Items (NÃO usam elevation)
 */
export function renderMap(opts) {
  const {
    ctx,
    canvasW,
    canvasH,
    map,
    floorIndex,
    camera,
    activeZ,
    cols = WORLD_ENGINE.canvasCols,
    rows = WORLD_ENGINE.canvasRows,
    roofFadeRadius = 0,
    clearCanvas = true,
    clearColor = "#111", // null = transparente (sem fillRect)
    skipGroundPass = false,
    skipMainPass = false,
    layerMin = 0,
    layerMax = 3,
    zPredicate = null,
    spritePredicate = null,
  } = opts;

  if (clearCanvas) {
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (clearColor) {
      ctx.fillStyle = clearColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    _floorAlphaCache = null;
    _floorAlphaCacheKey = "";
  }

  const alphaKey = `${Math.round(camera.x * 10)},${Math.round(camera.y * 10)},${activeZ},${roofFadeRadius}`;
  const visibleFloors = getVisibleFloors(activeZ);
  if (!_floorAlphaCache || _floorAlphaCacheKey !== alphaKey) {
    _floorAlphaCache = _calcFloorAlphas(
      map,
      camera,
      activeZ,
      cols,
      rows,
      roofFadeRadius,
      visibleFloors,
    );
    _floorAlphaCacheKey = alphaKey;
  }

  const floorAlphas = _floorAlphaCache;
  const groundBatch = opts.groundBatch ?? new AtlasBatchRenderer(ctx);
  const occlusionChecker = _createUpperLayerOcclusionChecker({
    floorIndex,
    visibleFloors,
    activeZ,
    nexoData: opts.nexoData ?? opts.assets?.mapData ?? null,
    layerMin,
    layerMax,
    zPredicate,
    spritePredicate,
    pass: "main",
  });
  const groundOcclusionChecker = _createUpperLayerOcclusionChecker({
    floorIndex,
    visibleFloors,
    activeZ,
    nexoData: opts.nexoData ?? opts.assets?.mapData ?? null,
    layerMin,
    layerMax,
    zPredicate,
    spritePredicate,
    pass: "ground",
  });

  // ═══════════════════════════════════════════════════════════
  // PASSO 1: DRAW GROUND (todos os tiles)
  // ═══════════════════════════════════════════════════════════
  if (!skipGroundPass) {
    for (const z of visibleFloors) {
      const dz = z - activeZ;
      if (typeof zPredicate === "function" && !zPredicate(z, dz, activeZ)) {
        continue;
      }

      _renderGroundPass({
        ...opts,
        z,
        dz,
        alpha: floorAlphas.get(z) ?? 1.0,
        groundBatch,
        layerMin,
        layerMax,
        isOccludedByUpperFloor: groundOcclusionChecker,
      });

      groundBatch.flush();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PASSO 2: DRAW PRINCIPAL (todos os tiles)
  // ═══════════════════════════════════════════════════════════
  if (!skipMainPass) {
    for (const z of visibleFloors) {
      const dz = z - activeZ;
      if (typeof zPredicate === "function" && !zPredicate(z, dz, activeZ)) {
        continue;
      }

      _renderMainPass({
        ...opts,
        z,
        dz,
        alpha: floorAlphas.get(z) ?? 1.0,
        layerMin,
        layerMax,
        isOccludedByUpperFloor: occlusionChecker,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PASSO 1: RENDER GROUND (Ground + GroundBorder)
// ═══════════════════════════════════════════════════════════════
function _renderGroundPass(opts) {
  const {
    ctx,
    atlas,
    nexoData: _nexoDataRaw,
    assets,
    map,
    floorIndex,
    camera,
    z,
    dz,
    activeZ,
    animClock,
    canvasW,
    canvasH,
    cols = WORLD_ENGINE.canvasCols,
    rows = WORLD_ENGINE.canvasRows,
    alpha = 1.0,
    groundBatch = null,
    layerMin = 0,
    layerMax = 3,
    isOccludedByUpperFloor = null,
  } = opts;

  const nexoData = _nexoDataRaw ?? assets?.mapData ?? null;
  const useAssets = !!assets?.mapAtlasLookup && !!nexoData;
  const floorOffsetSqm = _getIsoOffsetSqm(z, activeZ);
  const floorOffset = -floorOffsetSqm * TILE_SIZE;

  if (floorIndex) {
    const tiles = floorIndex.get(z);
    if (!tiles) return;

    const x0 = Math.floor(camera.x) + floorOffsetSqm - 3;
    const y0 = Math.floor(camera.y) + floorOffsetSqm - 3;
    const x1 = x0 + cols + 6;
    const y1 = y0 + rows + 6;

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = tiles.get(`${tx},${ty},${z}`);
        if (!_indexTileHasAnySprites(tile)) continue;

        const sx = Math.floor((tx - camera.x) * TILE_SIZE + floorOffset);
        const sy = Math.floor((ty - camera.y) * TILE_SIZE + floorOffset);

        // Extrair apenas ground e groundBorder
        const tileEntries = tile.layers
          ? _flattenTileEntries(tile.layers, tile.layerKeys)
          : (tile.flatItems ?? tile.items ?? []).map((item) => ({
              tileLayer: null,
              item,
            }));

        for (const entry of tileEntries) {
          const item = entry.item;
          const spriteId =
            typeof item === "object" && item !== null ? item.id : item;
          if (spriteId == null || spriteId === 0) continue;

          const spriteMeta = nexoData?.[String(spriteId)];
          const category = _getSpriteCategory(spriteId, nexoData);
          const renderLayer = _resolveRenderLayer(spriteMeta, category);

          if (renderLayer < layerMin || renderLayer > layerMax) continue;

          // Apenas ground e groundBorder neste passo
          // NUNCA ocluir ground/groundBorder: o algoritmo do pintor já cobre com andares superiores
          if (category !== "ground" && category !== "groundBorder") continue;

          if (useAssets) {
            _drawSpriteFromAssets(
              ctx,
              assets,
              nexoData,
              spriteId,
              sx,
              sy,
              tx,
              ty,
              animClock,
              alpha,
              0,
              1,
              groundBatch,
            );
          } else if (atlas && nexoData) {
            drawSprite(
              ctx,
              atlas,
              nexoData,
              spriteId,
              sx,
              sy,
              tx,
              ty,
              animClock,
              alpha,
              0,
            );
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PASSO 2: RENDER PRINCIPAL (Bottom → Common → Top)
// ═══════════════════════════════════════════════════════════════
function _renderMainPass(opts) {
  const {
    ctx,
    atlas,
    nexoData: _nexoDataRaw,
    assets,
    map,
    floorIndex,
    camera,
    z,
    dz,
    activeZ,
    animClock,
    canvasW,
    canvasH,
    cols = WORLD_ENGINE.canvasCols,
    rows = WORLD_ENGINE.canvasRows,
    alpha = 1.0,
    spritePredicate = null,
    layerMin = 0,
    layerMax = 3,
    isOccludedByUpperFloor = null,
  } = opts;

  const nexoData = _nexoDataRaw ?? assets?.mapData ?? null;
  const useAssets = !!assets?.mapAtlasLookup && !!nexoData;
  const floorOffsetSqm = _getIsoOffsetSqm(z, activeZ);
  const floorOffset = -floorOffsetSqm * TILE_SIZE;

  if (floorIndex) {
    const tiles = floorIndex.get(z);
    if (!tiles) return;

    const x0 = Math.floor(camera.x) + floorOffsetSqm - 3;
    const y0 = Math.floor(camera.y) + floorOffsetSqm - 3;
    const x1 = x0 + cols + 6;
    const y1 = y0 + rows + 6;

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = tiles.get(`${tx},${ty},${z}`);
        if (!_indexTileHasAnySprites(tile)) continue;

        const sx = Math.floor((tx - camera.x) * TILE_SIZE + floorOffset);
        const sy = Math.floor((ty - camera.y) * TILE_SIZE + floorOffset);

        // Separar items por categoria
        const items = {
          bottom: [],
          common: [],
          top: [],
        };

        const tileEntries = tile.layers
          ? _flattenTileEntries(tile.layers, tile.layerKeys)
          : (tile.flatItems ?? tile.items ?? []).map((item) => ({
              tileLayer: null,
              item,
            }));

        const sortable = [];
        for (const entry of tileEntries) {
          const item = entry.item;
          const spriteId =
            typeof item === "object" && item !== null ? item.id : item;
          if (spriteId == null || spriteId === 0) continue;

          const spriteMeta = nexoData?.[String(spriteId)];
          const category = _getSpriteCategory(spriteId, nexoData);
          const renderLayer = _resolveRenderLayer(spriteMeta, category);

          if (renderLayer < layerMin || renderLayer > layerMax) continue;

          const projectedX = tx - floorOffsetSqm;
          const projectedY = ty - floorOffsetSqm;

          // Itens do mundo (layer 99) nunca são ocluídos por andares superiores —
          // são itens soltos no chão e devem aparecer sempre visíveis.
          const entryTileLayer = Number.isFinite(Number(entry?.tileLayer))
            ? Number(entry.tileLayer)
            : -1;
          if (
            entryTileLayer !== 99 &&
            typeof isOccludedByUpperFloor === "function" &&
            isOccludedByUpperFloor({
              projectedX,
              projectedY,
              currentZ: z,
              renderLayer,
            })
          ) {
            continue;
          }

          // Ignorar ground e groundBorder (já renderizados)
          if (category === "ground" || category === "groundBorder") continue;

          // Para liquid containers, converter count → content_type se necessário
          let itemCount =
            typeof item === "object" && item !== null ? (item.count ?? 1) : 1;
          let itemContentType =
            typeof item === "object" && item !== null
              ? (item.content_type ?? null)
              : null;

          // Se não tem content_type mas é liquid container, usa count como índice do líquido
          if (!itemContentType && spriteMeta?.game?.is_liquid_container) {
            const LIQUID_TYPES = [
              "empty",
              "water",
              "blood",
              "beer",
              "slime",
              "lemonade",
              "milk",
              "mana",
              "lifefluid",
              "urine",
              "rum",
              "fruitjuice",
            ];
            itemContentType = LIQUID_TYPES[itemCount] ?? "empty";
          }

          const info = {
            spriteId,
            spriteMeta,
            category,
            stackPosition: resolveStackPosition(spriteMeta, category),
            renderLayer,
            tileLayer: entryTileLayer,
            count: itemCount,
            contentType: itemContentType,
            tx,
            ty,
            z,
            dz,
            activeZ,
          };

          if (
            spritePredicate &&
            spritePredicate(spriteId, spriteMeta, info) === false
          ) {
            continue;
          }

          sortable.push(info);
        }

        sortable.sort((a, b) => {
          // 1. renderLayer: ground(0) → border(1) → items(2) → top(3)
          const ar = Number(a?.renderLayer ?? 2);
          const br = Number(b?.renderLayer ?? 2);
          if (ar !== br) return ar - br;
          // 2. stackPosition (dentro do mesmo renderLayer): bottom(3) < common(5) < top(10)
          const as = Number(a?.stackPosition ?? 5);
          const bs = Number(b?.stackPosition ?? 5);
          if (as !== bs) return as - bs;
          // 3. tileLayer: ordem de empilhamento dentro do tile
          const atl = Number(a?.tileLayer ?? -1);
          const btl = Number(b?.tileLayer ?? -1);
          if (atl !== btl) return atl - btl;
          return Number(a?.spriteId ?? 0) - Number(b?.spriteId ?? 0);
        });

        for (const info of sortable) {
          if (info.category === "bottom") {
            items.bottom.push(info);
          } else if (info.category === "top") {
            items.top.push(info);
          } else {
            items.common.push(info);
          }
        }

        // ═══════════════════════════════════════════════════════
        // ORDEM DE DRAW OTCLIENT:
        // 1. Bottom Items (acumula elevation)
        // 2. Common Items (acumula elevation)
        // 3. Top Items (NÃO usa elevation)
        // ═══════════════════════════════════════════════════════

        let elevation = 0;

        // Bottom items
        for (const item of items.bottom) {
          if (useAssets) {
            _drawSpriteFromAssets(
              ctx,
              assets,
              nexoData,
              item.spriteId,
              sx,
              sy,
              item.tx,
              item.ty,
              animClock,
              alpha,
              elevation,
              item.count,
              null,
              item.contentType,
            );
          } else if (atlas && nexoData) {
            drawSprite(
              ctx,
              atlas,
              nexoData,
              item.spriteId,
              sx,
              sy,
              item.tx,
              item.ty,
              animClock,
              alpha,
              elevation,
            );
          }

          // Acumular elevation (game.height_elevation conforme map_data.json)
          const elev = _getSpriteElevation(item.spriteId, nexoData);
          elevation = Math.min(elevation + elev, MAX_DRAW_ELEVATION);
        }

        // Common items
        for (const item of items.common) {
          if (useAssets) {
            _drawSpriteFromAssets(
              ctx,
              assets,
              nexoData,
              item.spriteId,
              sx,
              sy,
              item.tx,
              item.ty,
              animClock,
              alpha,
              elevation,
              item.count,
              null,
              item.contentType,
            );
          } else if (atlas && nexoData) {
            drawSprite(
              ctx,
              atlas,
              nexoData,
              item.spriteId,
              sx,
              sy,
              item.tx,
              item.ty,
              animClock,
              alpha,
              elevation,
            );
          }

          // Acumular elevation (game.height_elevation conforme map_data.json)
          const elev = _getSpriteElevation(item.spriteId, nexoData);
          elevation = Math.min(elevation + elev, MAX_DRAW_ELEVATION);
        }

        // Top items (sem elevation)
        for (const item of items.top) {
          if (useAssets) {
            _drawSpriteFromAssets(
              ctx,
              assets,
              nexoData,
              item.spriteId,
              sx,
              sy,
              item.tx,
              item.ty,
              animClock,
              alpha,
              0,
              item.count,
              null,
              item.contentType,
            );
          } else if (atlas && nexoData) {
            drawSprite(
              ctx,
              atlas,
              nexoData,
              item.spriteId,
              sx,
              sy,
              item.tx,
              item.ty,
              animClock,
              alpha,
              0,
            );
          }
        }
      }
    }
  }
}
