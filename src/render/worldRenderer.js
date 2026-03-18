// ═══════════════════════════════════════════════════════════════
// worldRenderer.js — Pipeline de Renderização Completo (v2.0)
// ✅ Integrado com AssetManager do pipeline Python
// ✅ Suporta bounding_box, stack_position, render_layer
// ✅ Layer order corrigido: ground → wall → deco → top
// ✅ Entidades com outfits reais via AnimationController
// ═══════════════════════════════════════════════════════════════

import {
  TILE_SIZE,
  ENTITY_RENDER,
  GROUND_Z,
  UNIFIED_RENDER_OPTIONS,
} from "../core/config.js";
import { canSeeFloor, getVisibleFloors } from "../core/floorVisibility.js";
import { renderMap, getTileDrawElevation } from "./mapRenderer.js";
import { sortEntitiesForRender } from "../core/renderOrder.js";
import { STACK_POSITION } from "../core/stackPosition.js";
import { VIEW_CONFIG } from "./viewCulling.js";
import { ObjectPool } from "../core/objectPool.js";
import { getMonsters, getPlayers } from "../core/worldStore.js";
import { getMonsterTemplates } from "../core/remoteTemplates.js";
import {
  drawCorpses,
  drawVisualEffects,
  drawFloatingTexts,
} from "../gameplay/gameCore.js";

