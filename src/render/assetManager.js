// ═══════════════════════════════════════════════════════════════
// assetManager.js — Gerenciador de Sprites e Atlas (Pipeline Final)
// ✅ Carrega atlas segmentados do pipeline Python
// ✅ Suporta bounding_box, pattern, stack_position
// ═══════════════════════════════════════════════════════════════

export class AssetManager {
  constructor() {
    this.sprites = new Map(); // itemid → { sheet, x, y, w, h }
    this.packs = {};
    this.effectsAtlas = null;
    this.outfitsAtlas = null;
    this.fieldsAtlas = null;

    // ✅ NOVO: Atlas do pipeline Python
    this.mapAtlas = null; // { image, data }
    this.mapData = {}; // map_data.json completo
  }

  // ═══════════════════════════════════════════════════════════════
  // NOVO: Carregar Assets do Mapa (Pipeline Python)
  // ═══════════════════════════════════════════════════════════════
  async loadMapAssets(basePath = "./assets_novo/") {
    try {
      // 1. Carregar map_data.json (metadata completa)
      const dataRes = await fetch(`${basePath}map_data.json`);
      if (!dataRes.ok) throw new Error("map_data.json não encontrado");
      this.mapData = await dataRes.json();
      console.log(
        `[AssetManager] ✅ ${Object.keys(this.mapData).length} itens de mapa carregados`,
      );

      // 2. Carregar atlas de mapa (segmentado por categoria)
      const masterRes = await fetch(`${basePath}master_index.json`);
      if (!masterRes.ok) throw new Error("master_index.json não encontrado");
      const masterIndex = await masterRes.json();

      // 3. Carregar todos os atlas segmentados
      const atlasPromises = masterIndex.atlases.map(async (atlasMeta) => {
        const img = await this._loadImage(`${basePath}${atlasMeta.filename}`);
        return {
          image: img,
          meta: atlasMeta,
          name: atlasMeta.atlas_name,
          index: atlasMeta.atlas_index,
        };
      });

      this.mapAtlases = await Promise.all(atlasPromises);
      console.log(
        `[AssetManager] ✅ ${this.mapAtlases.length} atlas de mapa carregados`,
      );

      // 4. Build Map<atlas_index, atlas> para lookup O(1) por índice
      this.mapAtlasesById = new Map();
      for (const atlas of this.mapAtlases) {
        this.mapAtlasesById.set(atlas.index, atlas);
      }

      // 5. Build lookup table para busca rápida por itemId_varKey
      this._buildMapAtlasLookup();

      return true;
    } catch (e) {
      console.error("[AssetManager] ❌ Erro ao carregar map assets:", e);
      return false;
    }
  }

