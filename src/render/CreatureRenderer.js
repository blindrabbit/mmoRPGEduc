// ═══════════════════════════════════════════════════════════════
// CreatureRenderer.js — Renderização de criaturas cross-floor
//
// Regras:
//   • Sprite: sempre visível se o floor for visível
//   • Nome/vida (UI): APENAS se creature.z === camera.z
// ═══════════════════════════════════════════════════════════════

import { TILE_SIZE, ENTITY_RENDER } from "../core/config.js";
import { canSeeFloor } from "../core/floorVisibility.js";
import { getRenderOrder } from "./FloorLayer.js";

// ═══════════════════════════════════════════════════════════════
// HELPERS — Cores de Vida
// ═══════════════════════════════════════════════════════════════

function _healthColor(pct) {
  pct = Math.max(0, Math.min(1, pct));
  let r, g;
  if (pct >= 0.5) {
    r = Math.floor(255 * (1 - pct) * 2);
    g = 255;
  } else {
    r = 255;
    g = Math.floor(255 * pct * 2);
  }
  return `rgb(${r},${g},0)`;
}

// ═══════════════════════════════════════════════════════════════
// CREATURE MANAGER
// ═══════════════════════════════════════════════════════════════

export class CreatureManager {
  /**
   * @param {Record<number, import('./FloorLayer.js').FloorLayer>} floorLayers
   */
  constructor(floorLayers) {
    this.floors = floorLayers;
  }

