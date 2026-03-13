// ═══════════════════════════════════════════════════════════════
// spriteCrop.js — Regras de cálculo de fonte/crop de sprites
//
// Regras (compatíveis com OTClient / Canary):
//  1. spritetype define dimensões do tile na sheet
//  2. Campo 'area' sobrescreve cols padrão da sheet
//  3. Sprite ID 0 = transparente (não renderiza)
//  4. Sprites ≤32px: bounding_box indica crop REAL (ajusta rect de fonte)
//  5. Sprites >32px: bounding_box é displacement visual (não altera rect)
//  6. Crop só aplica quando bbox está dentro dos limites do tile
//
// Uso típico: fallback quando mapAtlasLookup não contém o sprite.
// O pipeline principal usa atlas pré-construídos pelo Python, mas este
// módulo serve como referência e para casos de construção dinâmica.
// ═══════════════════════════════════════════════════════════════

export const SPRITE_SHEET_TYPES = Object.freeze({
  0: { tileW: 32, tileH: 32, cols: 12, rows: 12 },
  1: { tileW: 32, tileH: 64, cols: 12, rows: 6 },
  2: { tileW: 64, tileH: 32, cols: 6, rows: 12 },
  3: { tileW: 64, tileH: 64, cols: 6, rows: 6 },
});

/**
 * Calcula o rect de fonte e deslocamento visual de um sprite.
 *
 * @param {number} spriteId          - ID do sprite (0 = transparente)
 * @param {Object} catalogEntry      - Entrada do catálogo com firstspriteid, spritetype, area
 * @param {Object} [metadata]        - Metadata do map_data.json (bounding_box, etc.)
 * @returns {{
 *   x: number, y: number, w: number, h: number,
 *   transparent: boolean,
 *   displacement: { x: number, y: number } | null
 * }}
 */
export function calculateSpriteRect(spriteId, catalogEntry, metadata) {
  // Regra 3: Sprite ID 0 = transparente
  if (!spriteId) {
    return { x: 0, y: 0, w: 32, h: 32, transparent: true, displacement: null };
  }

  // Regra 1: spritetype define dimensões do tile
  const sheetInfo =
    SPRITE_SHEET_TYPES[catalogEntry?.spritetype ?? 0] ?? SPRITE_SHEET_TYPES[0];
  const { tileW, tileH } = sheetInfo;

  // Regra 2: campo 'area' sobrescreve cols padrão
  const actualCols =
    catalogEntry?.area > 0 ? catalogEntry.area : sheetInfo.cols;

  // Posição do sprite na sheet
  const localId = spriteId - (catalogEntry?.firstspriteid ?? 0);
  const col = localId % actualCols;
  const row = Math.floor(localId / actualCols);

  let srcX = col * tileW;
  let srcY = row * tileH;
  let srcW = tileW;
  let srcH = tileH;

  const _bb = metadata?.bounding_box;
  const bbox = (Array.isArray(_bb) ? _bb[0] : _bb) ?? null;

  const isLarge = tileW > 32 || tileH > 32;

  if (bbox && bbox.width > 0 && bbox.height > 0) {
    if (!isLarge) {
      // Regra 4+6: sprites ≤32px → bbox é crop REAL (valida limites)
      const { x: bx = 0, y: by = 0, width: bw, height: bh } = bbox;
      if (bx >= 0 && by >= 0 && bx + bw <= tileW && by + bh <= tileH) {
        srcX += bx;
        srcY += by;
        srcW = bw;
        srcH = bh;
      }
      return { x: srcX, y: srcY, w: srcW, h: srcH, transparent: false, displacement: null };
    }

    // Regra 5: sprites >32px → bbox é apenas displacement, sem crop
    return {
      x: srcX,
      y: srcY,
      w: srcW,
      h: srcH,
      transparent: false,
      displacement: { x: bbox.x ?? 0, y: bbox.y ?? 0 },
    };
  }

  return { x: srcX, y: srcY, w: srcW, h: srcH, transparent: false, displacement: null };
}
