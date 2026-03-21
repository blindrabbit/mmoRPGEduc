// =============================================================================
// MapChunkSubscriber.js
// Gerencia assinaturas Firebase por chunk de mapa (world_tiles/{z}/{cx},{cy}).
// Mantém `map` atualizado em tempo real usando apenas os tiles visíveis na tela.
//
// Estrutura Firebase: world_tiles/{z}/{cx},{cy} → { "x,y": { "layer": [...] } }
// =============================================================================

import { dbWatch } from "./firebaseClient.js";
import { buildFloorIndex } from "../render/mapRenderer.js";
import { TILE_CHUNK_SIZE } from "./db.js";

export class MapChunkSubscriber {
  /**
   * @param {object} [options]
   * @param {number} [options.chunkSize=TILE_CHUNK_SIZE]
   * @param {function} [options.onFloorIndexUpdate] - chamado com o novo floorIndex
   */
  constructor({ chunkSize = TILE_CHUNK_SIZE, onFloorIndexUpdate } = {}) {
    this.chunkSize = chunkSize;
    /** Mapa de tiles ativo — mutado in-place, compatível com world_items na layer "99" */
    this.map = {};
    this.floorIndex = null;
    this._onFloorIndexUpdate = onFloorIndexUpdate ?? null;
    /** chunkPath → unsub fn */
    this._subs = new Map();
    /** chunkPath → Set<coord> (coordenadas "x,y,z" cobertas por este chunk) */
    this._chunkCoords = new Map();
  }

  /**
   * Atualiza as assinaturas com base na posição e no viewport do player/câmera.
   * Deve ser chamado quando o player muda de tile ou troca de andar.
   *
   * @param {number} cx - posição X central em tiles
   * @param {number} cy - posição Y central em tiles
   * @param {number[]} floors - andares visíveis, ex: [7] ou [6, 7, 8]
   * @param {number} halfW - metade da largura do viewport em tiles (use cols para 2× viewport)
   * @param {number} halfH - metade da altura do viewport em tiles (use rows para 2× viewport)
   */
  update(cx, cy, floors, halfW, halfH) {
    const { chunkSize } = this;
    const needed = new Set();

    for (const z of floors) {
      const cxMin = Math.floor((cx - halfW) / chunkSize);
      const cxMax = Math.floor((cx + halfW) / chunkSize);
      const cyMin = Math.floor((cy - halfH) / chunkSize);
      const cyMax = Math.floor((cy + halfH) / chunkSize);
      for (let chunkX = cxMin; chunkX <= cxMax; chunkX++) {
        for (let chunkY = cyMin; chunkY <= cyMax; chunkY++) {
          needed.add(`${z}/${chunkX},${chunkY}`);
        }
      }
    }

    // Subscreve chunks novos
    for (const chunkPath of needed) {
      if (this._subs.has(chunkPath)) continue;
      const unsub = dbWatch(`world_tiles/${chunkPath}`, (data) => {
        this._applyChunkData(chunkPath, data);
      });
      this._subs.set(chunkPath, unsub);
    }

    // Cancela chunks distantes
    for (const [chunkPath, unsub] of this._subs) {
      if (!needed.has(chunkPath)) {
        unsub();
        this._subs.delete(chunkPath);
        this._unloadChunk(chunkPath);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  _applyChunkData(chunkPath, data) {
    const z = parseInt(chunkPath.split("/")[0], 10);
    const map = this.map;

    // Remove tiles anteriores deste chunk (sem apagar layer "99" de world_items)
    const oldCoords = this._chunkCoords.get(chunkPath);
    if (oldCoords) {
      for (const coord of oldCoords) {
        const tile = map[coord];
        if (!tile) continue;
        for (const layer of Object.keys(tile)) {
          if (layer !== "99") delete tile[layer];
        }
        if (Object.keys(tile).length === 0) delete map[coord];
      }
    }

    const newCoords = new Set();
    if (data && typeof data === "object") {
      for (const [xy, tileData] of Object.entries(data)) {
        const coord = `${xy},${z}`;
        newCoords.add(coord);
        if (!map[coord]) map[coord] = {};

        // Suporta dois formatos:
        //   Compacto: { "0": [{id,count}], "2": [...] }
        //   Firebase: { layers: {"0": [...], "2": [...]}, flags: N, houseId: ... }
        const layersObj =
          tileData &&
          typeof tileData === "object" &&
          tileData.layers != null &&
          typeof tileData.layers === "object" &&
          !Array.isArray(tileData.layers)
            ? tileData.layers
            : tileData;

        for (const [layer, tiles] of Object.entries(layersObj ?? {})) {
          if (layer !== "99") map[coord][layer] = tiles;
        }

        // Preserva metadados do tile para uso futuro (FlagResolver, houses)
        if (tileData?.flags != null) map[coord].__flags = tileData.flags;
        if (tileData?.houseId) map[coord].__houseId = tileData.houseId;
      }
    }

    this._chunkCoords.set(chunkPath, newCoords);
    this._rebuildFloorIndex();
  }

  _unloadChunk(chunkPath) {
    const map = this.map;
    const coords = this._chunkCoords.get(chunkPath);
    if (coords) {
      for (const coord of coords) {
        const tile = map[coord];
        if (!tile) continue;
        for (const layer of Object.keys(tile)) {
          if (layer !== "99") delete tile[layer];
        }
        if (Object.keys(tile).length === 0) delete map[coord];
      }
      this._chunkCoords.delete(chunkPath);
    }
    this._rebuildFloorIndex();
  }

  _rebuildFloorIndex() {
    this.floorIndex = buildFloorIndex(this.map);
    this._onFloorIndexUpdate?.(this.floorIndex);
  }

  destroy() {
    for (const unsub of this._subs.values()) unsub();
    this._subs.clear();
    this._chunkCoords.clear();
  }
}
