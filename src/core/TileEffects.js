// ═══════════════════════════════════════════════════════════════
// TileEffects.js — Efeitos ao pisar em um tile
//
// Detecta automaticamente o que acontece quando o player pisa em
// um tile: teleportes e mudanças de andar (escadas/buracos).
//
// Uso:
//   const effect = resolveStepOnEffects(x, y, z, worldState);
//   if (effect?.type === 'teleport')      → mover player para effect.dest
//   if (effect?.type === 'floor_change')  → mover player para effect.newX/Y/Z
//
// Fontes de dados:
//   teleportDest  — por instância de item em worldState.map[coord]
//   isFloorChange — por tile flag em worldState.flagDefs (FlagResolver)
// ═══════════════════════════════════════════════════════════════

import { FlagResolver } from "./FlagResolver.js";

// ── Teleport ────────────────────────────────────────────────────

/**
 * Lê os itens do tile e procura teleportDest em qualquer layer.
 * Ignora destinos (0,0,0) — teleporte não configurado no editor.
 * @param {Object} tile  — entrada de worldState.map[coord]
 * @returns {{x:number, y:number, z:number}|null}
 */
function _findTeleportDest(tile) {
  if (!tile || typeof tile !== "object") return null;

  // Suporta ambos os formatos: { layers: {…} } e { "0": […], "1": […] }
  const layers =
    tile.layers != null &&
    typeof tile.layers === "object" &&
    !Array.isArray(tile.layers)
      ? tile.layers
      : tile;

  for (const [key, layerItems] of Object.entries(layers)) {
    if (key.startsWith("_")) continue; // ignora __flags, __houseId
    if (!Array.isArray(layerItems)) continue;
    for (const item of layerItems) {
      if (!item || typeof item !== "object") continue;
      const d = item.teleportDest;
      if (d && (d.x !== 0 || d.y !== 0 || d.z !== 0)) {
        return { x: d.x, y: d.y, z: d.z };
      }
    }
  }
  return null;
}

// ── Floor Change via map_data ────────────────────────────────────

/**
 * Procura propriedade `floorChange` em qualquer item do tile via map_data.
 * Funciona independente de OTBM tile flags — basta o item estar em FLOOR_CHANGE_ITEMS.
 *
 * @param {Object} tile     — entrada de worldState.map[coord]
 * @param {Object} nexoData — worldState.assets.mapData
 * @returns {{direction, destOffset, type}|null}
 */
function _findFloorChangeInItems(tile, nexoData) {
  if (!tile || !nexoData) return null;

  const layers =
    tile.layers != null &&
    typeof tile.layers === "object" &&
    !Array.isArray(tile.layers)
      ? tile.layers
      : tile;

  // Procura floorChange em todos os itens
  for (const [key, layerItems] of Object.entries(layers)) {
    if (key.startsWith("_") || !Array.isArray(layerItems)) continue;
    for (const item of layerItems) {
      if (!item || typeof item !== "object") continue;
      const itemId = item.id;
      const meta = nexoData[String(itemId)];

      // Ignora ladder (1948) aqui - só funciona via ONUSE
      if (itemId === 1948) continue;

      if (meta?.floorChange) return meta.floorChange;
    }
  }
  return null;
}

// ── Floor Change direção ─────────────────────────────────────────

