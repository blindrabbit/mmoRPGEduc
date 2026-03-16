// ═══════════════════════════════════════════════════════════════
// FloorLayer.js — Camadas de floor isoladas por Z
// Regra #1: Separação Total por Floor Z (sem mistura entre Z levels)
// Cada FloorLayer gerencia APENAS seus próprios tiles
// ═══════════════════════════════════════════════════════════════

import { canSeeFloor, getVisibleFloors } from "../core/floorVisibility.js";

// ═══════════════════════════════════════════════════════════════
// TILE — Tile isolado com camadas separadas (OTClient order)
// ═══════════════════════════════════════════════════════════════

/**
 * Tile com camadas internas separadas:
 *   1. ground       — sempre na base, opaco
 *   2. bottomItems  — topOrder 0-3 (poças, sangue, grama)
 *   3. topItems     — topOrder 4+ (mesas, baús, paredes)
 *   4. creatures    — gerenciado externamente pelo CreatureManager
 *   5. effects      — partículas / animações (topo absoluto)
 */
export class TileObject {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;

    this.ground = null;       // { id, meta }
    this.bottomItems = [];    // topOrder 0-3
    this.topItems = [];       // topOrder 4+
    this.creatures = [];      // { id, spriteId, direction, ... }
    this.effects = [];        // partículas, animações
  }

  /**
   * Adiciona item na camada correta baseada em topOrder / category.
   * @param {{ id: number, meta?: object }} itemData
   */
  addItem(itemData) {
    const flags = itemData.meta?.flags_raw ?? {};
    const game  = itemData.meta?.game ?? {};

    // Ground: bank flag ou render_layer=0
    if (flags.bank || game.render_layer === 0) {
      this.ground = itemData;
      return;
    }

    // topOrder derivado das flags OTClient
    const topOrder = _resolveTopOrder(flags, game);

    if (topOrder <= 3) {
      this.bottomItems.push({ ...itemData, _topOrder: topOrder });
      this.bottomItems.sort((a, b) => (a._topOrder ?? 0) - (b._topOrder ?? 0));
    } else {
      this.topItems.push({ ...itemData, _topOrder: topOrder });
      this.topItems.sort((a, b) => (a._topOrder ?? 0) - (b._topOrder ?? 0));
    }
  }

  /** Remove todos os itens mantendo a estrutura */
  clear() {
    this.ground = null;
    this.bottomItems = [];
    this.topItems = [];
    this.creatures = [];
    this.effects = [];
  }

  /** Retorna true se o tile tem pelo menos um sprite renderizável */
  hasContent() {
    return (
      this.ground !== null ||
      this.bottomItems.length > 0 ||
      this.topItems.length > 0
    );
  }
}

// Converte flags OTClient em topOrder numérico
function _resolveTopOrder(flags, game) {
  if (flags.top || flags.topeffect) return 10;  // top items
  if (flags.bottom) return 4;                    // bottom flag = acima do chão mas abaixo de itens comuns
  if (flags.clip) return 2;                      // groundBorder
  return 5;                                      // common items
}

// ═══════════════════════════════════════════════════════════════
// FLOOR LAYER — Gerencia tiles de um único andar Z
// ═══════════════════════════════════════════════════════════════

export class FloorLayer {
  /**
   * @param {number} z - nível do andar (0-15)
   */
  constructor(z) {
    this.z = z;
    /** @type {Map<string, TileObject>} "x,y" → TileObject */
    this.tiles = new Map();
    this.isVisible = false;
  }

