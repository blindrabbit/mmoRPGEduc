// ═══════════════════════════════════════════════════════════════
// animationController.js — Interpolação de movimento e render
//                           de sprites de entidades
// Usado por: gameCore.js, admin.html, rpg.html
// Depende de: config.js, outfitData.js, gameCore.js
// ═══════════════════════════════════════════════════════════════

import { TILE_SIZE, ENTITY_RENDER } from "../core/config.js";
import { OUTFIT_MAP } from "./outfitData.js";
import { calculateStepDuration, smoothProgress } from "../gameplay/gameCore.js";

export class AnimationController {
  _warnDrawIssueOnce(key, data = null) {
    this._drawWarnedKeys ??= new Set();
    if (this._drawWarnedKeys.has(key)) return;
    this._drawWarnedKeys.add(key);
    console.warn(`[AnimationController] ${key}`, data ?? {});
  }

  // ═══════════════════════════════════════════════════════════════
  // POSIÇÃO VISUAL (interpolação entre tiles)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Retorna a posição visual em pixels, interpolada entre o tile
   * anterior (oldX/oldY) e o tile atual (x/y).
   *
   * IMPORTANTE: oldX/oldY podem ser undefined em entidades recém-
   * chegadas do Firebase (antes do primeiro movimento). Sempre usamos
   * fallback para x/y para evitar que "undefined !== number" seja
   * interpretado como isMoving=true, o que causaria o sprite sumir
   * ao parar (step calculado incorretamente com elapsed/duration).
   *
   * @param {object} entity
   * @returns {{ x: number, y: number }}
   */
  getVisualPos(entity, now = Date.now()) {
    const duration = calculateStepDuration(
      entity.speed ?? entity.appearance?.speed ?? 100,
    );
    const elapsed = now - (entity.lastMoveTime || 0);

    // Fallback seguro: se oldX/oldY não definidos, assume posição atual
    const startX = entity.oldX ?? entity.x;
    const startY = entity.oldY ?? entity.y;

    // Sem movimento ou tempo esgotado → posição exata (evita flickering)
    const noMovement = entity.x === startX && entity.y === startY;

    if (elapsed >= duration || noMovement) {
      return { x: entity.x * TILE_SIZE, y: entity.y * TILE_SIZE };
    }

    // Monstros: movimento linear (mais previsível para IA)
    // Players:  easing suavizado
    const raw = Math.min(elapsed / duration, 1);
    const progress = entity.type === "monster" ? raw : smoothProgress(raw);

    return {
      x: (startX + (entity.x - startX) * progress) * TILE_SIZE,
      y: (startY + (entity.y - startY) * progress) * TILE_SIZE,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER DE SPRITE — ponto de entrada público
  // ═══════════════════════════════════════════════════════════════

  /**
   * Chamado pelo worldRenderer a cada frame.
   * Espera receber a entidade já com appearance.outfitPack e
   * appearance.outfitId resolvidos (vindos do Firebase/monsterData).
   * Não faz inferência de pack ou species — essa responsabilidade
   * pertence ao worldRenderer.
   */
  drawManual(ctx, assets, entity, visualX, visualY, camX, camY, now = Date.now()) {
    // ── Guard 1: não renderiza cadáveres via sprite ───────────────
    if (entity.dead || entity.type === "corpse") {
      if (entity.type === "player" && entity.dead) {
        this._warnDrawIssueOnce("draw skipped: player is dead", {
          id: entity.id,
        });
      }
      return false;
    }

    // ── Guard 2: appearance mínima obrigatória ────────────────────
    const pack = entity.appearance?.outfitPack;
    const outfitId = entity.appearance?.outfitId;
    if (!pack || outfitId == null) {
      this._warnDrawIssueOnce("draw skipped: missing appearance", {
        id: entity.id,
        type: entity.type,
        appearance: entity.appearance,
        pack,
        outfitId,
      });
      return false;
    }

    if (window.DEBUG_SPRITES_VERBOSE && entity.type === "monster") {
      try {
        console.debug("[AnimationController] drawManual entry", {
          id: entity.id,
          appearance: entity.appearance,
          hasOutfitConfig: !!OUTFIT_MAP[outfitId],
          hasOutfitAtlasDef: !!(
            assets &&
            typeof assets.hasOutfitDefinition === "function" &&
            assets.hasOutfitDefinition(outfitId)
          ),
          packLoaded: !!(
            assets &&
            typeof assets.hasPack === "function" &&
            assets.hasPack(pack)
          ),
          pos: { x: entity.x, y: entity.y, z: entity.z },
        });
      } catch (e) {
        console.debug(
          "[AnimationController] drawManual debug failure",
          e && e.message,
        );
      }
    }

    // ── Guard 3: valida config e pack carregado ───────────────────
    const isMonster = entity.type === "monster";
    const hasLegacyConfig = !!OUTFIT_MAP[outfitId];
    const hasNewOutfitDef = !!(
      assets &&
      typeof assets.hasOutfitDefinition === "function" &&
      assets.hasOutfitDefinition(outfitId)
    );
    if (isMonster && !hasLegacyConfig) return false;
    if (!isMonster && !hasNewOutfitDef) {
      this._warnDrawIssueOnce(
        `draw skipped: missing outfit definition (${String(outfitId)})`,
        {
          id: entity.id,
          pack,
          outfitId,
          hasOutfitsAtlas: !!assets?.hasOutfitsAtlas?.(),
        },
      );
      return false;
    }

    if (
      isMonster &&
      assets &&
      typeof assets.hasPack === "function" &&
      !assets.hasPack(pack)
    ) {
      return false;
    }

    if (
      !isMonster &&
      assets &&
      typeof assets.hasOutfitsAtlas === "function" &&
      !assets.hasOutfitsAtlas()
    ) {
      this._warnDrawIssueOnce("draw skipped: outfits atlas not loaded", {
        id: entity.id,
        pack,
        outfitId,
      });
      return false;
    }

    // Garante oldX/oldY para que _render calcule isMoving corretamente
    const entForRender = {
      ...entity,
      oldX: entity.oldX ?? entity.x,
      oldY: entity.oldY ?? entity.y,
    };

    return this._render(ctx, assets, entForRender, visualX, visualY, camX, camY, now) === true;
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER INTERNO
  // ═══════════════════════════════════════════════════════════════

  _render(ctx, assets, entity, vX, vY, camX, camY, now = Date.now()) {
    const app = entity.appearance;
    const duration = calculateStepDuration(entity.speed ?? app?.speed ?? 100);
    const elapsed = now - (entity.lastMoveTime || 0);

    // oldX/oldY já são garantidos por drawManual (fallback para x/y)
    const oldX = entity.oldX ?? entity.x;
    const oldY = entity.oldY ?? entity.y;

    // Seleciona frame de animação:
    //   step 1 = parado (frame central)
    //   step 0 / step 2 = passo esquerdo / direito
    const isMoving = entity.x !== oldX || entity.y !== oldY;

    // isWalking: true APENAS durante o intervalo ativo de deslocamento.
    // Quando elapsed >= duration o passo já completou visualmente — volta ao idle
    // mesmo que oldX/oldY ainda não tenham sido atualizados no próximo tick.
    const isWalking = isMoving && elapsed < duration;

    let step = 1; // parado por padrão

    if (isWalking) {
      step = Math.min(Math.floor((elapsed / duration) * 3), 2);
    }

    return this._drawLayer(
      ctx,
      assets,
      app.outfitPack,
      app.outfitId,
      entity.direcao || "frente",
      step,
      Math.round(vX - camX),
      Math.round(vY - camY),
      elapsed,
      app?.addons ?? null,
      isWalking,
    ) === true;
  }

  // ═══════════════════════════════════════════════════════════════
  // DESENHO DE CAMADA — uso interno e externo (preview de outfit)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Pode ser chamado externamente para renderizar outfits custom,
   * ex: preview de personagem na tela de seleção.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {AssetManager}            assets
   * @param {string}  pack      — ex: "outfits_01"
   * @param {string}  outfitId  — ex: "10000"
   * @param {string}  dir       — "frente" | "costas" | "lado" | "lado-esquerdo"
   * @param {number}  step      — 0, 1 ou 2
   * @param {number}  x         — posição em pixels na tela
   * @param {number}  y         — posição em pixels na tela
   */
  drawLayer(
    ctx,
    assets,
    pack,
    outfitId,
    dir,
    step,
    x,
    y,
    elapsed = 0,
    addons = null,
  ) {
    this._drawLayer(
      ctx,
      assets,
      pack,
      outfitId,
      dir,
      step,
      x,
      y,
      elapsed,
      addons,
    );
  }

  _drawLayer(
    ctx,
    assets,
    pack,
    outfitId,
    dir,
    step,
    x,
    y,
    elapsed = 0,
    addons = null,
    isWalking = undefined, // quando definido, sobrescreve a inferência por step
  ) {
    const outfitSprites =
      assets && typeof assets.getOutfitSprites === "function"
        ? assets.getOutfitSprites(outfitId, {
            dir,
            step,
            elapsedMs: elapsed,
            animationTimeMs: Date.now(),
            pack,
            addons,
            isWalking,
          })
        : [];

    if (Array.isArray(outfitSprites) && outfitSprites.length) {
      for (const sprite of outfitSprites) {
        if (!sprite?.info) continue;

        // Offset global deve valer para TODAS as entidades (players e monstros),
        // independentemente do tamanho do sprite.
        const offX = ENTITY_RENDER.offsetX;
        const offY = ENTITY_RENDER.offsetY;

        // colOffset: 0 = coluna da âncora (direita do par 128px), -1 = coluna esquerda.
        // Para sprites 64px independentes colOffset=0 sempre (sem deslocamento extra).
        const colShift = (sprite.colOffset ?? 0) * sprite.info.w;

        const drawX =
          x +
          Math.round((TILE_SIZE - sprite.info.w) / 2) +
          offX +
          colShift;

        const footY = Math.round(TILE_SIZE * ENTITY_RENDER.footAnchorY);
        const drawY = y + footY - sprite.info.h + offY;

        ctx.drawImage(
          sprite.sheet,
          sprite.info.x,
          sprite.info.y,
          sprite.info.w,
          sprite.info.h,
          drawX,
          drawY,
          sprite.info.w,
          sprite.info.h,
        );
      }
      return true;
    }

    const allowLegacyFrames = String(pack || "").startsWith("monstros_");
    if (!allowLegacyFrames) return false;

    const config = OUTFIT_MAP[outfitId];
    if (!config?.frames?.[dir]) return false;

    const spriteNum = config.frames[dir][step];
    const sprite = assets.getSprite(pack, `${spriteNum}.png`);
    if (!sprite) {
      console.warn(
        `[AnimationController] sprite not found pack=${pack} id=${outfitId} dir=${dir} step=${step} num=${spriteNum}`,
      );
      if (window.DEBUG_SPRITES_VERBOSE) {
        console.debug(
          "[AnimationController] outfitConfig=",
          config,
          "availableFrames=",
          Object.keys(assets.packs?.[pack]?.data?.frames || {}),
        );
      }
      return false;
    }

    // Posição X: centralizado no tile + offset global + fine-tune do sprite
    const drawX =
      x +
      Math.round((TILE_SIZE - sprite.info.w) / 2) +
      ENTITY_RENDER.offsetX +
      (config.offX || 0);

    // Posição Y: pé da entidade na fração footAnchorY do tile + offset global + fine-tune do sprite
    const footY = Math.round(TILE_SIZE * ENTITY_RENDER.footAnchorY);
    const drawY =
      y + footY - sprite.info.h + ENTITY_RENDER.offsetY + (config.offY || 0);

    if (window.DEBUG_SPRITES) {
      console.log("[AnimationController] draw", {
        pack,
        outfitId,
        dir,
        step,
        spriteNum,
        drawX,
        drawY,
        spriteInfo: sprite.info,
      });
    }

    ctx.drawImage(
      sprite.sheet,
      sprite.info.x,
      sprite.info.y,
      sprite.info.w,
      sprite.info.h,
      drawX,
      drawY,
      sprite.info.w,
      sprite.info.h,
    );
    return true;
  }
}
