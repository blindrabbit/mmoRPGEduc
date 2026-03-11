// =============================================================================
// gameCore.js — mmoRPGGame
// Motor de render do jogo: renderização e efeitos visuais.
// FASE IMEDIATA: re-export de firebaseClient REMOVIDO.
// Dependências: outfitData.js, config.js, worldStore.js, combatEngine.js,
//               playerManager.js, assetLoader.js
// =============================================================================

import { OUTFIT_MAP } from "../render/outfitData.js";
import { TILE_SIZE, WORLD_SETTINGS, EFFECTS_RENDER } from "../core/config.js";
import { initCombatEngine } from "./combatEngine.js";
import { initCombatTextUI } from "../clients/shared/ui/combatText.js";
import { getEffects, getFields } from "../core/worldStore.js";

const GROUNDZ = WORLD_SETTINGS.spawn.z;
const DEBUGVISUAL = false;

// ---------------------------------------------------------------------------
// RE-EXPORTS DE COMPATIBILIDADE
// ❌ REMOVIDO: export { dbWatch as monitorFirebase } from './firebaseClient.js'
// ✅ monitorFirebase agora é função vazia — worldStore já ouve os efeitos
// ---------------------------------------------------------------------------

export {
  handlePlayerSync,
  resetPlayerStatus,
  respawnPlayer,
  kickPlayer,
} from "../gameplay/playerManager.js";

export {
  calculateCombatResult,
  applyDamage,
  handleStatsChanges,
} from "./combatEngine.js";

export { loadAllSprites } from "../render/assetLoader.js";

// ---------------------------------------------------------------------------
// ESTADO DE RENDER
// ---------------------------------------------------------------------------
export let floatingTexts = [];

// initCombatEngine mantido por compatibilidade (agora no-op)
initCombatEngine(floatingTexts);

// Conecta eventos de combate ao array de textos flutuantes (FASE 1)
initCombatTextUI(floatingTexts);

// ---------------------------------------------------------------------------
// monitorEffects — mantida para compatibilidade (rpg.html / admin.html)
// worldStore já ouve world_effects via watchEffects em initWorldStore.
// Esta função não precisa fazer mais nada.
// ---------------------------------------------------------------------------
export function monitorEffects() {
  // no-op: getEffects() já retorna o estado atualizado em tempo real.
}

