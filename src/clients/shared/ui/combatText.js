// =============================================================================
// combatText.js — mmoRPGEduc (FASE 1 — Camada de UI)
//
// RESPONSABILIDADE: Escuta eventos de combate e empurra textos flutuantes
//   para o array do canvas. NUNCA contém lógica de jogo.
//
// Uso:
//   import { initCombatTextUI } from '../../clients/shared/ui/combatText.js';
//   const unsub = initCombatTextUI(floatingTexts);
//   // ...quando destruir a tela:
//   unsub();
//
// Dependências: core/events.js, core/config.js
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../../core/events.js";
import { TILE_SIZE } from "../../../core/config.js";

// ---------------------------------------------------------------------------
// ESTILOS VISUAIS (exclusivo do cliente)
// ---------------------------------------------------------------------------

const TIBIA_TEXT = {
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
// INICIALIZAÇÃO
// ---------------------------------------------------------------------------

/**
 * Registra listeners de eventos de combate e conecta ao array de floatingTexts.
 *
 * @param {Array} floatingTexts - Array do gameCore onde textos são empurrados
 * @param {Object} [options]
 * @param {number} [options.tileSize] - Tamanho do tile em px (padrão: TILE_SIZE)
 * @returns {Function} Função de cleanup (cancela todos os listeners)
 */
export function initCombatTextUI(floatingTexts, options = {}) {
  const ts = options.tileSize ?? TILE_SIZE;

  function push(payload) {
    floatingTexts.push({
      x: Number(payload.x ?? 0),
      y: Number(payload.y ?? 0),
      text: String(payload.text ?? ""),
      color: payload.color ?? "#ffffff",
      startTime: payload.startTime ?? Date.now(),
      duration: Number(payload.duration ?? TIBIA_TEXT.damage.duration),
      font: payload.font ?? TIBIA_TEXT.damage.font,
      strokeStyle: payload.strokeStyle ?? "black",
      strokeWidth: Number(payload.strokeWidth ?? TIBIA_TEXT.damage.strokeWidth),
      rise: Number(payload.rise ?? TIBIA_TEXT.damage.rise),
      driftX: Number(payload.driftX ?? 0),
    });
  }

  // --- COMBAT_DAMAGE (dano ou cura) ---
  // Coordenadas em tile units — gameCore.js multiplica por TILE_SIZE no render
  const unsubDamage = worldEvents.subscribe(
    EVENT_TYPES.COMBAT_DAMAGE,
    (event) => {
      const x = event.defenderX ?? 0;
      const y = event.defenderY ?? 0;
      const amount = Math.round(Math.abs(event.damage ?? 0));
      if (!amount) return;

      if (event.isHeal) {
        push({ x, y, text: `+${amount}`, ...TIBIA_TEXT.heal });
      } else if (event.isCritical) {
        push({ x, y, text: `${amount}!!`, ...TIBIA_TEXT.critical });
      } else {
        push({ x, y, text: `${amount}`, ...TIBIA_TEXT.damage });
      }
    },
  );

  // --- COMBAT_MISS ---
  const unsubMiss = worldEvents.subscribe(EVENT_TYPES.COMBAT_MISS, (event) => {
    const x = event.defenderX ?? 0;
    const y = event.defenderY ?? 0;
    push({ x, y, text: "MISS", ...TIBIA_TEXT.miss });
  });

  // --- COMBAT_CRITICAL (pode vir separado do DAMAGE) ---
  const unsubCrit = worldEvents.subscribe(
    EVENT_TYPES.COMBAT_CRITICAL,
    (event) => {
      const x = event.defenderX ?? 0;
      const y = event.defenderY ?? 0;
      const amount = Math.round(Math.abs(event.damage ?? 0));
      if (!amount) return;
      push({ x, y, text: `${amount}!!`, ...TIBIA_TEXT.critical });
    },
  );

  // --- ENTITY_UPDATE com statusLabel (status de campo, veneno, etc.) ---
  const unsubStatus = worldEvents.subscribe(
    EVENT_TYPES.ENTITY_UPDATE,
    (event) => {
      if (!event.statusLabel) return;
      const x = event.entityX ?? 0;
      const y = event.entityY ?? 0;
      push({ x, y, text: String(event.statusLabel).toUpperCase(), ...TIBIA_TEXT.status });
    },
  );

  // Retorna cleanup
  return function cleanup() {
    unsubDamage();
    unsubMiss();
    unsubCrit();
    unsubStatus();
  };
}

// ---------------------------------------------------------------------------
// HELPERS PARA USO AVULSO (sem precisar dos eventos)
// ---------------------------------------------------------------------------

/**
 * Empurra texto de dano/cura diretamente (para uso em código legado ou testes).
 * Preferir initCombatTextUI + eventos onde possível.
 */
export function pushDamageText(floatingTexts, entity, delta) {
  if (!entity || !delta) return;
  const isDamage = delta < 0;
  const amount = Math.round(Math.abs(delta));
  const style = isDamage ? TIBIA_TEXT.damage : TIBIA_TEXT.heal;
  floatingTexts.push({
    x: entity.x,
    y: entity.y,
    text: isDamage ? `${amount}` : `+${amount}`,
    startTime: Date.now(),
    ...style,
  });
}

/**
 * Empurra texto de MISS diretamente.
 */
export function pushMissText(floatingTexts, entity) {
  if (!entity) return;
  floatingTexts.push({
    x: entity.x,
    y: entity.y,
    text: "MISS",
    startTime: Date.now(),
    ...TIBIA_TEXT.miss,
  });
}

/**
 * Empurra texto de status (buff/debuff) diretamente.
 */
export function pushStatusText(floatingTexts, entity, label) {
  if (!entity) return;
  floatingTexts.push({
    x: entity.x,
    y: entity.y,
    text: String(label || "STATUS").toUpperCase(),
    startTime: Date.now(),
    ...TIBIA_TEXT.status,
  });
}
