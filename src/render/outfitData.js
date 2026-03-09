// ═══════════════════════════════════════════════════════════════
// outfitData.js — Sprites e offsets de personagens e monstros
//
// Como adicionar um novo outfit:
//   1. Copie um bloco existente
//   2. Troque a chave (ex: "10001")
//   3. Ajuste offX/offY para centralizar o sprite no tile
//   4. Ajuste os frames com os IDs do atlas
//
// ── CAMPOS ───────────────────────────────────────────────────
//   offX / offY         → deslocamento local do sprite (soma com GLOBAL_OFFSET)
//   offShadowX/Y        → deslocamento da sombra em relação ao sprite
//   shadowW / shadowH   → tamanho da elipse de sombra
//   frames.frente       → [frame_parado, passo_1, passo_2]
//   frames.costas       → idem, andando para cima
//   frames.lado         → idem, andando para direita
//   frames.lado-esquerdo→ idem, andando para esquerda
// ═══════════════════════════════════════════════════════════════

// ── Offset global para efeitos e cadáveres (gameCore.js)
// O posicionamento de entidades (monstros/players/NPCs) é controlado
// por ENTITY_RENDER em core/config.js — ajuste lá.
/** @deprecated use EFFECTS_RENDER em core/config.js */

// ── Mapa de outfits ───────────────────────────────────────────
export const OUTFIT_MAP = {
  // ── MONSTROS ─────────────────────────────────────────────────

  // Rat
  rat: {
    name: "Rat",
    offX: 8,
    offY: 8,
    offShadowX: -4,
    offShadowY: -16,
    shadowW: 4,
    shadowH: 4,
    frames: {
      frente: [2654, 2655, 2656],
      costas: [2657, 2658, 2659],
      lado: [2648, 2649, 2650],
      "lado-esquerdo": [2651, 2652, 2653],
    },
  },
};