  /**
   * Renderiza TODAS as criaturas visíveis seguindo painter's algorithm.
   *
   * Dois passes:
   *   Pass 1 — sprites (todos os floors visíveis, back-to-front)
   *   Pass 2 — UI labels (nome + vida) APENAS para o floor da câmera
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} camera       - { x: camXpx, y: camYpx, z: activeZ }
   * @param {Object} entities     - { [id]: entity } de worldStore
   * @param {Object} assets       - AssetManager
   * @param {Object} anim         - AnimationController
   * @param {number} frameNow     - Date.now() do frame atual
   * @param {Object} [opts]
   * @param {boolean} [opts.showHP=true]
   * @param {boolean} [opts.showName=true]
   * @param {Object}  [opts.remoteTemplates=null]
   */
  render(ctx, camera, entities, assets, anim, frameNow, opts = {}) {
    const {
      showHP = true,
      showName = true,
      remoteTemplates = null,
    } = opts;

    const camXpx  = camera.x;   // pixels
    const camYpx  = camera.y;   // pixels
    const cameraZ = Number(camera.z ?? 7);

    const renderOrder = getRenderOrder(cameraZ); // [7, 6, 5, ...] deepest first

    // ── Pass 1: Sprites (back-to-front) ─────────────────────────────────────
    const labelQueue = [];

    for (const z of renderOrder) {
      const floor = this.floors[z];
      if (!floor?.isVisible) continue;

      for (const [, ent] of Object.entries(entities ?? {})) {
        if (!ent || ent.dead) continue;
        const entZ = Number(ent.z ?? cameraZ);
        if (entZ !== z) continue;
        if (!canSeeFloor(cameraZ, entZ)) continue;
        if (ent.x == null || ent.y == null) continue;

        // Visual position (interpolated if anim available)
        const safeEnt = ent.oldX == null ? { ...ent, oldX: ent.x, oldY: ent.y } : ent;
        const vPos = (assets && anim)
          ? anim.getVisualPos(safeEnt, frameNow)
          : { x: ent.x * TILE_SIZE, y: ent.y * TILE_SIZE };

        // Floor offset: floors above camera shift left-up
        const floorOffsetPx = Math.max(0, cameraZ - entZ) * TILE_SIZE;
        const shiftedX = vPos.x - floorOffsetPx;
        const shiftedY = vPos.y - floorOffsetPx;

        const drawX = Math.round(shiftedX - camXpx + TILE_SIZE / 2);
        const drawY = Math.round(shiftedY - camYpx + TILE_SIZE / 2);

        // Culling
        if (
          drawX < -64 || drawX > ctx.canvas.width + 64 ||
          drawY < -64 || drawY > ctx.canvas.height + 64
        ) continue;

        const isMonster = _isMonsterEntity(ent);

        // Draw sprite
        const spriteDrawn = _drawCreatureSprite(
          ctx, ent, assets, anim, shiftedX, shiftedY, camXpx, camYpx, frameNow, isMonster
        );

        if (!spriteDrawn) {
          // Fallback: colored circle
          ctx.beginPath();
          ctx.arc(drawX, drawY, isMonster ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = isMonster ? "#e74c3c" : "#2ecc71";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Enfileira para o pass 2 (UI apenas no floor da câmera)
        if ((showHP || showName) && entZ === cameraZ) {
          const spriteTopY = Math.round(
            shiftedY - camYpx +
            Math.round(TILE_SIZE * ENTITY_RENDER.footAnchorY) -
            TILE_SIZE +
            ENTITY_RENDER.offsetY
          );
          labelQueue.push({ ent, drawX, spriteTopY, isMonster });
        }
      }
    }

    // ── Pass 2: UI labels (nome + barra de HP) ────────────────────────────
    for (const { ent, drawX, spriteTopY, isMonster } of labelQueue) {
      const hp    = ent.stats?.hp    ?? 100;
      const maxHp = ent.stats?.maxHp ?? 100;
      const pct   = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
      const color = _healthColor(pct);

      if (showHP && maxHp > 0) {
        _drawHPBar(ctx, drawX, spriteTopY + ENTITY_RENDER.labelBarY, TILE_SIZE, pct, color);
      }

      if (showName) {
        const name = _resolveDisplayName(ent, isMonster, remoteTemplates);
        if (name) {
          _drawLabel(ctx, name, drawX, spriteTopY + ENTITY_RENDER.labelNameY, color);
        }
      }
    }
  }
}

// ─── internals ───────────────────────────────────────────────────────────────

function _isMonsterEntity(ent) {
  const id = ent._entityId ?? "";
  return (
    ent.type === "monster" ||
    typeof ent.species === "string" ||
    (typeof id === "string" && id.startsWith("mob"))
  );
}

function _drawCreatureSprite(ctx, ent, assets, anim, wx, wy, camX, camY, frameNow, isMonster) {
  if (!assets || !anim) return false;

  const defaultPack = isMonster ? "monstros_01" : "outfits_01";
  let pack     = ent.appearance?.outfitPack || defaultPack;
  let outfitId = ent.appearance?.outfitId ?? ent.species ?? ent.template ?? (isMonster ? "rat" : 10000);

  if (assets.hasPack && !assets.hasPack(pack)) {
    const fallback = isMonster ? "monstros_01" : "outfits_01";
    if (assets.hasPack?.(fallback)) pack = fallback;
  }

  if (!isMonster && assets.hasOutfitsAtlas?.() && !assets.hasOutfitDefinition?.(outfitId)) {
    outfitId = 128;
  }

  const canSprite = (isMonster && assets.hasPack?.(pack)) ||
    (!isMonster && assets.hasOutfitsAtlas?.() && assets.hasOutfitDefinition?.(outfitId));

  if (!canSprite) return false;

  const safeEnt = ent.oldX == null ? { ...ent, oldX: ent.x, oldY: ent.y } : ent;
  return anim.drawManual(
    ctx,
    assets,
    { ...safeEnt, appearance: { ...(safeEnt.appearance ?? {}), outfitPack: pack, outfitId } },
    wx,
    wy,
    camX,
    camY,
    frameNow,
  ) === true;
}

function _drawHPBar(ctx, cx, y, width, pct, color) {
  const x = cx - width / 2;
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x, y, width, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(1, Math.round((width - 2) * pct)), 2);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, width, 4);
}

function _drawLabel(ctx, name, cx, y, color) {
  ctx.save();
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.strokeText(name, cx, y);
  ctx.fillStyle = color;
  ctx.fillText(name, cx, y);
  ctx.restore();
}

function _resolveDisplayName(ent, isMonster, remoteTemplates) {
  let raw;
  if (isMonster) {
    if (remoteTemplates && ent.species) {
      const tmpl = remoteTemplates[ent.species];
      if (tmpl?.name) raw = tmpl.name;
    }
    raw = raw ?? ent.species ?? ent.template ?? ent.name;
  } else {
    raw = ent.name ?? ent.template ?? ent.species;
  }

  if (!raw) {
    const id = ent._entityId ?? "";
    const parts = typeof id === "string" ? id.split("_") : [];
    raw = parts.length >= 2 ? parts[1] : (id.substring(0, 12) || "?");
  }

  return typeof raw === "string"
    ? raw.replace(/[_-]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
    : String(raw);
}