  /**
   * Obtém ou cria um TileObject para as coordenadas (x, y).
   * @param {number} x
   * @param {number} y
   * @returns {TileObject}
   */
  getOrCreate(x, y) {
    const key = `${x},${y}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = new TileObject(x, y, this.z);
      this.tiles.set(key, tile);
    }
    return tile;
  }

  /**
   * Retorna o TileObject em (x, y) ou null.
   * @param {number} x
   * @param {number} y
   * @returns {TileObject|null}
   */
  getTile(x, y) {
    return this.tiles.get(`${x},${y}`) ?? null;
  }

  /** Remove tile em (x, y). */
  removeTile(x, y) {
    this.tiles.delete(`${x},${y}`);
  }

  /** Número de tiles neste floor. */
  get size() {
    return this.tiles.size;
  }
}

// ═══════════════════════════════════════════════════════════════
// GERENCIAMENTO DE FLOORS — estrutura hierárquica isolada
// ═══════════════════════════════════════════════════════════════

/**
 * Cria a estrutura floorLayers[0..15] com FloorLayer isoladas.
 * @returns {Record<number, FloorLayer>}
 */
export function createFloorLayers() {
  const layers = {};
  for (let z = 0; z <= 15; z++) {
    layers[z] = new FloorLayer(z);
  }
  return layers;
}

/**
 * Popula floorLayers a partir do mapa plano existente:
 *   map["x,y,z"] = { "0": [...], "1": [...], "2": [...], "3": [...] }
 *
 * @param {Object} map          - worldState.map
 * @param {Object} mapData      - assets.mapData (metadata dos sprites)
 * @param {Record<number, FloorLayer>} floorLayers - destino
 */
export function buildFloorLayers(map, mapData, floorLayers) {
  // Limpa todas as camadas antes de reconstruir
  for (let z = 0; z <= 15; z++) {
    floorLayers[z].tiles.clear();
  }

  for (const [key, tileData] of Object.entries(map)) {
    const parts = key.split(",");
    const tx = parseInt(parts[0], 10);
    const ty = parseInt(parts[1], 10);
    const tz = parseInt(parts[2], 10);
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) continue;
    if (tz < 0 || tz > 15) continue;

    const tileObj = floorLayers[tz].getOrCreate(tx, ty);

    // Itera as camadas internas (0, 1, 2, 3, 99...)
    if (tileData && typeof tileData === "object" && !Array.isArray(tileData)) {
      const layerKeys = Object.keys(tileData)
        .map((k) => parseInt(k, 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);

      for (const layer of layerKeys) {
        const items = tileData[String(layer)];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!item || (item.id == null && typeof item !== "number")) continue;
          const id = typeof item === "number" ? item : item.id;
          const meta = mapData?.[String(id)] ?? null;
          tileObj.addItem({ id, count: item.count ?? 1, meta });
        }
      }
    } else if (Array.isArray(tileData)) {
      for (const item of tileData) {
        const id = typeof item === "number" ? item : item?.id;
        if (id == null) continue;
        const meta = mapData?.[String(id)] ?? null;
        tileObj.addItem({ id, count: item?.count ?? 1, meta });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDER ORDER — painter's algorithm (mais fundo primeiro)
// ═══════════════════════════════════════════════════════════════

/**
 * Retorna os Z visíveis em ordem de renderização:
 *   Z maior (mais fundo) → Z menor (mais perto da câmera)
 * @param {number} cameraZ
 * @returns {number[]}
 */
export function getRenderOrder(cameraZ) {
  const visible = getVisibleFloors(cameraZ); // já em ordem decrescente [7,6,5...]
  return visible; // deepest Z first (já está correto pelo getVisibleFloors)
}

/**
 * Atualiza a flag isVisible em cada FloorLayer com base no cameraZ.
 * @param {Record<number, FloorLayer>} floorLayers
 * @param {number} cameraZ
 */
export function updateFloorVisibility(floorLayers, cameraZ) {
  for (let z = 0; z <= 15; z++) {
    floorLayers[z].isVisible = canSeeFloor(cameraZ, z);
  }
}

// ═══════════════════════════════════════════════════════════════
// IMPORTAÇÃO DE TILES OTBM
// Compatibilidade direta com tiles vindos de mapas .otbm
// ═══════════════════════════════════════════════════════════════

/**
 * Importa um tile de mapa .otbm para a estrutura de FloorLayers.
 *
 * @param {Object} otbmTile - tile do .otbm: { x, y, z, items: [{id, attributes}] }
 * @param {Record<number, FloorLayer>} floorLayers
 * @param {Object} mapData - metadata dos sprites
 */
export function importOtbmTile(otbmTile, floorLayers, mapData) {
  const { x, y, z, items = [] } = otbmTile;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (z < 0 || z > 15) return;

  const tileObj = floorLayers[z].getOrCreate(x, y);
  tileObj.clear();

  for (const item of items) {
    const id = item.id ?? item.serverId;
    if (id == null) continue;
    const meta = mapData?.[String(id)] ?? null;
    tileObj.addItem({
      id,
      count: item.count ?? item.attributes?.count ?? 1,
      meta,
      otbmAttributes: item.attributes ?? null,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// DEBUG OVERLAY — visualização de floors em desenvolvimento
// ═══════════════════════════════════════════════════════════════

/**
 * Adiciona overlays CSS ao canvas para visualizar floors ativos.
 * Remover em produção via removeFloorDebugOverlays().
 * @param {Record<number, FloorLayer>} floorLayers
 * @param {number} cameraZ
 * @param {HTMLElement} container - pai do canvas
 */
export function addFloorDebugOverlays(floorLayers, cameraZ, container) {
  removeFloorDebugOverlays(container);

  const wrapper = document.createElement("div");
  wrapper.id = "floor-debug-overlay";
  wrapper.style.cssText = `
    position: absolute; top: 4px; right: 4px;
    display: flex; flex-direction: column; gap: 2px;
    font: 10px monospace; pointer-events: none; z-index: 9999;
  `;

  for (let z = 0; z <= 15; z++) {
    const layer = floorLayers[z];
    const isActive = z === cameraZ;
    const isVisible = layer.isVisible;
    const tileCount = layer.size;

    const row = document.createElement("div");
    row.style.cssText = `
      padding: 1px 6px;
      background: ${isActive ? "rgba(255,220,0,0.9)" : isVisible ? "rgba(0,180,80,0.7)" : "rgba(60,60,60,0.6)"};
      color: ${isActive ? "#000" : "#fff"};
      border-radius: 2px;
    `;
    row.textContent = `Z${z}${isActive ? " ●" : ""} [${tileCount}t]`;
    wrapper.appendChild(row);
  }

  container.style.position = container.style.position || "relative";
  container.appendChild(wrapper);
}

/** Remove overlays de debug criados por addFloorDebugOverlays. */
export function removeFloorDebugOverlays(container) {
  const existing = container?.querySelector("#floor-debug-overlay");
  existing?.remove();
}
