// ═══════════════════════════════════════════════════════════════
// collision.js — Regras de colisão compartilhadas
// Usado por: gameplay/input.js, gameplay/monsterAI.js
//
// SISTEMA 1 — Movimento físico (estrito por tag):
//             entidades só caminham em tiles que tenham
//             pelo menos um item com game.is_walkable === true,
//             e nenhum item com game.is_walkable === false.
// SISTEMA 1b— Custo de terreno:  game.movement_cost (água/lava >= 500)
// SISTEMA 2 — Projéteis/magias:  game.blocks_missiles === true
// SISTEMA 3 — Linha de visão:    game.blocks_sight === true
//
// Fallback formato antigo: flags_raw.unreadable === true
// ═══════════════════════════════════════════════════════════════

// Criaturas normais não entram em tiles com movement_cost >= threshold.
// Tiles com cost === 1 também são tratados como impassáveis para NPCs.
const IMPASSABLE_COST_THRESHOLD = 500;

// ── Helpers por item ──────────────────────────────────────────

function _itemBlocksMovement(meta) {
  if (!meta) return false;
  if (meta.game) {
    // is_walkable:false → objeto fisicamente bloqueante (parede, árvore, caixa...)
    // movement_cost:0  → não é tile de chão (objeto de mapa), portanto bloqueia passagem
    return meta.game.is_walkable === false || meta.game.movement_cost === 0;
  }
  // Fallback formato antigo
  if (meta?.flags_raw?.unreadable === true) return true;
  return false;
}

function _itemBlocksMissiles(meta) {
  if (!meta) return false;
  if (meta.game) return meta.game.blocks_missiles === true;
  // Fallback formato antigo
  if (meta?.flags_raw?.unreadable === true) return true;
  return false;
}

function _itemBlocksSight(meta) {
  if (!meta) return false;
  if (meta.game) return meta.game.blocks_sight === true;
  // Fallback formato antigo
  if (meta?.flags_raw?.unreadable === true) return true;
  return false;
}

// ── Extração de IDs de tile (suporta array legado e formato compacto) ────────
//
// Formato legado:   [100, 103, 4538]  (array de IDs numéricos)
// Formato compacto: { "0": [{id:100, count:1}], "1": [{id:4538, count:1}] }
//                   (objeto de layers indexadas com objetos {id, count})
//
function _extractItemIds(tileValue) {
  if (!tileValue) return [];
  if (Array.isArray(tileValue)) {
    // Legado: array de números ou objetos {id}
    return tileValue.map((v) => (typeof v === "object" ? v.id : v)).filter(Boolean);
  }
  if (typeof tileValue === "object") {
    // Compacto: { "0": [{id, count}], "1": [...] }
    const ids = [];
    for (const layer of Object.values(tileValue)) {
      if (Array.isArray(layer)) {
        for (const item of layer) {
          const id = typeof item === "object" ? item.id : item;
          if (id != null) ids.push(id);
        }
      }
    }
    return ids;
  }
  return [];
}

// ── API pública ───────────────────────────────────────────────

/**
 * Colisão física de movimento (player e monstros).
 * Regra estrita:
 *   1) tile precisa ter PELO MENOS um item com game.is_walkable === true
 *   2) se qualquer item do tile tiver game.is_walkable === false, bloqueia
 *
 * Observação: para movimento de entidades, tags legadas (flags_raw.unreadable)
 * não são mais critério principal.
 */
export function isTileWalkable(x, y, z, worldTiles, nexoData) {
  const raw = worldTiles?.[`${x},${y},${z}`];
  if (!raw) return false;
  if (!nexoData) return false;

  const ids = _extractItemIds(raw);
  let hasWalkableTrue = false;

  for (const itemId of ids) {
    const meta = nexoData[String(itemId)];
    const walkable = meta?.game?.is_walkable;

    if (walkable === false) return false;
    if (walkable === true) hasWalkableTrue = true;
  }

  return hasWalkableTrue;
}

/**
 * Retorna o custo de movimento do tile (game.movement_cost do item ground, índice 0).
 * Valores: 0 = não é ground; 1 = tile especial; 50-200 = normal; >= 500 = água/lava.
 * Retorna Infinity quando o tile não existe ou movement_cost === 0 (não é chão).
 */
export function getTileMovementCost(x, y, z, worldTiles, nexoData) {
  const raw = worldTiles?.[`${x},${y},${z}`];
  if (!raw || !nexoData) return Infinity;

  const ids = _extractItemIds(raw);
  if (ids.length === 0) return Infinity;

  const cost = nexoData[String(ids[0])]?.game?.movement_cost ?? 0;
  return cost === 0 ? Infinity : cost;
}

/**
 * Verifica se um tile é passável para NPCs/monstros.
 * Combina colisão física (is_walkable) + custo de terreno:
 *   - cost === 1    → tile especial, impassável para IA
 *   - cost >= 500   → água profunda / lava / abismo
 */
export function isPassableForMob(x, y, z, worldTiles, nexoData) {
  if (!isTileWalkable(x, y, z, worldTiles, nexoData)) return false;
  const cost = getTileMovementCost(x, y, z, worldTiles, nexoData);
  if (cost === 1) return false; // tile especial de chão
  if (cost >= IMPASSABLE_COST_THRESHOLD) return false; // água, lava, abismo
  return true;
}

/**
 * Verifica se um tile bloqueia projéteis e magias.
 * Apenas itens com blocks_missiles === true bloqueiam.
 * Obstáculos (árvores, pedras) NÃO bloqueiam — magias passam por eles.
 */
export function tileBlocksMissiles(x, y, z, worldTiles, nexoData) {
  const raw = worldTiles?.[`${x},${y},${z}`];
  if (!raw || !nexoData) return false;

  for (const itemId of _extractItemIds(raw)) {
    if (_itemBlocksMissiles(nexoData[String(itemId)])) return true;
  }
  return false;
}

/**
 * Verifica se um tile bloqueia linha de visão (targeting de spells, aggro).
 * blocks_sight = unpassable AND block_missile — mais restrito que blocks_missiles.
 */
export function tileBlocksSight(x, y, z, worldTiles, nexoData) {
  const raw = worldTiles?.[`${x},${y},${z}`];
  if (!raw || !nexoData) return false;

  for (const itemId of _extractItemIds(raw)) {
    if (_itemBlocksSight(nexoData[String(itemId)])) return true;
  }
  return false;
}
