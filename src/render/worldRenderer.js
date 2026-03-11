// ═══════════════════════════════════════════════════════════════
// worldRenderer.js — Pipeline de Renderização Completo (v2.0)
// ✅ Integrado com AssetManager do pipeline Python
// ✅ Suporta bounding_box, stack_position, render_layer
// ✅ Layer order corrigido: ground → wall → deco → top
// ✅ Entidades com outfits reais via AnimationController
// ═══════════════════════════════════════════════════════════════

import { TILE_SIZE, ENTITY_RENDER, GROUND_Z } from "../core/config.js";
import { renderMap } from "./mapRenderer.js";
import { getMonsters, getPlayers } from "../core/worldStore.js";
import { getMonsterTemplates } from "../core/remoteTemplates.js";
import {
  drawCorpses,
  drawVisualEffects,
  drawFloatingTexts,
} from "../gameplay/gameCore.js";

const PERF_WINDOW = 60;
const SLOW_FRAME_MS = 24;

function perfStep(perf, key, fn) {
  const t0 = performance.now();
  fn();
  perf[key] += performance.now() - t0;
}

function perfFlush(perf) {
  perf.frameCount += 1;
  if (perf.frameCount < PERF_WINDOW) return;

  const avgTotal = perf.total / PERF_WINDOW;
  if (avgTotal >= SLOW_FRAME_MS) {
    console.warn("[RenderPerf] avg frame", {
      avgTotalMs: +avgTotal.toFixed(1),
      mapBaseMs: +(perf.mapBase / PERF_WINDOW).toFixed(1),
      corpsesMs: +(perf.corpses / PERF_WINDOW).toFixed(1),
      fxGroundMs: +(perf.fxGround / PERF_WINDOW).toFixed(1),
      entitiesMs: +(perf.entities / PERF_WINDOW).toFixed(1),
      mapTallMs: +(perf.mapTall / PERF_WINDOW).toFixed(1),
      fxTopMs: +(perf.fxTop / PERF_WINDOW).toFixed(1),
      mapAboveMs: +(perf.mapAbove / PERF_WINDOW).toFixed(1),
      floatingMs: +(perf.floating / PERF_WINDOW).toFixed(1),
      mapTopMs: +(perf.mapTop / PERF_WINDOW).toFixed(1),
    });
  }

  perf.frameCount = 0;
  perf.total = 0;
  perf.mapBase = 0;
  perf.corpses = 0;
  perf.fxGround = 0;
  perf.entities = 0;
  perf.mapTall = 0;
  perf.fxTop = 0;
  perf.mapAbove = 0;
  perf.floating = 0;
  perf.mapTop = 0;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — Nomes e Cores de Vida
// ═══════════════════════════════════════════════════════════════
function toCamelCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.replace(/[_-]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function resolveDisplayName(ent, id, isMonster, remoteTemplates) {
  if (isMonster) {
    // Monstros devem exibir nome canônico da espécie/template.
    if (remoteTemplates && ent.species) {
      const tmpl = remoteTemplates[ent.species];
      if (tmpl && tmpl.name) return toCamelCase(tmpl.name);
    }
    if (ent.species) return toCamelCase(ent.species);
    if (ent.template) return toCamelCase(ent.template);
    if (ent.name) return toCamelCase(ent.name);
  } else {
    if (ent.name) return toCamelCase(ent.name);
    if (ent.template) return toCamelCase(ent.template);
    if (ent.species) return toCamelCase(ent.species);
  }
  if (typeof id === "string") {
    const parts = id.split("_");
    if (parts.length >= 2) return toCamelCase(parts[1]);
  }
  return toCamelCase(typeof id === "string" ? id.substring(0, 12) : "?");
}

function getHealthColor(pct) {
  pct = Math.max(0, Math.min(1, pct));
  let r, g, b;
  if (pct >= 0.75) {
    const t = (1 - pct) / 0.25;
    r = Math.floor(255 * t);
    g = 255;
    b = 0;
  } else if (pct >= 0.5) {
    const t = (0.75 - pct) / 0.25;
    r = 255;
    g = Math.floor(255 * (1 - t * 0.5));
    b = 0;
  } else if (pct >= 0.25) {
    const t = (0.5 - pct) / 0.25;
    r = 255;
    g = Math.floor(127 * (1 - t));
    b = 0;
  } else {
    const t = (0.25 - pct) / 0.25;
    r = Math.floor(255 * (1 - t));
    g = 0;
    b = 0;
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
// RENDER DE ENTIDADES — Dois passes (sprites + labels)
// ═══════════════════════════════════════════════════════════════
function renderEntitiesFull(
  ctx,
  entities,
  assets,
  anim,
  camX,
  camY,
  activeZ,
  ts,
  {
    showHP = true,
    showName = true,
    renderMode = "high",
    remoteTemplates = null,
  },
) {
  const visible = [];

  // ── Pass 1: Sprites/Corpos ───────────────────────────────────
  for (const id in entities) {
    const ent = entities[id];
    if (!ent || ent.dead) continue;

    const activeZNum = Number(activeZ);
    const entZNumRaw = Number(ent.z);
    const entZNum = Number.isFinite(entZNumRaw)
      ? entZNumRaw
      : Number.isFinite(activeZNum)
        ? activeZNum
        : 7;
    const floorRef = Number.isFinite(activeZNum) ? activeZNum : 7;
    if (entZNum !== floorRef) continue;

    if (ent.x == null || ent.y == null) continue;

    const safeEnt =
      ent.oldX == null ? { ...ent, oldX: ent.x, oldY: ent.y } : ent;

    const vPos =
      assets && anim
        ? anim.getVisualPos(safeEnt)
        : { x: ent.x * TILE_SIZE, y: ent.y * TILE_SIZE };

    const drawX = Math.round(vPos.x - camX + TILE_SIZE / 2);
    const drawY = Math.round(vPos.y - camY + TILE_SIZE / 2);
    const labelX = Math.round(
      vPos.x -
        camX +
        TILE_SIZE / 2 +
        ENTITY_RENDER.offsetX +
        ENTITY_RENDER.labelOffsetX,
    );
    const spriteTopY = Math.round(
      vPos.y -
        camY +
        Math.round(TILE_SIZE * ENTITY_RENDER.footAnchorY) -
        TILE_SIZE +
        ENTITY_RENDER.offsetY,
    );

    // Culling
    if (
      drawX < -64 ||
      drawX > ctx.canvas.width + 64 ||
      drawY < -64 ||
      drawY > ctx.canvas.height + 64
    )
      continue;

    const isMonster =
      ent.type === "monster" ||
      typeof ent.species === "string" ||
      (typeof id === "string" && id.startsWith("mob"));
    const isAdminEnt = ent.id === "GMADMIN" || ent.appearance?.isAdmin;

    // Resolve pack e outfitId
    const defaultPack = isMonster ? "monstros_01" : "outfits_01";
    let pack = ent.appearance?.outfitPack || defaultPack;
    let outfitId =
      ent.appearance?.outfitId ??
      ent.species ??
      ent.template ??
      (isMonster ? "rat" : 10000);

    // Fallback de pack se não carregado
    let resolvedPack = pack;
    if (assets?.hasPack && !assets.hasPack(resolvedPack)) {
      const fallback = isMonster ? "monstros_01" : "outfits_01";
      if (assets.hasPack(fallback)) resolvedPack = fallback;
    }

    // Fallback de outfitId para players: se o ID não existe no atlas, usa 128
    if (
      !isMonster &&
      assets?.hasOutfitsAtlas?.() &&
      !assets.hasOutfitDefinition(outfitId)
    ) {
      outfitId = 128;
    }

    const canSprite =
      assets &&
      anim &&
      renderMode !== "low" &&
      ((isMonster && assets.hasPack(resolvedPack)) ||
        (!isMonster &&
          assets.hasOutfitsAtlas() &&
          assets.hasOutfitDefinition(outfitId)));

    let spriteDrawn = false;
    if (canSprite) {
      const entForDraw = {
        ...safeEnt,
        appearance: {
          ...(safeEnt.appearance || {}),
          outfitPack: resolvedPack,
          outfitId,
        },
      };
      spriteDrawn =
        anim.drawManual(ctx, assets, entForDraw, vPos.x, vPos.y, camX, camY) ===
        true;
    }

    if (!spriteDrawn) {
      // Fallback: círculo colorido (quando sprite não pôde ser desenhado)
      ctx.beginPath();
      ctx.arc(drawX, drawY, isMonster ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = isAdminEnt
        ? "#3c9de7"
        : isMonster
          ? "#e74c3c"
          : "#2ecc71";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Guarda dados para o pass 2 (labels)
    visible.push({ id, ent, drawX, drawY, labelX, spriteTopY, isMonster });
  }

  // ── Pass 2: HP bars + Nomes (sempre por cima) ─────────────────
  for (const {
    id,
    ent,
    drawX,
    drawY,
    labelX,
    spriteTopY,
    isMonster,
  } of visible) {
    const hp = ent.stats?.hp ?? 100;
    const maxHp = ent.stats?.maxHp ?? 100;

    // HP Bar
    if (showHP && maxHp) {
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      const bw = TILE_SIZE,
        bh = 4;
      const bx = labelX - TILE_SIZE / 2;
      const by = spriteTopY + ENTITY_RENDER.labelBarY;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = getHealthColor(pct);
      ctx.fillRect(
        bx + 1,
        by + 1,
        Math.max(1, Math.round((bw - 2) * pct)),
        bh - 2,
      );
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(bx, by, bw, bh);
    }

    // Nome
    if (showName) {
      const displayName = resolveDisplayName(
        ent,
        id,
        isMonster,
        remoteTemplates,
      );
      if (displayName) {
        const pct = Math.max(0, Math.min(1, hp / maxHp));
        const nameY = spriteTopY + ENTITY_RENDER.labelNameY;
        ctx.save();
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText(displayName, labelX, nameY);
        ctx.fillStyle = getHealthColor(pct);
        ctx.fillText(displayName, labelX, nameY);
        ctx.restore();
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE PRINCIPAL — Renderização do Mundo
// ═══════════════════════════════════════════════════════════════
export function renderWorld({
  ctx,
  camX,
  camY,
  activeZ,
  animClock,
  ts,
  canvasW,
  canvasH,
  cols,
  rows,
  map,
  assets, // ✅ AssetManager com loadMapAssets()
  anim,
  floorIndex = null,
  roofFadeRadius = 0,
  extraEntities = {},
  renderOptions = { showHP: true, showName: true, renderMode: "high" },
}) {
  const { showHP, showName } = renderOptions;
  const remoteTemplates = getMonsterTemplates();
  const perfEnabled = window.DEBUG_RENDER_PERF === true;
  const perf = perfEnabled
    ? (window.__renderPerf ??= {
        frameCount: 0,
        total: 0,
        mapBase: 0,
        corpses: 0,
        fxGround: 0,
        entities: 0,
        mapTall: 0,
        fxTop: 0,
        mapAbove: 0,
        floating: 0,
        mapTop: 0,
      })
    : null;
  const frameStart = perfEnabled ? performance.now() : 0;
  const lockTarget = renderOptions.lockTarget ?? null;
  const renderMode = renderOptions.renderMode ?? renderOptions.mode ?? "high";
  const isPlayerView =
    renderOptions.isPlayer === true || renderOptions.viewMode === "player";
  const entitiesOnTop = renderOptions.entitiesOnTop ?? isPlayerView;
  const mapTallBeforeEntities =
    renderOptions.mapTallBeforeEntities ?? entitiesOnTop;
  const upperFloorsBeforeEntities =
    renderOptions.upperFloorsBeforeEntities ?? entitiesOnTop;
  const topDecorBeforeEntities =
    renderOptions.topDecorBeforeEntities ?? entitiesOnTop;
  const labelsSameFloorOnly = renderOptions.labelsSameFloorOnly ?? isPlayerView;
  const showUpperFloors = renderOptions.showUpperFloors ?? true;
  const showTopDecor = renderOptions.showTopDecor ?? true;

  const camera = { x: camX / TILE_SIZE, y: camY / TILE_SIZE };
  const camXWorld = camX;
  const camYWorld = camY;

  // Y-sort: linha de tile aproximada do player (câmera centrada no player)
  // Tiles com ty > focusTileY estão "na frente" do player e devem cobri-lo.
  const focusTileY = isPlayerView
    ? Math.floor(camY / TILE_SIZE + rows / 2)
    : null;

  // ✅ Base para renderMap — passa AssetManager
  const _mapBase = {
    ctx,
    atlas: null, // ← Não usar mais (usar assets.mapAtlases)
    nexoData: null, // ← Não usar mais (usar assets.mapData)
    map,
    floorIndex,
    camera,
    activeZ,
    animClock,
    canvasW,
    canvasH,
    cols,
    rows,
    roofFadeRadius,
    forceObstacleOverlay: true,
    assets, // ✅ NOVO: passar AssetManager para getMapSprite()
  };

  // Helpers para filtragem de sprites por layer
  const isFlat = (spriteMeta) =>
    (spriteMeta?.grid_size ?? TILE_SIZE) <= TILE_SIZE;
  const blocksPlayer = (spriteMeta) =>
    spriteMeta?.game?.is_walkable === false ||
    spriteMeta?.flags_raw?.unpass === true ||
    spriteMeta?.game?.category_type === "wall";
  const isOccluder = (spriteMeta) => {
    const category = String(
      spriteMeta?.game?.category_type ?? "",
    ).toLowerCase();
    if (blocksPlayer(spriteMeta)) return true;
    if (
      ["wall", "tree", "vegetation", "flora", "foliage", "building"].includes(
        category,
      )
    )
      return true;
    return (spriteMeta?.grid_size ?? TILE_SIZE) > TILE_SIZE;
  };

  const drawLayer2IfFlat = (_spriteId, spriteMeta, info) => {
    if (info?.renderLayer !== 2) return true;
    return isFlat(spriteMeta);
  };

  const drawOnlyLayer2IfTallPre = (_spriteId, spriteMeta, info) => {
    if (info?.renderLayer !== 2) return false;
    return !isFlat(spriteMeta) && !isOccluder(spriteMeta);
  };

  // Predicate para step 6.25: redesenhá tiles occluders APÓS as entidades.
  // Não usa info.renderLayer (nunca é setado pelo mapRenderer).
  // Y-sort: só redesenha tiles cujo ty > focusTileY (na frente do player).
  // Em view admin (focusTileY=null), redesenha todos os occluders após entidades.
  const drawOccluderAfterEntities = (_spriteId, spriteMeta, info) => {
    if (isFlat(spriteMeta) || !isOccluder(spriteMeta)) return false;
    if (focusTileY === null) return true;
    return (info?.ty ?? 0) > focusTileY;
  };

  const drawLayer3Pre = (_spriteId, spriteMeta, info) => {
    if (info?.renderLayer !== 3) return true;
    return !isOccluder(spriteMeta);
  };

  const drawLayer3Post = (_spriteId, spriteMeta, info) => {
    if (info?.renderLayer !== 3) return false; // ← era true (bug: desenhava tudo)
    return isOccluder(spriteMeta);
  };

  // ── 1. Mapa base (andar ativo e abaixo) — layers 0-2, só flat ──
  if (perfEnabled) {
    perfStep(perf, "mapBase", () => {
      renderMap({
        ..._mapBase,
        layerMin: 0,
        layerMax: 2,
        zPredicate: (z, _dz, aZ) => z >= aZ,
        spritePredicate: drawLayer2IfFlat,
      });
    });
  } else {
    renderMap({
      ..._mapBase,
      layerMin: 0,
      layerMax: 2,
      zPredicate: (z, _dz, aZ) => z >= aZ,
      spritePredicate: drawLayer2IfFlat,
    });
  }

  // ── 2. Cadáveres ──────────────────────────────────────────────
  if (perfEnabled) {
    perfStep(perf, "corpses", () => {
      drawCorpses?.(ctx, assets, camXWorld, camYWorld, ts);
    });
  } else {
    drawCorpses?.(ctx, assets, camXWorld, camYWorld, ts);
  }

  // ── 3. Efeitos de chão ────────────────────────────────────────
  if (perfEnabled) {
    perfStep(perf, "fxGround", () => {
      drawVisualEffects?.(ctx, assets, camXWorld, camYWorld, "ground");
    });
  } else {
    drawVisualEffects?.(ctx, assets, camXWorld, camYWorld, "ground");
  }

  // ── 4. Layer 2 alta (paredes/árvores altas) ──────────────────
  if (mapTallBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapTall", () => {
        renderMap({
          ..._mapBase,
          layerMin: 2,
          layerMax: 2,
          clearCanvas: false,
          zPredicate: (z, _dz, aZ) => z === aZ,
          spritePredicate: drawOnlyLayer2IfTallPre,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 2,
        layerMax: 2,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: drawOnlyLayer2IfTallPre,
      });
    }
  }

  // ── 4.5 Mapa de andares acima (z < activeZ) — layers 0-2 ────
  // Em player view, desenha ANTES das entidades para não cobrir o player.
  if (showUpperFloors && upperFloorsBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapAbove", () => {
        renderMap({
          ..._mapBase,
          layerMin: 0,
          layerMax: 2,
          clearCanvas: false,
          zPredicate: (z, _dz, aZ) => z < aZ,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 0,
        layerMax: 2,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z < aZ,
      });
    }
  }

  // ── 4.6 Mapa — layer 3 (top_decoration: copas, telhados) ─────
  // Em player view, desenha ANTES das entidades para não cobrir o player.
  if (showTopDecor && topDecorBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapTop", () => {
        renderMap({
          ..._mapBase,
          layerMin: 3,
          layerMax: 3,
          clearCanvas: false,
          zPredicate: (z, _dz, aZ) => z === aZ,
          spritePredicate: drawLayer3Pre,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 3,
        layerMax: 3,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: drawLayer3Pre,
      });
    }
  }

  // ── 5. Entidades (players, monstros) ─────────────────────────
  // REORDENADO: Agora renderiza DEPOIS do mapTall
  // para que players fiquem ACIMA dos tiles altos
  let allEntities;
  if (Object.keys(extraEntities).length > 0) {
    allEntities = extraEntities;
  } else {
    const livingMonsters = {};
    const monsters = getMonsters();
    for (const id in monsters) {
      const m = monsters[id];
      if (m && !m.dead && m.type !== "corpse") livingMonsters[id] = m;
    }
    allEntities = { ...livingMonsters, ...getPlayers() };
  }

  // 5.1 Marcador de lock target (ABAIXO dos sprites)
  if (lockTarget?.id) {
    const locked = allEntities?.[lockTarget.id];
    if (locked && !locked.dead && (locked.z ?? 7) === activeZ) {
      const px = Math.round(locked.x * TILE_SIZE - camXWorld);
      const py = Math.round(locked.y * TILE_SIZE - camYWorld);
      ctx.save();
      ctx.strokeStyle = "#ff2e2e";
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.restore();
    }
  }

  if (perfEnabled) {
    perfStep(perf, "entities", () => {
      renderEntitiesFull(
        ctx,
        allEntities,
        assets,
        anim,
        camXWorld,
        camYWorld,
        activeZ,
        ts,
        { showHP, showName, renderMode, labelsSameFloorOnly, remoteTemplates },
      );
    });
  } else {
    renderEntitiesFull(
      ctx,
      allEntities,
      assets,
      anim,
      camXWorld,
      camYWorld,
      activeZ,
      ts,
      { showHP, showName, renderMode, labelsSameFloorOnly, remoteTemplates },
    );
  }

  // ── 6. Efeitos de topo (magias, sangue) ──────────────────────
  if (perfEnabled) {
    perfStep(perf, "fxTop", () => {
      drawVisualEffects?.(ctx, assets, camXWorld, camYWorld, "top");
    });
  } else {
    drawVisualEffects?.(ctx, assets, camXWorld, camYWorld, "top");
  }

  // ── 6.25 Occluders altos (paredes/árvores) redesenhados APÓS entidades ──
  // skipGroundPass=true evita que o ground pass do renderMap redesenhe tiles
  // de chão por cima do player (o ground já foi desenhado no step 1).
  // Y-sort via drawOccluderAfterEntities: só redesenha occluders cujo
  // ty > focusTileY (visualmente na frente do player).
  if (perfEnabled) {
    perfStep(perf, "mapTall", () => {
      renderMap({
        ..._mapBase,
        layerMin: 2,
        layerMax: 2,
        clearCanvas: false,
        skipGroundPass: true,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: drawOccluderAfterEntities,
      });
    });
  } else {
    renderMap({
      ..._mapBase,
      layerMin: 2,
      layerMax: 2,
      clearCanvas: false,
      skipGroundPass: true,
      zPredicate: (z, _dz, aZ) => z === aZ,
      spritePredicate: drawOccluderAfterEntities,
    });
  }

  // ── 6.5 Mapa de andares acima (z < activeZ) — layers 0-2 ────
  // Fora do player view, mantém desenho após entidades.
  if (showUpperFloors && !upperFloorsBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapAbove", () => {
        renderMap({
          ..._mapBase,
          layerMin: 0,
          layerMax: 2,
          clearCanvas: false,
          zPredicate: (z, _dz, aZ) => z < aZ,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 0,
        layerMax: 2,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z < aZ,
      });
    }
  }

  // ── 7. Textos flutuantes ─────────────────────────────────────
  if (perfEnabled) {
    perfStep(perf, "floating", () => {
      drawFloatingTexts?.(ctx, camXWorld, camYWorld);
    });
  } else {
    drawFloatingTexts?.(ctx, camXWorld, camYWorld);
  }

  // ── 8. Mapa — layer 3 (top_decoration: copas, telhados) ──────
  // skipGroundPass=true: evita que o ground pass redesenhe tiles de chão
  // por cima do player (já desenhados no step 1).
  if (showTopDecor && !topDecorBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapTop", () => {
        renderMap({
          ..._mapBase,
          layerMin: 3,
          layerMax: 3,
          clearCanvas: false,
          skipGroundPass: true,
          zPredicate: (z, _dz, aZ) => z === aZ,
          spritePredicate: drawLayer3Post,
        });
      });
      perf.total += performance.now() - frameStart;
      perfFlush(perf);
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 3,
        layerMax: 3,
        clearCanvas: false,
        skipGroundPass: true,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: drawLayer3Post,
      });
    }
  } else if (perfEnabled) {
    perf.total += performance.now() - frameStart;
    perfFlush(perf);
  }
}
