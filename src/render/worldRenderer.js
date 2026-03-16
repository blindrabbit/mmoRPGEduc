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

  const drawAllLayer2Tall = (_spriteId, spriteMeta, info) => {
    if (info?.renderLayer !== 2) return false;
    return !isFlat(spriteMeta);
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

  const drawAllLayer3 = (_spriteId, _spriteMeta, info) => {
    return info?.renderLayer === 3;
  };

  const renderUpperFloorStack = () => {
    if (!showUpperFloors || upperVisibleFloors.length === 0) return;

    // Renderiza andares de cima (z < activeZ) em DUAS FASES separadas.
    // Isso resolve o conflito entre:
    //   ✅ Bordas de Z=7 NÃO cobertas por ground de Z=6 (problema raiz)
    //   ✅ Paredes/itens de Z=6 aparecem EM CIMA das bordas de Z=7 (order correta)
    //
    // FASE 1 — Ground-only, ascendente (z=0 primeiro → z=activeZ-1 último):
    //   Ground de Z=6 é pintado ANTES das bordas dos andares base.
    //
    // FASE 1.5 — Re-render bordas dos andares base (groundBorder, layer 1):
    //   Bordas ficam EM CIMA do ground dos andares acima,
    //   mas ANTES dos itens/paredes desses andares (fase 2).
    //
    // FASE 2 — Main-only (borders + items), ascendente:
    //   Paredes/itens de Z=6 rendem POR CIMA das bordas de Z=7 onde for o caso.
    const _blockTopFromUpperFloors = (_id, _meta, info) =>
      info?.category !== "top";

    const sortedUpper = [...upperVisibleFloors].sort((a, b) => a - b); // z=0 ... z=activeZ-1
    // O andar mais próximo do ativo (último da lista ascendente = activeZ-1) é o mais
    // crítico: seu ground é o que mais cobre as bordas dos andares base.
    // Estratégia: todos os andares acima exceto o último renderizam em ISOLAMENTO TOTAL
    // (ground+main completo). Apenas o ÚLTIMO andar é dividido em três sub-fases:
    //
    //   FASE A – ground-only do último andar (z = activeZ-1)
    //   FASE B – re-render das bordas dos andares base (layer 1)
    //            → agora sobre o ground de TODOS os andares acima
    //   FASE C – main-only do último andar
    //            → paredes/itens de z=activeZ-1 ficam sobre as bordas re-renderizadas
    //
    // Isso preserva a isolação de cada floor (ground de Z=6 ainda cobre itens de Z=5)
    // e ao mesmo tempo garante que bordas de Z=7 nunca fiquem cobertas pelo ground
    // de nenhum andar acima.
    const lastUpperZ = sortedUpper[sortedUpper.length - 1]; // = activeZ - 1

    sortedUpper.forEach((z) => {
      if (z !== lastUpperZ) {
        // Andares intermediários: isolamento total (comportamento original)
        renderMap({
          ..._mapBase,
          layerMin: 0,
          layerMax: 2,
          clearCanvas: false,
          zPredicate: (fz) => fz === z,
          spritePredicate: _blockTopFromUpperFloors,
        });
      } else {
        // Último andar acima (z = activeZ-1): dividido em três sub-fases

        // FASE A: ground-only
        renderMap({
          ..._mapBase,
          layerMin: 0,
          layerMax: 2,
          clearCanvas: false,
          skipMainPass: true,
          zPredicate: (fz) => fz === z,
        });

        // FASE B: re-render bordas dos andares base (sobre o ground de todos os andares acima)
        _floorsBase.forEach((bz) => {
          renderMap({
            ..._mapBase,
            clearCanvas: false,
            skipMainPass: true,
            layerMin: 1,  // apenas groundBorder (render_layer 1)
            layerMax: 1,
            zPredicate: (fz) => fz === bz,
          });
        });

        // FASE C: main-only (paredes/itens ficam sobre as bordas re-renderizadas)
        renderMap({
          ..._mapBase,
          layerMin: 0,
          layerMax: 2,
          clearCanvas: false,
          skipGroundPass: true,
          zPredicate: (fz) => fz === z,
          spritePredicate: _blockTopFromUpperFloors,
        });
      }
    });
  };

  // ── 1. Mapa base — renderização ISOLADA por floor Z (painter's algorithm) ──
  // Correção de vazamento: cada floor renderiza completamente (ground + items)
  // ANTES do próximo, garantindo separação total entre Z levels.
  // Ordem: Z mais fundo (valor alto) primeiro → Z ativo por último.
  const _floorsBase = getVisibleFloors(activeZ).filter((z) => z >= activeZ);
  // _floorsBase está em ordem decrescente: e.g. [7,6,5] quando activeZ=5

  const _renderIsolatedFloor = (z, clearCanvas) => {
    renderMap({
      ..._mapBase,
      clearCanvas,
      layerMin: 0,
      layerMax: 2,
      zPredicate: (fz) => fz === z,
      spritePredicate: drawLayer2IfFlat,
    });
  };

  if (perfEnabled) {
    perfStep(perf, "mapBase", () => {
      _floorsBase.forEach((z, idx) => _renderIsolatedFloor(z, idx === 0));
    });
  } else {
    _floorsBase.forEach((z, idx) => _renderIsolatedFloor(z, idx === 0));
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
          spritePredicate: enforceStrictFloorPriority
            ? drawAllLayer2Tall
            : drawOnlyLayer2IfTallPre,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 2,
        layerMax: 2,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: enforceStrictFloorPriority
          ? drawAllLayer2Tall
          : drawOnlyLayer2IfTallPre,
      });
    }
  } else if (enforceStrictFloorPriority) {
    if (perfEnabled) {
      perfStep(perf, "mapTall", () => {
        renderMap({
          ..._mapBase,
          layerMin: 2,
          layerMax: 2,
          clearCanvas: false,
          zPredicate: (z, _dz, aZ) => z === aZ,
          spritePredicate: drawAllLayer2Tall,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 2,
        layerMax: 2,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: drawAllLayer2Tall,
      });
    }
  }

  // ── 4.5 Mapa — layer 3 do andar ativo (ANTES dos andares acima) ─────────
  // Quando upperFloorsBeforeEntities=true e enforceStrictFloorPriority=true,
  // o layer 3 do andar ativo (top_decoration, copas, telhados) DEVE ser
  // desenhado ANTES dos andares superiores para que os andares Z < activeZ
  // possam cobrir os itens de topo (e.g. copa de árvore 7143 ao Z=7 não deve
  // aparecer acima de tiles do andar Z=6).
  //
  // ❌ ANTES: else if (enforceStrictFloorPriority) ficava APÓS renderUpperFloorStack
  //            → layer 3 de Z=7 aparecia POR CIMA dos andares superiores
  // ✅ AGORA: layer 3 de Z=7 é desenhado ANTES de renderUpperFloorStack
  //            → andares superiores cobrem corretamente os itens de topo
  if (showTopDecor && topDecorBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapTop", () => {
        renderMap({
          ..._mapBase,
          layerMin: 3,
          layerMax: 3,
          clearCanvas: false,
          zPredicate: (z, _dz, aZ) => z === aZ,
          spritePredicate: enforceStrictFloorPriority
            ? drawAllLayer3
            : drawLayer3Pre,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 3,
        layerMax: 3,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: enforceStrictFloorPriority
          ? drawAllLayer3
          : drawLayer3Pre,
      });
    }
  } else if (showTopDecor && enforceStrictFloorPriority) {
    // enforceStrictFloorPriority=true → upper floors present → render layer 3
    // AQUI (antes dos andares superiores) para que sejam cobertos por eles.
    if (perfEnabled) {
      perfStep(perf, "mapTop", () => {
        renderMap({
          ..._mapBase,
          layerMin: 3,
          layerMax: 3,
          clearCanvas: false,
          zPredicate: (z, _dz, aZ) => z === aZ,
          spritePredicate: drawAllLayer3,
        });
      });
    } else {
      renderMap({
        ..._mapBase,
        layerMin: 3,
        layerMax: 3,
        clearCanvas: false,
        zPredicate: (z, _dz, aZ) => z === aZ,
        spritePredicate: drawAllLayer3,
      });
    }
  }

  // ── 4.6 Mapa de andares acima (z < activeZ) — layers 0-2 ────
  // Em player view, desenha ANTES das entidades para não cobrir o player.
  // IMPORTANTE: renderizado APÓS o layer 3 do andar ativo (step 4.5) para que
  // os andares superiores cubram corretamente os itens de topo (copas, telhados).
  if (showUpperFloors && upperFloorsBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapAbove", () => {
        renderUpperFloorStack();
      });
    } else {
      renderUpperFloorStack();
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
  if (!enforceStrictFloorPriority) {
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
  }

  // ── 6.5 Mapa de andares acima (z < activeZ) — layers 0-2 ────
  // Fora do player view, mantém desenho após entidades.
  if (showUpperFloors && !upperFloorsBeforeEntities) {
    if (perfEnabled) {
      perfStep(perf, "mapAbove", () => {
        renderUpperFloorStack();
      });
    } else {
      renderUpperFloorStack();
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
  if (showTopDecor && !topDecorBeforeEntities && !enforceStrictFloorPriority) {
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
