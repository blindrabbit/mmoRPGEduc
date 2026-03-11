// =============================================================================
// CombatTextRenderer.js — mmoRPGEduc (FASE 2)
//
// Classe auto-contida para renderização de textos flutuantes de combate.
//
// Diferença de combatText.js (funcional):
//   combatText.js   → empurra para array externo (gameCore.floatingTexts)
//   CombatTextRenderer → gerencia array próprio + desenha diretamente no canvas
//
// Uso:
//   const renderer = new CombatTextRenderer({ tileSize: 32 });
//   renderer.init();          // subscreve eventos
//   // no game loop:
//   renderer.update(now);     // expira textos velhos
//   renderer.draw(ctx, camX, camY);  // renderiza
//   // ao destruir a tela:
//   renderer.destroy();
//
// Dependências: core/events.js, core/config.js
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../../core/events.js";
import { TILE_SIZE } from "../../../core/config.js";

// ---------------------------------------------------------------------------
// ESTILOS VISUAIS
// ---------------------------------------------------------------------------

const STYLE = {
  damage: {
    color: "#ff4040",
    duration: 900,
    font: "bold 13px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 34,
    driftX: 0,
  },
  heal: {
    color: "#40ff70",
    duration: 1000,
    font: "bold 12px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 28,
    driftX: 0,
  },
  critical: {
    color: "#ff8800",
    duration: 1100,
    font: "bold 15px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 3,
    rise: 40,
    driftX: 0,
  },
  miss: {
    color: "#f5f5f5",
    duration: 750,
    font: "bold 11px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 20,
    driftX: 0,
  },
  status: {
    color: "#f1c40f",
    duration: 800,
    font: "bold 11px Tahoma",
    strokeStyle: "#111111",
    strokeWidth: 2,
    rise: 18,
    driftX: 0,
  },
};

// ---------------------------------------------------------------------------
// CLASSE
// ---------------------------------------------------------------------------

export class CombatTextRenderer {
  /**
   * @param {Object} [options]
   * @param {number} [options.tileSize=TILE_SIZE] - Tamanho do tile em px
   * @param {number} [options.offsetX=16] - Offset horizontal dentro do tile
   */
  constructor(options = {}) {
    this._ts = options.tileSize ?? TILE_SIZE;
    this._offsetX = options.offsetX ?? 16;
    /** @private @type {Array<Object>} */
    this._texts = [];
    /** @private @type {Function[]} */
    this._unsubs = [];
  }

  // -------------------------------------------------------------------------
  // CICLO DE VIDA
  // -------------------------------------------------------------------------

  /** Subscreve eventos de combate. Chamar uma vez no boot da tela. */
  init() {
    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.COMBAT_DAMAGE, (e) => this._onDamage(e)),
    );
    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.COMBAT_MISS, (e) => this._onMiss(e)),
    );
    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.COMBAT_CRITICAL, (e) => this._onCritical(e)),
    );
    this._unsubs.push(
      worldEvents.subscribe(EVENT_TYPES.ENTITY_UPDATE, (e) => this._onEntityUpdate(e)),
    );
    return this; // fluent
  }

  /**
   * Remove textos expirados. Chamar no início de cada frame ou game loop.
   * @param {number} [now=Date.now()]
   */
  update(now = Date.now()) {
    for (let i = this._texts.length - 1; i >= 0; i--) {
      if (now - this._texts[i].startTime >= this._texts[i].duration) {
        this._texts.splice(i, 1);
      }
    }
  }

  /**
   * Renderiza todos os textos ativos no canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} camX - Posição da câmera (px)
   * @param {number} camY
   * @param {number} [now=Date.now()]
   */
  draw(ctx, camX, camY, now = Date.now()) {
    if (this._texts.length === 0) return;

    ctx.save();
    ctx.textAlign = "center";

    for (const t of this._texts) {
      const prog = Math.min(1, (now - t.startTime) / t.duration);
      const vX = Math.round(t.x * this._ts - camX + this._offsetX + prog * (t.driftX ?? 0));
      const vY = Math.round(t.y * this._ts - camY - prog * (t.rise ?? 34));

      ctx.globalAlpha = 1 - prog;
      ctx.font = t.font ?? STYLE.damage.font;
      ctx.strokeStyle = t.strokeStyle ?? "#111111";
      ctx.lineWidth = t.strokeWidth ?? 2;
      ctx.strokeText(t.text, vX, vY);
      ctx.fillStyle = t.color ?? "#ffffff";
      ctx.fillText(t.text, vX, vY);
    }

    ctx.restore();
  }

  /** Cancela todas as subscriptions e limpa textos. */
  destroy() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    this._texts = [];
  }

  // -------------------------------------------------------------------------
  // PUSH MANUAL (para uso em código legado ou testes)
  // -------------------------------------------------------------------------

  /**
   * Empurra texto manualmente (sem depender de eventos).
   * @param {number} x - Posição em tiles
   * @param {number} y
   * @param {string} text
   * @param {Object} style - De STYLE.*
   */
  push(x, y, text, style = STYLE.damage) {
    this._texts.push({
      x, y, text,
      startTime: Date.now(),
      ...style,
    });
  }

  // -------------------------------------------------------------------------
  // HANDLERS DE EVENTOS INTERNOS
  // -------------------------------------------------------------------------

  _onDamage(event) {
    const x = event.defenderX ?? 0;
    const y = event.defenderY ?? 0;
    const amount = Math.round(Math.abs(event.damage ?? 0));
    if (!amount) return;

    if (event.isHeal) {
      this._texts.push({ x, y, text: `+${amount}`, startTime: Date.now(), ...STYLE.heal });
    } else if (event.isCritical) {
      this._texts.push({ x, y, text: `${amount}!!`, startTime: Date.now(), ...STYLE.critical });
    } else {
      this._texts.push({ x, y, text: `${amount}`, startTime: Date.now(), ...STYLE.damage });
    }
  }

  _onMiss(event) {
    const x = event.defenderX ?? 0;
    const y = event.defenderY ?? 0;
    this._texts.push({ x, y, text: "MISS", startTime: Date.now(), ...STYLE.miss });
  }

  _onCritical(event) {
    const x = event.defenderX ?? 0;
    const y = event.defenderY ?? 0;
    const amount = Math.round(Math.abs(event.damage ?? 0));
    if (!amount) return;
    this._texts.push({ x, y, text: `${amount}!!`, startTime: Date.now(), ...STYLE.critical });
  }

  _onEntityUpdate(event) {
    if (!event.statusLabel) return;
    const x = event.entityX ?? 0;
    const y = event.entityY ?? 0;
    this._texts.push({
      x, y,
      text: String(event.statusLabel).toUpperCase(),
      startTime: Date.now(),
      ...STYLE.status,
    });
  }
}
