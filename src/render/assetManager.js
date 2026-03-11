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
  async loadMapAssets(basePath = "./assets/") {
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

  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  _hashString(value) {
    const text = String(value ?? "");
    let hash = 0;
    for (let index = 0; index < text.length; index++) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return hash;
  }

  _getFieldStagePhaseIndex(
    nativeFrameCount,
    elapsedMs,
    context = {},
    phases = [],
  ) {
    const frameCount = Math.max(1, Number(nativeFrameCount ?? 1));
    if (frameCount === 1) return 0;

    const phaseDurations = Array.isArray(phases)
      ? phases
          .map((phase) => Number(phase?.d_min ?? phase?.d_max ?? 0))
          .filter((value) => value > 0)
      : [];
    const atlasDuration = phaseDurations.reduce((sum, value) => sum + value, 0);
    const explicitDuration = Number(
      context.fieldDuration ?? context.totalDuration ?? 0,
    );
    const totalDuration = Math.max(
      1,
      explicitDuration || atlasDuration || frameCount * 120,
    );
    const elapsed = Math.max(0, Number(elapsedMs ?? 0));
    const progress = this._clamp(elapsed / totalDuration, 0, 0.999999);

    // Regra visual: 3 tamanhos ao longo da vida do field.
    // Dentro de cada tamanho, alterna entre 2 frames do atlas.
    const stageIndex = progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2;
    const stageFramePairs = [
      [0, Math.min(1, frameCount - 1)],
      [
        Math.min(Math.max(1, Math.floor((frameCount - 1) / 2)), frameCount - 1),
        Math.min(
          Math.max(2, Math.floor((frameCount - 1) / 2) + 1),
          frameCount - 1,
        ),
      ],
      [Math.max(0, frameCount - 2), frameCount - 1],
    ];

    const pair = stageFramePairs[
      Math.min(stageIndex, stageFramePairs.length - 1)
    ] ?? [0, 0];
    const uniquePair = pair[0] === pair[1] ? [pair[0]] : pair;

    const stageStartRatio = stageIndex / 3;
    const stageStartTime = totalDuration * stageStartRatio;
    const localElapsed = Math.max(0, elapsed - stageStartTime);

    const phaseDuration = Math.max(
      60,
      Number(
        phaseDurations[uniquePair[0]] ??
          phaseDurations[uniquePair[1] ?? uniquePair[0]] ??
          120,
      ),
    );

    if (uniquePair.length === 1) return uniquePair[0];

    const pairIndex =
      Math.floor(localElapsed / phaseDuration) % uniquePair.length;
    return uniquePair[pairIndex] ?? uniquePair[0];
  }

  _getFieldVariantIndex(spritesPerFrame, context = {}) {
    const variants = Math.max(1, Number(spritesPerFrame ?? 1));
    if (variants === 1) return 0;
    const seed =
      context.variantSeed ??
      `${context.id ?? "field"}:${context.x ?? 0}:${context.y ?? 0}:${context.z ?? 7}`;
    return this._hashString(seed) % variants;
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
    const walkGroup = groups.find((g) => g.group_id === 1);
    const idleGroup = groups.find((g) => g.group_id === 0) ?? groups[0];
    const group = isWalking && walkGroup ? walkGroup : idleGroup;
    if (!group) return [];

    const pat = group.pattern ?? {};
    const W = pat.width ?? 4; // direções
    const H = pat.height ?? 3; // passos (frames de caminhada)
    const D = pat.depth ?? 2; // profundidade (coluna esq/dir)
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
    const baseLocalIdx = ((step * D + depthIdx) * W + dirIdx) * L + baseLayer;
    const baseIdx = frame * perFrame + baseLocalIdx;

    const spriteId = ids[baseIdx];
    if (spriteId == null) return [];

    const spriteMeta = this.outfitsAtlas.data?.sprites?.[String(spriteId)];
    if (!spriteMeta) return [];

    const out = [
      {
        sheet: this.outfitsAtlas.image,
        info: {
          x: spriteMeta.x,
          y: spriteMeta.y,
          w: spriteMeta.w,
          h: spriteMeta.h,
        },
        colOffset: 0,
      },
    ];

    if (includeTintMask && L > 1) {
      const maskLocalIdx = ((step * D + depthIdx) * W + dirIdx) * L + maskLayer;
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

  // ═══════════════════════════════════════════════════════════════
  // EFFECTS — Sprites de efeitos de magia/combate (effects_atlas)
  // Retorna { sheet, info: {x,y,w,h} } para o frame atual
  // ═══════════════════════════════════════════════════════════════

  /**
   * Retorna o sprite do frame correto para um efeito animado.
   * @param {number} effectId - ID do efeito (chave em effects_data.json)
   * @param {number} elapsedMs - Tempo decorrido desde startTime do efeito
   * @returns {{ sheet: HTMLImageElement, info: {x,y,w,h} } | null}
   */
  getEffectSprite(effectId, elapsedMs = 0) {
    if (!this.hasEffectsAtlas()) return null;
    const def = this.effectsAtlas.data?.[String(effectId)];
    if (!def?.variants) return null;

    const phases = def.animation?.phases ?? [];
    const nFrames = def.n_frames ?? Object.keys(def.variants).length;
    let frame = nFrames - 1; // default: último frame (animação encerrada)

    if (phases.length > 0) {
      let t = 0;
      for (let i = 0; i < phases.length; i++) {
        t += phases[i].d_min ?? 100;
        if (elapsedMs < t) {
          frame = i;
          break;
        }
      }
    } else if (nFrames > 0) {
      // Sem fases: distribui uniformemente a cada 100ms
      frame = Math.min(nFrames - 1, Math.floor(elapsedMs / 100));
    }

    const variant = def.variants[String(frame)] ?? def.variants["0"];
    if (!variant) return null;

    return {
      sheet: this.effectsAtlas.image,
      info: { x: variant.x, y: variant.y, w: variant.w, h: variant.h },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FIELDS — Sprites de campos (veneno, fogo no chão, etc.)
  // Retorna array de { sheet, info: {x,y,w,h} }
  // ═══════════════════════════════════════════════════════════════

  /**
   * Retorna sprites para um campo (field) de magia.
   * @param {number} fieldSpriteId - sprite_id no fields_data.json
   * @param {number} [elapsedMs]
   * @param {Object} [context]
   * @returns {Array<{ sheet: HTMLImageElement, info: {x,y,w,h} }>}
   */
  getFieldSprites(fieldSpriteId, elapsedMs = 0, context = {}) {
    if (!this.hasFieldsAtlas()) return [];
    const atlasData = this.fieldsAtlas.data ?? {};
    const fieldDef = atlasData.fields?.[String(fieldSpriteId)];

    if (fieldDef?.groups?.length) {
      const group =
        fieldDef.groups.find(
          (entry) =>
            Array.isArray(entry?.sprite_ids) && entry.sprite_ids.length > 0,
        ) ?? fieldDef.groups[0];

      const pattern = group?.pattern ?? {};
      const spritesPerFrame = Math.max(
        1,
        Number(
          group?.sprites_per_frame ??
            (pattern.width ?? 1) *
              (pattern.height ?? 1) *
              (pattern.depth ?? 1) *
              (pattern.layers ?? 1),
        ),
      );
      const spriteIds = Array.isArray(group?.sprite_ids)
        ? group.sprite_ids
        : [];
      const nativeFrameCount = Math.max(
        1,
        Number(
          group?.n_frames ??
            Math.floor(spriteIds.length / spritesPerFrame) ??
            1,
        ),
      );
      const phaseIndex = this._getFieldStagePhaseIndex(
        nativeFrameCount,
        elapsedMs,
        context,
        group?.animation?.phases,
      );
      const variantIndex = this._getFieldVariantIndex(spritesPerFrame, context);
      const spriteId = spriteIds[phaseIndex * spritesPerFrame + variantIndex];
      const spriteMeta =
        spriteId != null ? atlasData.sprites?.[String(spriteId)] : null;

      if (spriteMeta) {
        return [
          {
            sheet: this.fieldsAtlas.image,
            info: {
              x: spriteMeta.x,
              y: spriteMeta.y,
              w: spriteMeta.w,
              h: spriteMeta.h,
            },
          },
        ];
      }
    }

    const sprite = atlasData.sprites?.[String(fieldSpriteId)];
    if (!sprite) return [];
    return [
      {
        sheet: this.fieldsAtlas.image,
        info: { x: sprite.x, y: sprite.y, w: sprite.w, h: sprite.h },
      },
    ];
  }

  /**
   * Retorna um sprite pelo ID numérico do item.
   * Tenta primeiro o pipeline novo (mapAtlasLookup) e depois os sprites legados.
   *
   * @param {number} itemId
   * @returns {{ sheet: HTMLImageElement, info: {x,y,w,h} } | null}
   */
  getSpriteById(itemId) {
    // 1. Pipeline novo (map atlas)
    const mapSprite = this.getMapSprite(itemId);
    if (mapSprite?.sheet) {
      return {
        sheet: mapSprite.sheet,
        info: {
          x: mapSprite.x,
          y: mapSprite.y,
          w: mapSprite.w,
          h: mapSprite.h,
        },
      };
    }
    // 2. Sprites legados carregados via loadSpriteSheet
    const legacy = this.sprites.get(Number(itemId));
    if (legacy?.sheet) {
      return {
        sheet: legacy.sheet,
        info: { x: legacy.x, y: legacy.y, w: legacy.w, h: legacy.h },
      };
    }
    return null;
  }

  /**
   * Retorna um sprite de um pack legado (monstros, outfits antigos).
   * Compatível com packs carregados via loadPack() — formato TexturePacker.
   *
   * @param {string} packName - Nome do pack (ex: "monstros_01")
   * @param {string} filename - Nome do frame (ex: "123.png")
   * @returns {{ sheet: HTMLImageElement, info: {x,y,w,h} } | null}
   */
  getSprite(packName, filename) {
    const p = this.packs[packName];
    if (!p?.data?.frames) return null;
    const frame = p.data.frames[filename];
    if (!frame) return null;
    // Suporta tanto { frame: {x,y,w,h} } (TexturePacker) quanto {x,y,w,h} direto
    const f = frame.frame ?? frame;
    return {
      sheet: p.image,
      info: { x: f.x, y: f.y, w: f.w, h: f.h },
    };
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
  get atlasCount() {
    return (this.mapAtlases?.length ?? 0) + Object.keys(this.packs).length;
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
