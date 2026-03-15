// =============================================================================
// assetLoader.js — mmoRPGEduc
// Carrega TODOS os assets gerados pelo pipeline Python
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../../core/events.js";

export class AssetLoader {
  constructor(basePath = "assets/") {
    this.basePath = basePath;
    this.mapData = null;
    this.atlasCache = new Map();
    this.masterIndex = null;
    this.loaded = false;
  }

  async init() {
    console.log("🚀 AssetLoader: Iniciando carregamento...");

    try {
      // 1. Carregar master_index.json (lista de atlases)
      await this._loadMasterIndex();

      // 2. Carregar map_data.json (dados dos itens)
      await this._loadMapData();

      // 3. Carregar todos os atlases
      await this._loadAtlases();

      // 4. Expor globalmente para o renderer
      this._exposeGlobally();

      this.loaded = true;
      console.log("✅ AssetLoader: Todos os assets carregados!");

      worldEvents.emit(EVENT_TYPES.ASSETS_LOADED, {
        totalItems: Object.keys(this.mapData).length,
        totalAtlases: this.atlasCache.size,
      });

      return true;
    } catch (error) {
      console.error("❌ AssetLoader: Falha crítica:", error);
      worldEvents.emit(EVENT_TYPES.SYSTEM_LOG, {
        message: "Falha ao carregar assets",
        error: error.message,
        level: "error",
      });
      return false;
    }
  }

  async _loadMasterIndex() {
    console.log("📑 Carregando master_index.json...");
    const response = await fetch(`${this.basePath}/master_index.json`);
    if (!response.ok) throw new Error(`master_index.json: ${response.status}`);

    this.masterIndex = await response.json();
    console.log(
      `✅ master_index.json: ${this.masterIndex.stats?.total_atlases || 0} atlases`,
    );
  }

  async _loadMapData() {
    console.log("🗺️ Carregando map_data.json...");
    const response = await fetch(`${this.basePath}/map_data.json`);
    if (!response.ok) throw new Error(`map_data.json: ${response.status}`);

    const rawData = await response.json();

    // ✅ SUPORTAR ambas as estruturas:
    // Estrutura nova: { items: {...}, indices: {...} }
    // Estrutura antiga: {...items diretos...}
    this.mapData = rawData.items || rawData;

    console.log(`✅ map_data.json: ${Object.keys(this.mapData).length} itens`);

    // Debug: mostrar estrutura do primeiro item
    const firstId = Object.keys(this.mapData)[0];
    if (firstId) {
      console.log("📊 Estrutura do item:", {
        id: firstId,
        hasVariants: !!this.mapData[firstId].variants,
        hasGame: !!this.mapData[firstId].game,
        sampleVariant: this.mapData[firstId].variants?.["0"],
      });
    }
  }

  async _loadAtlases() {
    console.log("🎨 Carregando atlases...");

    if (!this.masterIndex?.atlases) {
      throw new Error("master_index.atlases não encontrado");
    }

    const loadPromises = this.masterIndex.atlases.map(async (atlasMeta) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // Para CORS se necessário

      return new Promise((resolve, reject) => {
        img.onload = () => {
          console.log(
            `✅ Atlas carregado: ${atlasMeta.filename} (${atlasMeta.items_count} itens)`,
          );
          resolve({
            name: atlasMeta.atlas_name,
            index: atlasMeta.atlas_index,
            image: img,
            metadata: atlasMeta,
          });
        };
        img.onerror = () =>
          reject(new Error(`Falha ao carregar: ${atlasMeta.filename}`));
        img.src = `${this.basePath}/${atlasMeta.filename}`;
      });
    });

    const loadedAtlases = await Promise.all(loadPromises);

    // Criar cache por nome
    for (const atlas of loadedAtlases) {
      this.atlasCache.set(atlas.name, atlas);
    }

    console.log(`✅ ${this.atlasCache.size} atlases em cache`);
  }

  _exposeGlobally() {
    // Expor para o renderer e debug
    window.mapData = this.mapData;
    window.atlasCache = this.atlasCache;
    window.masterIndex = this.masterIndex;

    console.log(
      "🌍 Assets expostos globalmente (window.mapData, window.atlasCache)",
    );
  }

  // Helper para o renderer
  getAtlas(name) {
    return this.atlasCache.get(name);
  }

  getItemData(itemId) {
    return this.mapData?.[String(itemId)];
  }

  getVariant(itemId, variantKey = "0") {
    const item = this.getItemData(itemId);
    return item?.variants?.[variantKey];
  }
}

export function createAssetLoader(basePath) {
  const loader = new AssetLoader(basePath);
  return loader;
}