// ---------------------------------------------------------------------------
// HELPERS DE ANIMAÇÃO
// ---------------------------------------------------------------------------
export function calculateStepDuration(speed) {
  return Math.max(50, 600 - (speed ?? 100) * 2);
}
export function smoothProgress(t) {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// RENDERIZAÇÃO DO MAPA — legado (usado por rpg/admin via processRenderFrame)
// ---------------------------------------------------------------------------
export function drawMap(
  ctx,
  worldTiles,
  assets,
  activeZ = GROUNDZ,
  camX,
  camY,
) {
  if (!worldTiles) return;
  const { width: canvasW, height: canvasH } = ctx.canvas;
  for (const tile of Object.values(worldTiles)) {
    if (tile.z !== activeZ) continue;
    const screenX = Math.round(tile.x * TILE_SIZE - camX);
    const screenY = Math.round(tile.y * TILE_SIZE - camY);
    if (screenX + TILE_SIZE < 0 || screenX > canvasW) continue;
    if (screenY + TILE_SIZE < 0 || screenY > canvasH) continue;
    for (const itemid of tile.items) {
      const sprite = assets.getSpriteById(itemid);
      if (sprite) {
        ctx.drawImage(
          sprite.sheet,
          sprite.x,
          sprite.y,
          sprite.w,
          sprite.h,
          screenX,
          screenY,
          TILE_SIZE,
          TILE_SIZE,
        );
      } else if (DEBUGVISUAL) {
        ctx.fillStyle = "#0d0d1a";
        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = "#e94560";
        ctx.font = "7px monospace";
        ctx.fillText(itemid, screenX + 2, screenY + 10);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RENDER FRAME PRINCIPAL — legado
// ---------------------------------------------------------------------------
export function processRenderFrame(
  ctx,
  canvas,
  worldTiles,
  assets,
  anim,
  myPos,
  onlinePlayers,
  dynamicEntities,
  time,
) {
  if (!myPos || !worldTiles || !ctx) return;
  const myVisual = anim.getVisualPos(myPos);
  const camX = Math.round(myVisual.x - canvas.width / 2 + 16);
  const camY = Math.round(myVisual.y - canvas.height / 2 + 16);
  const activeZ = myPos.z ?? GROUNDZ;

  drawMap(ctx, worldTiles, assets, activeZ, camX, camY);
  drawCorpses(ctx, assets, camX, camY, time);
  drawVisualEffects(ctx, assets, camX, camY, "ground");

  const entities = { ...dynamicEntities, ...onlinePlayers, [myPos.id]: myPos };
  for (const id in entities) {
    const ent = entities[id];
    if ((ent.z ?? GROUNDZ) !== activeZ) continue;
    const vPos = id === myPos.id ? myVisual : anim.getVisualPos(ent);
    drawShadow(ctx, ent, vPos, camX, camY);
    anim.drawManual(ctx, assets, ent, vPos.x, vPos.y, camX, camY, time);
    drawEntityUI(ctx, ent, vPos, camX, camY);
  }

  drawVisualEffects(ctx, assets, camX, camY, "top");
  drawFloatingTexts(ctx, camX, camY);
  return { camX, camY };
}

export function renderGameFrame(
  ctx,
  canvas,
  state,
  activeEntity,
  options = { mode: "player" },
) {
  const res = processRenderFrame(
    ctx,
    canvas,
    state.worldTiles,
    state.assets,
    state.anim,
    activeEntity,
    state.onlinePlayers,
    state.dynamicEntities,
    state.time,
  );
  if (res && options.mode === "admin" && options.hoverTile) {
    ctx.save();
    ctx.strokeStyle = "#2ecc71";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(
      Math.round(options.hoverTile.x * TILE_SIZE - res.camX),
      Math.round(options.hoverTile.y * TILE_SIZE - res.camY),
      TILE_SIZE,
      TILE_SIZE,
    );
    ctx.restore();
  }
  return res;
}

// ---------------------------------------------------------------------------
// TEXTOS FLUTUANTES
// ---------------------------------------------------------------------------
export function drawFloatingTexts(ctx, camX, camY) {
  const now = Date.now();
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const t = floatingTexts[i];
    if (!t || now - t.startTime >= t.duration) {
      floatingTexts.splice(i, 1);
    }
  }
  for (const t of floatingTexts) {
    const prog = (now - t.startTime) / t.duration;
    const rise = t.rise ?? 60;
    const driftX = t.driftX ?? 0;
    const vX = Math.round(t.x * TILE_SIZE - camX + 16 + prog * driftX);
    const vY = Math.round(t.y * TILE_SIZE - camY - prog * rise);
    ctx.save();
    ctx.globalAlpha = 1 - prog;
    ctx.font = t.font ?? "bold 13px Tahoma";
    ctx.textAlign = "center";
    ctx.strokeStyle = t.strokeStyle ?? "#111111";
    ctx.lineWidth = t.strokeWidth ?? 2;
    ctx.strokeText(t.text, vX, vY);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, vX, vY);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// EFEITOS VISUAIS — lê de getEffects() do worldStore
// ---------------------------------------------------------------------------
export function drawVisualEffects(ctx, assets, camX, camY, layer = "top") {
  const now = Date.now();

  const getCategoryConfig = (key) => {
    const categories = EFFECTS_RENDER?.categories ?? {};
    return categories[key] ?? categories.generic ?? {};
  };

  const resolveEffectCategory = (entry, forcedLayer = null) => {
    if (forcedLayer === "ground" || entry?.isField) return "field";

    const effectType = String(entry?.effectType ?? "").toLowerCase();
    const effectId = String(entry?.id ?? "").toLowerCase();

    if (
      effectType === "attackhit" ||
      effectType === "attackmiss" ||
      effectId.startsWith("hit_") ||
      effectId.startsWith("miss_") ||
      effectId.includes("hit_player_") ||
      effectId.includes("miss_player_")
    ) {
      return "attack";
    }

    if (effectType === "wave" || effectId.includes("wave")) return "wave";
    if (entry?.type === "corpse" || effectId.startsWith("corpse"))
      return "corpse";

    return "generic";
  };

  const getRenderBase = (entry, category) => {
    const cfg = getCategoryConfig(category);
    let baseX = Number(entry?.x ?? 0);
    let baseY = Number(entry?.y ?? 0);

    if (cfg?.snapToTile) {
      baseX = Math.round(baseX);
      baseY = Math.round(baseY);
    }

    if (!Number.isFinite(baseX)) baseX = 0;
    if (!Number.isFinite(baseY)) baseY = 0;

    return {
      baseX,
      baseY,
      offX: Number(EFFECTS_RENDER.offsetX ?? 0) + Number(cfg?.offsetX ?? 0),
      offY: Number(EFFECTS_RENDER.offsetY ?? 0) + Number(cfg?.offsetY ?? 0),
    };
  };

  if (layer === "ground") {
    const activeFields = { ...(getFields() ?? {}) };
    const activeEffects = getEffects() ?? {};

    // Compat: alguns fluxos antigos/publicadores ainda gravam fields em
    // world_effects com isField=true em vez de world_fields.
    for (const effectId in activeEffects) {
      const effect = activeEffects[effectId];
      if (!effect?.isField) continue;
      if (!activeFields[effectId]) activeFields[effectId] = effect;
    }

    for (const id in activeFields) {
      const field = activeFields[id];
      if (!field) continue;
      if (field.expiry && now > field.expiry) continue;

      const fieldVisualIdRaw =
        field.fieldId ?? field.fieldTypeId ?? field.effectId;
      const fieldVisualId = Number(fieldVisualIdRaw);

      const startTime =
        field.startTime ?? field.expiry - (field.fieldDuration ?? 5000);
      const safeElapsed = Math.max(0, now - (startTime || now));
      let sprites = [];

      if (
        Number.isFinite(fieldVisualId) &&
        typeof assets?.getFieldSprites === "function"
      ) {
        sprites = assets.getFieldSprites(fieldVisualId, safeElapsed, {
          id: field.id ?? id,
          x: field.x,
          y: field.y,
          z: field.z,
          startTime,
          expiry: field.expiry ?? null,
          fieldDuration:
            Number(field.fieldDuration ?? 0) ||
            Math.max(0, Number(field.expiry ?? now) - Number(startTime ?? now)),
          variantSeed: `${field.id ?? id}:${field.x ?? 0}:${field.y ?? 0}:${field.z ?? 7}`,
        });
      }

      if (
        (!Array.isArray(sprites) || !sprites.length) &&
        typeof assets?.getEffectSprite === "function"
      ) {
        const fallbackEffectId = Number(field.effectId ?? 0);
        if (Number.isFinite(fallbackEffectId) && fallbackEffectId > 0) {
          const fallback = assets.getEffectSprite(
            fallbackEffectId,
            safeElapsed,
          );
          if (fallback?.info) sprites = [fallback];
        }
      }

      if (!Array.isArray(sprites) || !sprites.length) continue;

      ctx.save();
      if (field.expiry) {
        const left = field.expiry - now;
        if (left < 1000) ctx.globalAlpha = Math.max(0, left / 1000);
      }

      for (const sprite of sprites) {
        if (!sprite?.info) continue;

        const category = resolveEffectCategory(field, "ground");
        const { baseX, baseY, offX, offY } = getRenderBase(field, category);

        const posX = Math.round(
          baseX * TILE_SIZE -
            camX +
            Math.round((TILE_SIZE - sprite.info.w) / 2) +
            offX,
        );
        const posY = Math.round(
          baseY * TILE_SIZE - camY + (TILE_SIZE - sprite.info.h) + offY,
        );

        ctx.drawImage(
          sprite.sheet,
          sprite.info.x,
          sprite.info.y,
          sprite.info.w,
          sprite.info.h,
          posX,
          posY,
          sprite.info.w,
          sprite.info.h,
        );
      }
      ctx.restore();
    }
    return;
  }

  const activeEffects = getEffects();

  for (const id in activeEffects) {
    const effect = activeEffects[id];
    if (!effect || (effect.expiry && now > effect.expiry)) continue;
    if (effect.type === "corpse") continue;

    if (effect.isField) continue;

    const totalDuration = effect.effectDuration ?? 1200;
    const startTime = effect.startTime ?? effect.expiry - totalDuration;
    const safeElapsed = Math.max(0, now - startTime);
    let spritesToDraw = [];

    if (!spritesToDraw.length) {
      if (
        effect.effectId == null ||
        typeof assets?.getEffectSprite !== "function"
      ) {
        continue;
      }
      const fxSprite = assets.getEffectSprite(effect.effectId, safeElapsed);
      if (!fxSprite?.info) continue;
      spritesToDraw = [fxSprite];
    }

    ctx.save();
    if (effect.expiry) {
      const left = effect.expiry - now;
      if (left < 1000) ctx.globalAlpha = Math.max(0, left / 1000);
    }

    for (const fxSprite of spritesToDraw) {
      if (!fxSprite?.info) continue;

      const category = resolveEffectCategory(effect, layer);
      const { baseX, baseY, offX, offY } = getRenderBase(effect, category);

      const posX = Math.round(
        baseX * TILE_SIZE -
          camX +
          Math.round((TILE_SIZE - fxSprite.info.w) / 2) +
          offX,
      );
      const posY = Math.round(
        baseY * TILE_SIZE - camY + (TILE_SIZE - fxSprite.info.h) + offY,
      );

      ctx.drawImage(
        fxSprite.sheet,
        fxSprite.info.x,
        fxSprite.info.y,
        fxSprite.info.w,
        fxSprite.info.h,
        posX,
        posY,
        fxSprite.info.w,
        fxSprite.info.h,
      );
    }

    // Status sincronizado via world_effects (ex: burning/poison/frozen)
    // precisa ser desenhado também no cliente RPG, além dos eventos locais.
    if (effect.statusType) {
      const statusText = String(effect.statusType).toUpperCase();
      const centerX = Math.round(
        (Number(effect.x ?? 0) + 0.5) * TILE_SIZE - camX,
      );
      const baseY = Math.round(Number(effect.y ?? 0) * TILE_SIZE - camY - 6);
      ctx.font = "bold 11px Tahoma";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(statusText, centerX, baseY);
      ctx.fillStyle = "#f1c40f";
      ctx.fillText(statusText, centerX, baseY);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// CADÁVERES — lê de getEffects() do worldStore
// ---------------------------------------------------------------------------
export function drawCorpses(ctx, assets, camX, camY, now) {
  const activeEffects = getEffects();
  for (const id in activeEffects) {
    const ef = activeEffects[id];
    if (ef.type !== "corpse" && !id.startsWith("corpse")) continue;
    if (!ef.stages && !ef.corpseItemId && !ef.corpseItemIds) continue;

    const pack = ef.outfitPack ?? "monstros_01";
    const totalDuration = (ef.expiry ?? 0) - (ef.startTime ?? 0);
    const safeElapsed = Math.max(0, now - (ef.startTime ?? now));
    const progress =
      totalDuration > 0 ? Math.min(0.99, safeElapsed / totalDuration) : 0;

    const stageFromStruct = [
      ef.stages?.growth?.[0] ?? ef.stages?.growth,
      ef.stages?.sustain?.[0] ?? ef.stages?.sustain,
      ef.stages?.decay?.[0] ?? ef.stages?.decay,
    ].filter((value) => value != null);
    const stageFromList = Array.isArray(ef.corpseItemIds)
      ? ef.corpseItemIds.filter((value) => value != null)
      : [];
    const stages = stageFromStruct.length
      ? stageFromStruct
      : stageFromList.length
        ? stageFromList
        : ef.corpseItemId != null
          ? [ef.corpseItemId]
          : [];
    if (!stages.length) continue;

    const pickedStage =
      stages[Math.floor(progress * stages.length)] ?? stages[0];
    const numericStage = Number(pickedStage);

    let sprite = null;
    if (Number.isFinite(numericStage)) {
      sprite = assets.getSpriteById(numericStage);
    }
    if (!sprite) {
      let frameId = String(pickedStage);
      if (!frameId.endsWith(".png")) frameId += ".png";
      sprite = assets.getSprite(pack, frameId);
    }
    if (!sprite) continue;

    const category = resolveEffectCategory(ef, null);
    const { baseX, baseY, offX, offY } = getRenderBase(ef, category);

    const posX = Math.round(
      baseX * TILE_SIZE -
        camX +
        Math.round((TILE_SIZE - sprite.info.w) / 2) +
        offX,
    );
    const posY = Math.round(
      baseY * TILE_SIZE - camY + (TILE_SIZE - sprite.info.h) + offY,
    );

    ctx.save();
    if (progress > 0.8) ctx.globalAlpha = Math.max(0, (1 - progress) / 0.2);
    ctx.drawImage(
      sprite.sheet,
      sprite.info.x,
      sprite.info.y,
      sprite.info.w,
      sprite.info.h,
      posX,
      posY,
      sprite.info.w,
      sprite.info.h,
    );
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// FUNÇÕES PRIVADAS — render de entidades
// ---------------------------------------------------------------------------
function drawShadow(ctx, entity, vPos, camX, camY) {
  const app = entity.appearance;
  const config = OUTFIT_MAP?.[app?.outfitId] ?? OUTFIT_MAP?.[10000] ?? {};
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    Math.round(
      vPos.x -
        camX +
        16 +
        (GLOBALOFFSET?.x ?? 0) +
        (config.offX ?? 0) +
        (GLOBALOFFSET?.shadowX ?? 0) +
        (config.offShadowX ?? 0),
    ),
    Math.round(
      vPos.y -
        camY +
        30 +
        (GLOBALOFFSET?.y ?? 0) +
        (config.offY ?? 0) +
        (GLOBALOFFSET?.shadowY ?? 0) +
        (config.offShadowY ?? 0),
    ),
    config.shadowW ?? 10,
    config.shadowH ?? 4,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fill();
  ctx.restore();
}

function drawEntityUI(ctx, entity, vPos, camX, camY) {
  if (!entity.name) return;
  const app = entity.appearance;
  const config = OUTFIT_MAP?.[app?.outfitId] ?? OUTFIT_MAP?.[10000] ?? {};
  const x = Math.round(
    vPos.x - camX + 16 + (GLOBALOFFSET?.x ?? 0) + (config.offX ?? 0) + 16,
  );
  const y = Math.round(
    vPos.y - camY - 16 + (GLOBALOFFSET?.y ?? 0) + (config.offY ?? 0),
  );

  ctx.save();
  ctx.font = "bold 10px Tahoma";
  ctx.textAlign = "center";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.strokeText(entity.name, x, y);
  ctx.fillStyle = app?.isAdmin ? "#00ffff" : "#00ff00";
  ctx.fillText(entity.name, x, y);

  if (entity.stats) {
    const percent = Math.max(
      0,
      Math.min(1, (entity.stats.hp ?? 0) / (entity.stats.maxHp ?? 100)),
    );
    const barX = x - 14,
      barY = y + 5;
    ctx.fillStyle = "black";
    ctx.fillRect(barX - 1, barY - 1, 28, 5);
    ctx.fillStyle =
      percent > 0.6 ? "#00ff00" : percent > 0.3 ? "#ffff00" : "#ff0000";
    ctx.fillRect(barX, barY, Math.round(26 * percent), 3);
  }
  ctx.restore();
}
