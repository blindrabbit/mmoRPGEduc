// =============================================================================
// SpellEffectRenderer.js — mmoRPGEduc
// Cliente-side: renderiza efeitos visuais de magias e campos
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../../core/events.js";
import { TILE_SIZE } from "../../../core/config.js";

export class SpellEffectRenderer {
  constructor(canvasContext, effectsArray) {
    this.ctx = canvasContext;
    this.effects = effectsArray;
    this._unsubs = [];
  }

  init() {
    const unsubField = worldEvents.subscribe(EVENT_TYPES.FIELD_CREATED, (e) => {
      this._addFieldEffect(e);
    });
    this._unsubs.push(unsubField);

    const unsubEffect = worldEvents.subscribe(EVENT_TYPES.SPELL_EFFECT, (e) => {
      this._addSpellEffect(e);
    });
    this._unsubs.push(unsubEffect);
  }

  destroy() {
    for (const unsub of this._unsubs) if (typeof unsub === "function") unsub();
    this._unsubs = [];
  }

  _addFieldEffect(event) {
    this.effects.push({
      id: `field_${event.fieldId}`,
      x: event.x * TILE_SIZE,
      y: event.y * TILE_SIZE,
      z: event.z,
      spriteId: event.fieldSpriteId,
      startTime: Date.now(),
      duration: event.duration,
      isField: true,
      priority: -1,
    });
  }

  _addSpellEffect(event) {
    if (!event.effectId) return;
    this.effects.push({
      id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      x: event.x * TILE_SIZE,
      y: event.y * TILE_SIZE,
      z: event.z,
      spriteId: event.effectId,
      startTime: Date.now(),
      duration: event.duration || 800,
      isField: event.isField ?? false,
      priority: event.isAoE ? 1 : 0,
    });
  }

  render(now, spriteData) {
    if (!this.ctx || !this.effects?.length) return;
    const active = [];

    for (const effect of this.effects) {
      const elapsed = now - effect.startTime;
      if (elapsed >= effect.duration) continue;

      const sprite = spriteData?.[effect.spriteId];
      if (!sprite) continue;

      this.ctx.save();
      this.ctx.globalAlpha = 1 - (elapsed / effect.duration) * 0.3;

      if (sprite.image) {
        this.ctx.drawImage(
          sprite.image,
          effect.x - (sprite.width || 32) / 2,
          effect.y - (sprite.height || 32),
          sprite.width || 32,
          sprite.height || 32,
        );
      }
      this.ctx.restore();
      active.push(effect);
    }

    if (active.length !== this.effects.length) {
      this.effects.splice(0, this.effects.length, ...active);
    }
  }
}

export function createSpellEffectRenderer(ctx, effectsArray) {
  const renderer = new SpellEffectRenderer(ctx, effectsArray);
  renderer.init();
  return renderer;
}