  _buildMapAtlasLookup() {
    this.mapAtlasLookup = new Map();

    // 1. Seed from atlas JSON files (fallback for items absent from map_data)
    for (const atlas of this.mapAtlases) {
      for (const [itemId, variants] of Object.entries(
        atlas.meta.variants || {},
      )) {
        for (const [varKey, variant] of Object.entries(variants)) {
          this.mapAtlasLookup.set(`${itemId}_${varKey}`, {
            atlasIndex: atlas.index,
            atlasName: atlas.name,
            variant: variant,
          });
        }
      }
    }

    // 2. Override + extend with map_data.json — authoritative source for ALL
    //    variant keys and animation frames. map_data coordinates take priority
    //    over atlas JSON, which may have stale positions for animated items
    //    (atlas JSONs can be regenerated independently of map_data.json).
    for (const [itemId, itemData] of Object.entries(this.mapData)) {
      if (!itemData.variants) continue;
      for (const [varKey, variant] of Object.entries(itemData.variants)) {
        if (variant.atlas_index == null) continue;
        this.mapAtlasLookup.set(`${itemId}_${varKey}`, {
          atlasIndex: variant.atlas_index,
          atlasName: variant.atlas_name ?? "",
          variant: { x: variant.x, y: variant.y, w: variant.w, h: variant.h },
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // NOVO: Buscar Sprite de Mapa (com bounding box)
  // ═══════════════════════════════════════════════════════════════
  getMapSprite(itemid, variantKey = "0") {
    const lookupKey = `${itemid}_${variantKey}`;
    const lookup = this.mapAtlasLookup?.get(lookupKey);

    if (!lookup) {
      // Fallback para sprites legados
      return this.sprites.get(Number(itemid)) ?? null;
    }

    const atlas = this.mapAtlases[lookup.atlasIndex];
    if (!atlas?.image) return null;

    const metadata = this.mapData[String(itemid)];

    return {
      sheet: atlas.image,
      x: lookup.variant.x,
      y: lookup.variant.y,
      w: lookup.variant.w,
      h: lookup.variant.h,
      metadata: metadata,
      boundingBox: metadata?.bounding_box,
      pattern: metadata?.pattern,
      stackPosition: metadata?.game?.stack_position,
      renderLayer: metadata?.game?.render_layer,
    };
  }

  getMapItemMetadata(itemid) {
    return this.mapData[String(itemid)] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // STACK POSITION (para ordenação de renderização)
  // ═══════════════════════════════════════════════════════════════
  getStackPosition(itemid, entityType = "item") {
    const metadata = this.getMapItemMetadata(itemid);
    if (!metadata) return 3; // Default

    const game = metadata.game || {};
    const flags = metadata.flags_raw || {};

    // Ground sempre no fundo
    if (game.render_layer === 0 || flags.bank) return 0;

    // Top items no topo
    if (flags.top || flags.topeffect) return 10;

    // Walls antes de decoration
    if (flags.unpass || flags.unsight) return 1;

    // Hangable items
    if (flags.hang || flags.hook) return 2;

    // Items normais
    if (entityType === "item") return 3;
    if (entityType === "creature") return 5;
    if (entityType === "effect") return 8;

    return 4;
  }

  // ═══════════════════════════════════════════════════════════════
  // API LEGADA (Compatibilidade)
  // ═══════════════════════════════════════════════════════════════
  async loadSpriteSheet(name, imgUrl, itemMap) {
    const img = await this._loadImage(imgUrl);
    if (!img) return 0;
    let count = 0;
    for (const [id, frame] of Object.entries(itemMap)) {
      this.sprites.set(Number(id), { sheet: img, ...frame });
      count++;
    }
    console.log(`[AssetManager] ✅ "${name}" — ${count} sprites`);
    return count;
  }

  async loadPack(name, imgUrl, jsonUrl) {
    try {
      const [img, data] = await Promise.all([
        this._loadImage(imgUrl),
        fetch(jsonUrl).then((r) => r.json()),
      ]);
      if (img && data) {
        this.packs[name] = { image: img, data };
        return true;
      }
      return false;
    } catch (e) {
      console.error(`[AssetManager] Erro pack "${name}":`, e);
      return false;
    }
  }

  async loadOutfitsAtlas(imgUrl, jsonUrl) {
    try {
      const [img, data] = await Promise.all([
        this._loadImage(imgUrl),
        fetch(jsonUrl).then((r) => r.json()),
      ]);
      if (!img || !data) return false;
      this.outfitsAtlas = { image: img, data, outfitCache: new Map() };
      return true;
    } catch (e) {
      console.error("[AssetManager] Erro outfits:", e);
      return false;
    }
  }

  async loadEffectsAtlas(imgUrl, jsonUrl) {
    try {
      const [img, data] = await Promise.all([
        this._loadImage(imgUrl),
        fetch(jsonUrl).then((r) => r.json()),
      ]);
      if (!img || !data) return false;
      this.effectsAtlas = { image: img, data, frameKeyCache: new Map() };
      return true;
    } catch (e) {
      console.error("[AssetManager] Erro effects:", e);
      return false;
    }
  }

  async loadFieldsAtlas(imgUrl, jsonUrl) {
    try {
      const [img, data] = await Promise.all([
        this._loadImage(imgUrl),
        fetch(jsonUrl).then((r) => r.json()),
      ]);
      if (!img || !data) return false;
      this.fieldsAtlas = { image: img, data };
      return true;
    } catch (e) {
      console.error("[AssetManager] Erro fields:", e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OUTFITS — Sprites de jogadores (novo formato de atlas)
  // Retorna array de { sheet, info: {x,y,w,h}, colOffset }
  // ═══════════════════════════════════════════════════════════════
  getOutfitSprites(outfitId, opts = {}) {
    if (!this.hasOutfitsAtlas()) return [];
    const outfit = this.outfitsAtlas.data?.outfits?.[String(outfitId)];
    if (!outfit) return [];

    const {
      dir = "frente",
      isWalking = false,
      animationTimeMs = 0,
      includeTintMask = false,
    } = opts;

    // Mapeamento de direção → índice (N=0, E=1, S=2, W=3)
    // frente=S=2, costas=N=0, lado=E=1, lado-esquerdo=W=3
    const DIR_IDX = { frente: 2, costas: 0, lado: 1, "lado-esquerdo": 3 };
    const dirIdx = DIR_IDX[dir] ?? 2;

    // Seleciona grupo: group_id=1 (walking) se em movimento, senão group_id=0 (idle)
    const groups = outfit.groups ?? [];
    const walkGroup  = groups.find((g) => g.group_id === 1);
    const idleGroup  = groups.find((g) => g.group_id === 0) ?? groups[0];
    const group = (isWalking && walkGroup) ? walkGroup : idleGroup;
    if (!group) return [];

    const pat = group.pattern ?? {};
    const W = pat.width  ?? 4; // direções
    const H = pat.height ?? 3; // passos (frames de caminhada)
    const D = pat.depth  ?? 2; // profundidade (coluna esq/dir)
    const L = pat.layers ?? 2; // camadas de cor

    const nFrames = group.n_frames ?? 1;
    const ids = group.sprite_ids ?? [];

    // Frame de animação: para walking, cicla pelos n_frames com base no tempo
    let frame = 0;
    if (isWalking && nFrames > 1) {
      const frameDurationMs = 120; // ~8fps
      frame = Math.floor(animationTimeMs / frameDurationMs) % nFrames;
    }

    // Padrão global de indexação dos outfits extraídos:
    // frame -> step -> depth -> dir -> layer
    // idx = frame*(H*D*W*L) + (((step*D + depth)*W + dir)*L + layer)
    // - idle usa step 0
    // - walking também usa step 0 (sequência vem por n_frames; evita addons/máscaras)
    const baseLayer = 0; // sprite base (layer 0)
    const maskLayer = 1; // máscara/tint (layer 1)
    const depthIdx = 0; // depth base
    const step = 0;

    const perFrame = H * D * W * L;
    const baseLocalIdx = (((step * D + depthIdx) * W + dirIdx) * L + baseLayer);
    const baseIdx = frame * perFrame + baseLocalIdx;

    const spriteId = ids[baseIdx];
    if (spriteId == null) return [];

    const spriteMeta = this.outfitsAtlas.data?.sprites?.[String(spriteId)];
    if (!spriteMeta) return [];

    const out = [{
      sheet: this.outfitsAtlas.image,
      info: {
        x: spriteMeta.x,
        y: spriteMeta.y,
        w: spriteMeta.w,
        h: spriteMeta.h,
      },
      colOffset: 0,
    }];

    if (includeTintMask && L > 1) {
      const maskLocalIdx = (((step * D + depthIdx) * W + dirIdx) * L + maskLayer);
      const maskIdx = frame * perFrame + maskLocalIdx;
      const maskSpriteId = ids[maskIdx];
      const maskMeta =
        maskSpriteId != null
          ? this.outfitsAtlas.data?.sprites?.[String(maskSpriteId)]
          : null;
      if (maskMeta) {
        out.push({
          sheet: this.outfitsAtlas.image,
          info: {
            x: maskMeta.x,
            y: maskMeta.y,
            w: maskMeta.w,
            h: maskMeta.h,
          },
          colOffset: 0,
          isTintMask: true,
        });
      }
    }

    return out;
  }

  hasPack(name) {
    return !!this.packs[name];
  }
  hasOutfitsAtlas() {
    return !!this.outfitsAtlas?.image;
  }
  hasEffectsAtlas() {
    return !!this.effectsAtlas?.image;
  }
  hasFieldsAtlas() {
    return !!this.fieldsAtlas?.image;
  }
  hasOutfitDefinition(outfitId) {
    if (!this.hasOutfitsAtlas()) return false;
    return !!this.outfitsAtlas.data?.outfits?.[String(outfitId)];
  }
  hasMapAssets() {
    return !!this.mapData && Object.keys(this.mapData).length > 0;
  }

  clearMapAssets() {
    this.mapData = {};
    this.mapAtlases = [];
    this.mapAtlasLookup?.clear();
  }

  get spriteCount() {
    return this.sprites.size;
  }
  get packCount() {
    return Object.keys(this.packs).length;
  }
  get mapItemCount() {
    return Object.keys(this.mapData).length;
  }

  _loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.error(`[AssetManager] ❌ Falha: ${url}`);
        resolve(null);
      };
      img.src = url;
    });
  }
}
