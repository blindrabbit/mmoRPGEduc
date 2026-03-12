async function loadImage(url) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${url}`));
    img.src = url;
  });
}

async function tryLoadAtlasPair(basePath, category, indexCandidates = ["00", "01", "02", "03"]) {
  for (const idx of indexCandidates) {
    const imageUrl = `${basePath}atlas_${category}_${idx}.png`;
    const metaUrl = `${basePath}atlas_${category}_${idx}.json`;
    try {
      const [img, meta] = await Promise.all([
        loadImage(imageUrl),
        fetch(metaUrl).then((r) => {
          if (!r.ok) throw new Error(`JSON não encontrado: ${metaUrl}`);
          return r.json();
        }),
      ]);
      return { img, meta, imageUrl, metaUrl };
    } catch {
      // tenta próximo candidato
    }
  }
  throw new Error(`Atlas da categoria '${category}' não encontrado`);
}

export class AtlasManager {
  constructor({ basePath = "./assets/" } = {}) {
    this.basePath = String(basePath).endsWith("/") ? String(basePath) : `${basePath}/`;
    this.loadedCategories = new Set();
    this.atlasCache = new Map();
    this.pendingLoads = new Map();
  }

  async loadCategory(category) {
    if (this.loadedCategories.has(category)) {
      return this.atlasCache.get(category);
    }

    if (this.pendingLoads.has(category)) {
      return this.pendingLoads.get(category);
    }

    const loadPromise = (async () => {
      const atlas = await tryLoadAtlasPair(this.basePath, category);
      this.atlasCache.set(category, atlas);
      this.loadedCategories.add(category);
      this.pendingLoads.delete(category);
      return atlas;
    })().catch((error) => {
      this.pendingLoads.delete(category);
      throw error;
    });

    this.pendingLoads.set(category, loadPromise);
    return loadPromise;
  }

  unloadUnused(usedCategories) {
    const used = usedCategories ?? new Set();
    for (const cat of [...this.loadedCategories]) {
      if (!used.has(cat)) {
        const atlas = this.atlasCache.get(cat);
        if (atlas?.img) {
          atlas.img.src = "";
          atlas.img = null;
        }
        this.atlasCache.delete(cat);
        this.loadedCategories.delete(cat);
      }
    }
  }

  clear() {
    this.unloadUnused(new Set());
    this.pendingLoads.clear();
  }
}
