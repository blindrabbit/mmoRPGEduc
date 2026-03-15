// ═══════════════════════════════════════════════════════════════
// assetLoader.js — Carregador de Assets (Pipeline Final)
// ✅ Carrega atlas segmentados do pipeline Python
// ✅ Fallback para formato legado
// ═══════════════════════════════════════════════════════════════

/**
Carrega todos os assets do jogo.
@param {AssetManager} assets — instância do gerenciador
@param {string} basePath     — caminho base (ex: "./assets/")
@param {string} mapPath      — caminho dos assets do mapa (ex: "./assets/")
*/
export async function loadAllSprites(
  assets,
  basePath = "./assets/",
  mapPath = "./assets/",
) {
  let total = 0;

  const normalizeBasePath = (path) => {
    const raw = String(path ?? "").trim();
    if (!raw) return "";
    return raw.endsWith("/") ? raw : `${raw}/`;
  };

  // ═══════════════════════════════════════════════════════════════
  // 1. CARREGAR ASSETS DO MAPA (PIPELINE PYTHON) — PRIORIDADE
  // ═══════════════════════════════════════════════════════════════
  if (typeof assets.loadMapAssets === "function") {
    const mapAlreadyLoaded =
      !!assets.mapAtlasLookup &&
      assets.mapAtlasLookup.size > 0 &&
      assets.mapData &&
      Object.keys(assets.mapData).length > 0;

    const mapLoaded = mapAlreadyLoaded
      ? true
      : await assets.loadMapAssets(mapPath);
    if (mapLoaded) {
      console.log(
        `[assetLoader] ✅ Assets do mapa carregados: ${assets.mapItemCount} itens`,
      );
      total += assets.mapItemCount;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. CARREGAR OUTFITS (PLAYERS)
  // ═══════════════════════════════════════════════════════════════
  try {
    const candidates = [
      normalizeBasePath(basePath),
      normalizeBasePath(mapPath),
      "./assets/",
      "./assets_novo/",
    ].filter(Boolean);

    const tried = new Set();
    let loadedFrom = null;

    for (const candidate of candidates) {
      if (tried.has(candidate)) continue;
      tried.add(candidate);

      const outfitsJsonCandidates = [
        `${candidate}outfits_players_data.json`,
        `${candidate}outfits_players_atlas.json`,
      ];
      const outfitsImg = `${candidate}outfits_players_atlas.png`;
      let outfitsJson = null;
      for (const jsonPath of outfitsJsonCandidates) {
        const outfitsRes = await fetch(jsonPath);
        if (outfitsRes.ok) {
          outfitsJson = jsonPath;
          break;
        }
      }
      if (!outfitsJson) continue;
      if (typeof assets.loadOutfitsAtlas !== "function") continue;

      const ok = await assets.loadOutfitsAtlas(outfitsImg, outfitsJson);
      if (ok) {
        loadedFrom = candidate;
        break;
      }
    }

    if (loadedFrom) {
      console.log(`[assetLoader] ✅ Outfits atlas carregado (${loadedFrom})`);
    } else {
      console.warn(
        "[assetLoader] ❌ Outfits atlas não carregado em nenhum caminho",
      );
    }
  } catch (e) {
    console.warn("[assetLoader] outfits atlas não carregado:", e?.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. CARREGAR EFFECTS (MAGIAS)
  // ═══════════════════════════════════════════════════════════════
  try {
    const effectsJson = `${basePath}effects_data.json`;
    const effectsImg = `${basePath}effects_atlas.png`;
    const effectsRes = await fetch(effectsJson);
    if (effectsRes.ok && typeof assets.loadEffectsAtlas === "function") {
      await assets.loadEffectsAtlas(effectsImg, effectsJson);
      console.log(`[assetLoader] ✅ Effects atlas carregado`);
    }
  } catch (e) {
    console.warn("[assetLoader] effects atlas não carregado:", e?.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. CARREGAR FIELDS (CAMPOS MÁGICOS)
  // ═══════════════════════════════════════════════════════════════
  try {
    const fieldsJson = `${basePath}fields_data.json`;
    const fieldsImg = `${basePath}fields_atlas.png`;
    const fieldsRes = await fetch(fieldsJson);
    if (fieldsRes.ok && typeof assets.loadFieldsAtlas === "function") {
      await assets.loadFieldsAtlas(fieldsImg, fieldsJson);
      console.log(`[assetLoader] ✅ Fields atlas carregado`);
    }
  } catch (e) {
    console.warn("[assetLoader] fields atlas não carregado:", e?.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. CARREGAR MONSTROS (LEGADO)
  // ═══════════════════════════════════════════════════════════════
  const prefixes = ["monstros"];
  for (const prefix of prefixes) {
    const id = "01";
    const name = `${prefix}_${id}`;
    const imagePath = `${basePath}${prefix}_${id}.png`;
    const jsonPath = `${basePath}${prefix}_${id}.json`;

    try {
      const res = await fetch(jsonPath);
      if (res.ok && typeof assets.loadPack === "function") {
        await assets.loadPack(name, imagePath, jsonPath);
        total++;
        console.log(`[assetLoader] ✅ Pack "${name}" carregado`);
      }
    } catch (error) {
      console.warn(`[assetLoader] Pack ${name} não encontrado`);
    }
  }

  console.log(`\n[assetLoader] 📦 RESUMO:`);
  console.log(`   • Itens de mapa: ${assets.mapItemCount}`);
  console.log(`   • Packs legados: ${assets.packCount}`);
  console.log(`   • Total: ${total + assets.mapItemCount} assets`);

  return total + assets.mapItemCount;
}

export async function loadPack(assets, name, basePath = "./assets/") {
  const packName = String(name || "");
  const isLegacyOutfitPack = packName.startsWith("outfits_");

  if (isLegacyOutfitPack) {
    if (assets?.hasOutfitsAtlas?.()) return true;
    console.warn(`[assetLoader] Pack legado ignorado: ${packName}`);
    return false;
  }

  await assets.loadPack(
    packName,
    `${basePath}${packName}.png`,
    `${basePath}${packName}.json`,
  );
  return true;
}