// Offsets cardinais: onde o player aparece no andar destino (OTClient convention)
const _FLOOR_OFFSETS = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: +1 },
  east: { dx: +1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

const _OPPOSITE = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/**
 * Para uma escada com direction "down" em (x,y,z), procura a escada no
 * andar alvo (z-1) na mesma posição e retorna a direção oposta.
 * Isso garante que o player apareça do lado oposto da escada de subida,
 * evitando loop imediato.
 * @returns {string|null}  direção oposta ("east", "north"…) ou null
 */
function _resolveOppositeFromTargetFloor(x, y, targetZ, map, nexoData) {
  const targetCoord = `${x},${y},${targetZ}`;
  const targetTile = map?.[targetCoord];
  if (!targetTile || !nexoData) return null;
  const fc = _findFloorChangeInItems(targetTile, nexoData);
  if (!fc?.direction) return null;
  return _OPPOSITE[fc.direction] ?? null;
}

function _resolveStairAscentDelta(direction) {
  if (!_FLOOR_OFFSETS[direction]) return null;
  const { dx, dy } = _FLOOR_OFFSETS[direction];
  const stairDy = direction === "south" ? +2 : dy;
  return { dx, dy: stairDy, dz: -1 };
}

function _findStairOnTargetFloorOrSides(x, y, targetZ, map, nexoData) {
  const candidates = [
    { x, y },
    { x, y: y - 1 }, // north
    { x, y: y + 1 }, // south
    { x: x - 1, y }, // west
    { x: x + 1, y }, // east
  ];

  for (const candidate of candidates) {
    const coord = `${candidate.x},${candidate.y},${targetZ}`;
    const tile = map?.[coord];
    if (!tile || !nexoData) continue;
    const fc = _findFloorChangeInItems(tile, nexoData);
    if (fc && (fc.type === "stair" || fc.type === "ramp")) {
      return fc;
    }
  }

  return null;
}

function _resolveReverseFromTargetStair(x, y, targetZ, map, nexoData) {
  const targetFc = _findStairOnTargetFloorOrSides(x, y, targetZ, map, nexoData);
  if (!targetFc) return null;

  const ascentDelta = _resolveStairAscentDelta(targetFc.direction);
  if (!ascentDelta) return null;

  return { dx: -ascentDelta.dx, dy: -ascentDelta.dy };
}

/**
 * Resolve o destino de uma mudança de andar a partir de:
 *   - direction "up"/"down" → z explícito, sem offset cardinal
 *   - direction cardinal (north/south/east/west) → heurística para z,
 *     offset cardinal aplicado (onde o player aparece no andar destino)
 *   - direction null/desconhecido → heurística original
 *
 * Para "down" em escada/rampa: usa o reverso do movimento de subida da
 * escada/rampa do piso inferior, mantendo a descida para Z+1.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Object} map
 * @param {string|null} direction  — "up"|"down"|"north"|"south"|"east"|"west"|null
 * @param {string|null} type       — "stair"|"ramp"|"hole"|"teleport"|null
 */
function _resolveFloorChangeDirection(
  x,
  y,
  z,
  map,
  direction = null,
  nexoData = null,
  type = null,
) {
  // Direção cardinal explícita.
  if (_FLOOR_OFFSETS[direction]) {
    if (type === "stair" || type === "ramp") {
      // Regra genérica: escadas/rampas cardinais sobem 1 andar no sentido da direção.
      const ascentDelta = _resolveStairAscentDelta(direction);
      return {
        newX: x + ascentDelta.dx,
        newY: y + ascentDelta.dy,
        newZ: z + ascentDelta.dz,
      };
    }

    const aboveCoord = `${x},${y},${z - 1}`;
    let goingUp;
    if (type === "stair" || type === "ramp") {
      // Escadas/rampas sobem por padrão quando direção é cardinal.
      goingUp = true;
    } else if (type === "hole") {
      goingUp = false;
    } else {
      // Fallback legado quando não há tipo confiável.
      goingUp = map?.[aboveCoord] != null;
    }
    const { dx, dy } = _FLOOR_OFFSETS[direction];
    return { newX: x + dx, newY: y + dy, newZ: goingUp ? z - 1 : z + 1 };
  }

  // "down" explícito.
  if (direction === "down") {
    if (type === "stair" || type === "ramp") {
      // Regra genérica: desce Z+1 e aplica o reverso da escada/rampa do piso abaixo.
      const targetZ = z + 1;
      const reverseDelta = _resolveReverseFromTargetStair(
        x,
        y,
        targetZ,
        map,
        nexoData,
      );

      // Se não tiver escada de subida no piso abaixo, usa posição atual
      return {
        newX: x + (reverseDelta?.dx ?? 0),
        newY: y + (reverseDelta?.dy ?? 0),
        newZ: targetZ,
      };
    }

    // Hole e outros: desce direto (Z+1)
    const targetZ = z + 1;
    return {
      newX: x,
      newY: y,
      newZ: targetZ,
    };
  }

  // "up" explícito → força subida, sem offset
  // Convenção deste projeto: subir = Z-1
  if (direction === "up") {
    return { newX: x, newY: y, newZ: z - 1 };
  }

  // Fallback (sem direction): heurística por contexto
  const aboveCoord = `${x},${y},${z - 1}`;
  const goingUp = map?.[aboveCoord] != null;
  return {
    newX: x,
    newY: goingUp ? y : y + 1,
    newZ: goingUp ? z - 1 : z + 1,
  };
}

// ── API pública ─────────────────────────────────────────────────

/**
 * Verifica se o tile em (x, y, z) tem efeito ao ser pisado.
 *
 * Fontes de detecção (em ordem de prioridade):
 *   1. teleportDest no item (configurado no editor OTBM)
 *   2. isFloorChange via tile flag OTBM (field "flags" ou "__flags")
 *   3. floorChange via map_data do item (independe de flag OTBM)
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Object} worldState  — { map, assets: { mapData } }
 * @returns {null
 *   | { type: 'teleport',      dest: {x,y,z} }
 *   | { type: 'floor_change',  newX, newY, newZ }
 * }
 */
export function resolveStepOnEffects(x, y, z, worldState) {
  const coord = `${x},${y},${z}`;
  const tile = worldState?.map?.[coord];
  if (!tile) return null;

  // 1. Teleporte — instância de item tem teleportDest configurado
  const dest = _findTeleportDest(tile);
  if (dest) {
    return { type: "teleport", dest };
  }

  // 2. Mudança de andar — tile flag OTBM
  //    BUG FIX: campo no map_compacto.json é "flags", não "__flags"
  const flagId = tile.__flags ?? tile.flags ?? 0;
  const flags = FlagResolver.resolve(flagId);
  const nexoData = worldState.assets?.mapData;
  if (flags.isFloorChange) {
    // Tenta ler direction do map_data mesmo quando a flag vem do OTBM
    const fc = _findFloorChangeInItems(tile, nexoData);

    // Se tiver destOffset (ex: ladder 1948), usa diretamente
    if (fc?.destOffset) {
      return {
        type: "floor_change",
        newX: x + (fc.destOffset.x ?? 0),
        newY: y + (fc.destOffset.y ?? 0),
        newZ: z + (fc.destOffset.z ?? 0),
      };
    }

    const { newX, newY, newZ } = _resolveFloorChangeDirection(
      x,
      y,
      z,
      worldState.map,
      fc?.direction ?? null,
      nexoData,
      fc?.type ?? null,
    );
    return { type: "floor_change", newX, newY, newZ };
  }

  // 3. Mudança de andar — via floorChange no map_data do item
  //    Funciona mesmo sem TILESTATE_FLOORCHANGE setado no OTBM
  const floorChange = _findFloorChangeInItems(tile, nexoData);
  if (floorChange) {
    const { destOffset, direction } = floorChange;
    if (destOffset) {
      return {
        type: "floor_change",
        newX: x + (destOffset.x ?? 0),
        newY: y + (destOffset.y ?? 0),
        newZ: z + (destOffset.z ?? 0),
      };
    }
    const { newX, newY, newZ } = _resolveFloorChangeDirection(
      x,
      y,
      z,
      worldState.map,
      direction ?? null,
      nexoData,
      floorChange?.type ?? null,
    );
    return { type: "floor_change", newX, newY, newZ };
  }

  return null;
}