const PERF_WINDOW = 60;
const SLOW_FRAME_MS = 24;
const _visibleEntityPool = new ObjectPool(
  () => ({
    id: null,
    ent: null,
    entZ: 0,
    drawX: 0,
    drawY: 0,
    labelX: 0,
    spriteTopY: 0,
    isMonster: false,
  }),
  (it) => {
    it.id = null;
    it.ent = null;
    it.entZ = 0;
    it.drawX = 0;
    it.drawY = 0;
    it.labelX = 0;
    it.spriteTopY = 0;
    it.isMonster = false;
  },
);

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
    map = null,
    floorIndex = null,
    mapData = null,
    showHP = UNIFIED_RENDER_OPTIONS.showHP,
    showName = UNIFIED_RENDER_OPTIONS.showName,
    labelsSameFloorOnly = UNIFIED_RENDER_OPTIONS.labelsSameFloorOnly,
    showBodiesAcrossVisibleFloors = UNIFIED_RENDER_OPTIONS.showBodiesAcrossVisibleFloors,
    renderMode = UNIFIED_RENDER_OPTIONS.renderMode,
    remoteTemplates = null,
  },
) {
  const visible = [];
  // Single timestamp for the whole frame — all entities animate consistently.
  const frameNow = Date.now();
  const activeZNum = Number(activeZ);
  const floorRef = Number.isFinite(activeZNum) ? activeZNum : 7;

  // View-radius pre-filter: skip entities clearly outside the visible area.
  // Uses canvas center as observer and expands by VIEW_CONFIG.radius beyond the canvas edge.
  const _halfW = ctx.canvas.width / (2 * TILE_SIZE);
  const _halfH = ctx.canvas.height / (2 * TILE_SIZE);
  const _observer = {
    x: camX / TILE_SIZE + _halfW,
    y: camY / TILE_SIZE + _halfH,
    z: activeZ,
  };
  const _viewRadius = Math.ceil(Math.max(_halfW, _halfH)) + VIEW_CONFIG.radius;
  const _cullConfig = { radius: _viewRadius };

  const normalizedEntities = Object.entries(entities ?? {})
    .filter(([, ent]) => {
      if (!ent) return false;
      const entZRaw = Number(ent.z);
      const entZ = Number.isFinite(entZRaw) ? entZRaw : floorRef;
      if (showBodiesAcrossVisibleFloors) {
        if (!canSeeFloor(floorRef, entZ)) return false;
      } else if (entZ !== floorRef) {
        return false;
      }
      const dx = Math.abs(Number(ent.x) - Number(_observer.x));
      const dy = Math.abs(Number(ent.y) - Number(_observer.y));
      return dx <= _cullConfig.radius && dy <= _cullConfig.radius;
    })
    .map(([id, ent]) => {
      const isMonsterLike =
        ent?.type === "monster" ||
        typeof ent?.species === "string" ||
        (typeof id === "string" && id.startsWith("mob"));
      return {
        ...(ent ?? {}),
        _entityId: id,
        category: "creature",
        stackPosition: Number.isFinite(Number(ent?.stackPosition))
          ? Number(ent.stackPosition)
          : isMonsterLike
            ? STACK_POSITION.CREATURE_FIRST + 2
            : STACK_POSITION.CREATURE_FIRST + 1,
      };
    });
  const sortedEntities = sortEntitiesForRender(normalizedEntities, activeZ);

  // ── Pass 1: Sprites/Corpos ───────────────────────────────────
  for (const ent of sortedEntities) {
    const id = ent?._entityId;
    if (!ent || ent.dead) continue;

    const entZNumRaw = Number(ent.z);
    const entZNum = Number.isFinite(entZNumRaw)
      ? entZNumRaw
      : Number.isFinite(floorRef)
        ? floorRef
        : 7;
    if (showBodiesAcrossVisibleFloors) {
      if (!canSeeFloor(floorRef, entZNum)) continue;
    } else if (entZNum !== floorRef) {
      continue;
    }

    if (ent.x == null || ent.y == null) continue;

    const safeEnt =
      ent.oldX == null ? { ...ent, oldX: ent.x, oldY: ent.y } : ent;

    const vPos =
      assets && anim
        ? anim.getVisualPos(safeEnt, frameNow)
        : { x: ent.x * TILE_SIZE, y: ent.y * TILE_SIZE };
    const floorOffsetSqm = entZNum < floorRef ? floorRef - entZNum : 0;
    const floorOffsetPx = floorOffsetSqm * TILE_SIZE;
    const floorShiftedVPos =
      floorOffsetPx > 0
        ? { x: vPos.x - floorOffsetPx, y: vPos.y - floorOffsetPx }
        : vPos;

    const tileElevation = getTileDrawElevation({
      map,
      floorIndex,
      nexoData: mapData,
      x: ent.x,
      y: ent.y,
      z: entZNum,
    });

    const elevatedVPos =
      tileElevation > 0
        ? {
            x: floorShiftedVPos.x - tileElevation,
            y: floorShiftedVPos.y - tileElevation,
          }
        : floorShiftedVPos;

    const drawX = Math.round(elevatedVPos.x - camX + TILE_SIZE / 2);
    const drawY = Math.round(elevatedVPos.y - camY + TILE_SIZE / 2);
    const labelX = Math.round(
      elevatedVPos.x -
        camX +
        TILE_SIZE / 2 +
        ENTITY_RENDER.offsetX +
        ENTITY_RENDER.labelOffsetX,
    );
    const spriteTopY = Math.round(
      elevatedVPos.y -
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
        anim.drawManual(
          ctx,
          assets,
          entForDraw,
          elevatedVPos.x,
          elevatedVPos.y,
          camX,
          camY,
          frameNow,
        ) === true;
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
    const row = _visibleEntityPool.acquire();
    row.id = id;
    row.ent = ent;
    row.entZ = entZNum;
    row.drawX = drawX;
    row.drawY = drawY;
    row.labelX = labelX;
    row.spriteTopY = spriteTopY;
    row.isMonster = isMonster;
    visible.push(row);
  }

  // ── Pass 2: HP bars + Nomes (sempre por cima) ─────────────────
  for (const {
    id,
    ent,
    entZ,
    drawX,
    drawY,
    labelX,
    spriteTopY,
    isMonster,
  } of visible) {
    if (labelsSameFloorOnly && entZ !== floorRef) continue;

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

  _visibleEntityPool.releaseMany(visible);
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
  clearColor = "#111", // null = fundo transparente (WorldEngine)
  extraEntities = {},
  renderOptions = UNIFIED_RENDER_OPTIONS,
}) {
  const opts = { ...UNIFIED_RENDER_OPTIONS, ...(renderOptions ?? {}) };
  const { showHP, showName } = opts;
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
  const lockTarget = opts.lockTarget ?? null;
  const renderMode = opts.renderMode ?? opts.mode ?? "high";
  const entitiesOnTop = opts.entitiesOnTop;
  const mapTallBeforeEntities = opts.mapTallBeforeEntities;
  const upperFloorsBeforeEntities = opts.upperFloorsBeforeEntities;
  const topDecorBeforeEntities = opts.topDecorBeforeEntities;
  const labelsSameFloorOnly = opts.labelsSameFloorOnly;
  const showBodiesAcrossVisibleFloors = opts.showBodiesAcrossVisibleFloors;
  const useFrontOcclusionSort = opts.useFrontOcclusionSort;
  const showUpperFloors = opts.showUpperFloors;
  const showTopDecor = opts.showTopDecor;

  const camera = { x: camX / TILE_SIZE, y: camY / TILE_SIZE };
  const camXWorld = camX;
  const camYWorld = camY;
  const upperVisibleFloors = getVisibleFloors(activeZ).filter(
    (z) => z < activeZ,
  );
  const enforceStrictFloorPriority = upperVisibleFloors.length > 0;

  // Y-sort: linha de tile aproximada do player (câmera centrada no player)
  // Tiles com ty > focusTileY estão "na frente" do player e devem cobri-lo.
  const focusTileY = useFrontOcclusionSort
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
    clearColor,
    forceObstacleOverlay: true,
    assets, // ✅ NOVO: passar AssetManager para getMapSprite()
  };

  // Helpers para filtragem de sprites por layer
  // Verifica se o sprite é visualmente plano (não excede a altura de 1 tile).
  // Usa a altura real do sprite (variants["0"].h) quando disponível, pois
  // grid_size pode refletir bounding box de colisão e não a altura visual.
  // Ex: ID 2910 tem grid_size=53 mas h=32 → plano; ID 2156 tem h=64 → alto.
  // Verifica se o sprite é visualmente plano (não excede a altura de 1 tile).
  // Usa a altura real do sprite (variants["0"].h) quando disponível, pois
  // grid_size pode refletir bounding box de colisão e não a altura visual.
  // Ex: ID 2910 tem grid_size=53 mas h=32 → plano; ID 2156 tem h=64 → alto.
  // Itens com flag "hang" (pendurados em parede) são sempre tratados como planos:
  // sua âncora visual é a parede, não o tile abaixo, e nunca devem sobrepor andares superiores.
  const isFlat = (spriteMeta) => {
    if (spriteMeta?.flags_raw?.hang) return true;
    const variantH = Number(spriteMeta?.variants?.["0"]?.h ?? 0);
    if (variantH > 0) return variantH <= TILE_SIZE;
    return (spriteMeta?.grid_size ?? TILE_SIZE) <= TILE_SIZE;
  };
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

  // ── Pipeline de Renderização — Ordem OTClient ──────────────────────────────
  //
  // OTClient renderiza por andar (painter's algorithm), por tile, nesta ordem:
  //   ground → groundBorder → bottom → common (reverse stack) → creature → top
  //
  // Regras fundamentais:
  //   • Top items do andar ativo ficam ACIMA das entidades (creatures)
  //   • Qualquer tile do andar superior (Z-1) fica ACIMA de tudo do andar ativo
  //
  // Nossa implementação replica isso com a seguinte ordem:
  //   1. Andar ativo (Z=7): TUDO incluindo top items (desenho inicial)
  //   2. Cadáveres, efeitos de chão
  //   3. Entidades (player/monstros)
  //   4. Y-sort: occluders na frente do player (redesenhados após entidades)
  //   5. REDRAW top items do andar ativo ← segundo desenho, APÓS entidades
  //      (sobrepõe pixels do step 1 para garantir copa > player)
  //   6. World items (tileLayer=99)
  //   7. Andares superiores (Z=6, Z=5…) ← COBREM top items via painter's algorithm
  //   8. Efeitos de topo, textos flutuantes
  //
  // Isso garante: Z=7 top items > Z=7 entities E Z=6 ground > Z=7 top items.

  const _upperFloors = showUpperFloors
    ? getVisibleFloors(activeZ).filter((z) => z < activeZ)
    : [];

  // ── 1. Andar ativo — todos os itens (incluindo top items) ────────────────
  // Top items (category="top" / renderLayer=3) são desenhados aqui E depois
  // redesenhados no step 5, APÓS entidades. O segundo desenho no step 5 sobrepõe
  // os pixels do step 1, mas ocorre DEPOIS do player → copa aparece SOBRE o player.
  // Esta abordagem replica o OTClient: tiles desenhados inteiros, depois creature,
  // depois top items novamente por cima de tudo.
  // Single-floor usa drawLayer2IfFlat para y-sort de items altos (steps 4/6.25).
  if (perfEnabled) {
    perfStep(perf, "mapBase", () => {
      renderMap({
        ..._mapBase,
        clearCanvas: true,
        layerMin: 0,
        layerMax: 3,
        zPredicate: (fz) => fz === activeZ,
        spritePredicate: enforceStrictFloorPriority
          ? null  // Desenha tudo — top items redesenhados após entidades no step 5
          : drawLayer2IfFlat,
      });
    });
  } else {
    renderMap({
      ..._mapBase,
      clearCanvas: true,
      layerMin: 0,
      layerMax: 3,
      zPredicate: (fz) => fz === activeZ,
      spritePredicate: enforceStrictFloorPriority
        ? null  // Desenha tudo — top items redesenhados após entidades no step 5
        : drawLayer2IfFlat,
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

  // ── 4. Layer 2 alta antes das entidades (single-floor, y-sort) ───────────
  // Em multi-floor o step 1 usa category!="top", que ainda inclui renderLayer=2
  // tall items — eles serão redesenhados com y-sort no step 4.5.
  // Em single-floor, drawLayer2IfFlat bloqueou tall items no step 1; aqui
  // desenhamos apenas os que devem aparecer ANTES do player (drawOnlyLayer2IfTallPre).
  if (!enforceStrictFloorPriority && mapTallBeforeEntities) {
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

  // ── 4.5 Top items antes das entidades (topDecorBeforeEntities=true) ───────
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
        {
          map,
          floorIndex,
          mapData: assets?.mapData ?? null,
          showHP,
          showName,
          renderMode,
          labelsSameFloorOnly,
          showBodiesAcrossVisibleFloors,
          remoteTemplates,
        },
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
      {
        map,
        floorIndex,
        mapData: assets?.mapData ?? null,
        showHP,
        showName,
        renderMode,
        labelsSameFloorOnly,
        showBodiesAcrossVisibleFloors,
        remoteTemplates,
      },
    );
  }

  // ── 4.6 / 5.5 Y-sort: occluders altos redesenhados APÓS entidades ─────────
  // Occluders (paredes, troncos) na frente do player cobrem a entidade.
  // Funciona em ambos os modos: focusTileY=null → redesenha tudo (view admin).
  // Multi-floor: usa >= (inclui tile do player); single-floor: usa > (original).
  if (perfEnabled) {
    perfStep(perf, "mapTall", () => {
      renderMap({
        ..._mapBase,
        layerMin: 2,
        layerMax: 2,
        clearCanvas: false,
        skipGroundPass: true,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: enforceStrictFloorPriority
          ? (_id, spriteMeta, info) => {
              if (isFlat(spriteMeta) || !isOccluder(spriteMeta)) return false;
              if (focusTileY === null) return true;
              return (info?.ty ?? 0) >= focusTileY;
            }
          : drawOccluderAfterEntities,
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
      spritePredicate: enforceStrictFloorPriority
        ? (_id, spriteMeta, info) => {
            if (isFlat(spriteMeta) || !isOccluder(spriteMeta)) return false;
            if (focusTileY === null) return true;
            return (info?.ty ?? 0) >= focusTileY;
          }
        : drawOccluderAfterEntities,
    });
  }

  // ── 5. Redraw top items do andar ativo APÓS entidades — ANTES dos andares superiores
  // ─────────────────────────────────────────────────────────────────────────────
  // Top items foram desenhados no step 1 (antes do player), mas precisam aparecer
  // ACIMA do player. Ao redesenhá-los AQUI, após renderEntitiesFull, o segundo
  // desenho sobrepõe os pixels do player — resultado final: copa > player.
  //
  // O step 6 (andares superiores) ocorre DEPOIS, garantindo: Z=6 ground > Z=7 top.
  //
  // Captura tanto renderLayer=3 quanto category="top" com renderLayer=2 (edge case).
  if (showTopDecor && !topDecorBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapTop", () => {
        renderMap({
          ..._mapBase,
          layerMin: 2,
          layerMax: 3,
          clearCanvas: false,
          skipGroundPass: true,
          zPredicate: (z, _dz, aZ) => z === aZ,
          spritePredicate: (_id, _meta, info) => {
            if (info?.renderLayer === 3) return true;
            return info?.category === "top" && info?.renderLayer === 2;
          },
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 2,
        layerMax: 3,
        clearCanvas: false,
        skipGroundPass: true,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: (_id, _meta, info) => {
          if (info?.renderLayer === 3) return true;
          return info?.category === "top" && info?.renderLayer === 2;
        },
      });
    }
  }

  // ── 5.6 World items (tileLayer=99) APÓS top items, ANTES dos andares sup. ──
  renderMap({
    ..._mapBase,
    layerMin: 2,
    layerMax: 2,
    clearCanvas: false,
    skipGroundPass: true,
    zPredicate: (z, _dz, aZ) => z === aZ,
    spritePredicate: (_spriteId, _spriteMeta, info) => info?.tileLayer === 99,
  });

  // ── 6. Andares superiores (painter's algorithm — cobrem conteúdo do andar ativo)
  // ─────────────────────────────────────────────────────────────────────────────
  // Renderizados AQUI, após entidades e top items do andar ativo.
  // Isso garante que Z=6 ground fica acima de Z=7 top items (copas de árvore),
  // replicando o comportamento exato do OTClient.
  // Top items dos andares superiores são bloqueados (telhados não exibidos
  // por padrão — evita visual incorreto visto de fora do edifício).
  if (enforceStrictFloorPriority && _upperFloors.length > 0) {
    if (perfEnabled) {
      perfStep(perf, "mapAbove", () => {
        _upperFloors.forEach((z) => {
          renderMap({
            ..._mapBase,
            clearCanvas: false,
            layerMin: 0,
            layerMax: 3,
            zPredicate: (fz) => fz === z,
            spritePredicate: (_id, _meta, info) =>
              info?.category !== "top",
          });
        });
      });
    } else {
      _upperFloors.forEach((z) => {
        renderMap({
          ..._mapBase,
          clearCanvas: false,
          layerMin: 0,
          layerMax: 3,
          zPredicate: (fz) => fz === z,
          spritePredicate: (_id, _meta, info) =>
            info?.category !== "top",
        });
      });
    }
  }

  // ── 7. Efeitos de topo (magias, sangue) — após andares superiores ─────────
  if (perfEnabled) {
    perfStep(perf, "fxTop", () => {
      drawVisualEffects?.(ctx, assets, camXWorld, camYWorld, "top");
    });
  } else {
    drawVisualEffects?.(ctx, assets, camXWorld, camYWorld, "top");
  }

  // ── 8. Textos flutuantes ──────────────────────────────────────
  if (perfEnabled) {
    perfStep(perf, "floating", () => {
      drawFloatingTexts?.(ctx, camXWorld, camYWorld);
    });
    perf.total += performance.now() - frameStart;
    perfFlush(perf);
  } else {
    drawFloatingTexts?.(ctx, camXWorld, camYWorld);
  }
}
