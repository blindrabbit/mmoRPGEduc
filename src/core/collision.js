// ═══════════════════════════════════════════════════════════════
// collision.js — Regras de colisão compartilhadas
// Usado por: gameplay/input.js, gameplay/monsterAI.js
//
// SISTEMA 1 — Movimento físico (estrito por tag):
//             entidades só caminham em tiles que tenham
//             pelo menos um item com game.walkable === true,
//             e nenhum item com game.walkable === false.
// SISTEMA 1b— Custo de terreno:  game.movement_cost (água/lava >= 500)
// SISTEMA 2 — Projéteis/magias:  game.blocks_missiles === true
// SISTEMA 3 — Linha de visão:    game.blocks_sight === true
//
// Fallback formato novo: game.flags.movement.unpass
// Fallback formato antigo: flags_raw.unpass === true
// Fallback por ID: itemClassification.js (NOT_WALKABLE_IDS / WALKABLE_IDS)
// ═══════════════════════════════════════════════════════════════

import { isWalkableById } from "../gameplay/items/itemClassification.js";

// Criaturas normais não entram em tiles com movement_cost >= threshold.
// Tiles com cost === 1 também são tratados como impassáveis para NPCs.
const IMPASSABLE_COST_THRESHOLD = 500;

// ── Helpers por item ──────────────────────────────────────────

/**
 * Retorna true/false/null para walkability de um item.
 *   true  = confirma que o tile é walkable (tile de chão)
 *   false = bloqueia o tile (parede, objeto sólido)
 *   null  = sem informação (ignorar na decisão)
 *
 * Ordem de verificação:
 *   1. itemClassification.js (NOT_WALKABLE_IDS / WALKABLE_IDS) — máxima prioridade
 *   2. game.walkable (novo) ou game.is_walkable (legado)
 *   3. game.flags.movement.unpass / game.flags.movement.bank (novo)
 *   4. flags_raw.unpass / bank.waypoints (formato antigo)
 *
 * @param {Object|null} meta - Entrada do map_data para o item
 * @param {number|null} [itemId] - ID numérico do item (para lookup em itemClassification)
 */
function _itemWalkable(meta, itemId) {
  // 1. Classificação explícita por ID (inclui árvores, paredes, chãos mapeados)
  if (itemId != null) {
    const byId = isWalkableById(itemId);
    if (byId !== null) return byId;
  }

  if (!meta) return null;

  // 2. game.walkable (novo) ou game.is_walkable (legado)
  if (meta.game) {
    const w = meta.game.walkable ?? meta.game.is_walkable;
    if (w === false) return false;
    if (w === true) return true;
  }

  // 3. game.flags.movement.unpass (novo) ou flags_raw.unpass (legado)
  const unpass = meta?.game?.flags?.movement?.unpass ?? meta?.flags_raw?.unpass;
  if (unpass === true) return false;

  // 4. bank.waypoints > 0 = tile de chão walkable
  const bankNew = meta?.game?.flags?.movement?.bank;
  const bankOld = meta?.flags_raw?.bank;
  const bank = bankNew ?? bankOld;
  const waypoints = typeof bank === "object" ? bank?.waypoints : (bank != null ? 1 : null);
  if (typeof waypoints === "number" && waypoints > 0) return true;

  return null;
}

function _itemBlocksMovement(meta) {
  if (!meta) return false;
  if (meta.game) {
    const w = meta.game.walkable ?? meta.game.is_walkable;
    if (w === false) return true;
    if (meta.game.movement_cost === 0) return true;
  }
  const unpass = meta?.game?.flags?.movement?.unpass ?? meta?.flags_raw?.unpass;
  return unpass === true;
}

function _itemBlocksMissiles(meta) {
  if (!meta) return false;
  if (meta.game) return meta.game.blocks_missiles === true;
  const unpass = meta?.game?.flags?.movement?.unpass ?? meta?.flags_raw?.unpass;
  return unpass === true;
}

function _itemBlocksSight(meta) {
  if (!meta) return false;
  if (meta.game) return meta.game.blocks_sight === true;
  const unpass = meta?.game?.flags?.movement?.unpass ?? meta?.flags_raw?.unpass;
  return unpass === true;
}

// ── Extração de IDs de tile (suporta array legado e formato compacto) ────────
//
// Formato legado:   [100, 103, 4538]  (array de IDs numéricos)
// Formato compacto: { "0": [{id:100, count:1}], "1": [{id:4538, count:1}] }
//                   (objeto de layers indexadas com objetos {id, count})
// Formato Firebase: { layers: {"0": [...], "2": [...]}, flags: N, houseId: ... }
//                   (tile completo do map_compacto.json / world_tiles)
//
function _extractItemIds(tileValue) {
  if (!tileValue) return [];
  if (Array.isArray(tileValue)) {
    // Legado: array de números ou objetos {id}
    return tileValue.map((v) => (typeof v === "object" ? v.id : v)).filter(Boolean);
  }
  if (typeof tileValue === "object") {
    // Detecta formato Firebase com wrapper { layers: {...}, flags: N, houseId: ... }
    const layersObj =
      tileValue.layers != null &&
      typeof tileValue.layers === "object" &&
      !Array.isArray(tileValue.layers)
        ? tileValue.layers
        : tileValue;
    const ids = [];
    for (const layer of Object.values(layersObj)) {
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
 * Observação: para movimento de entidades, tags legadas (flags_raw.unpass)
 * não são mais critério principal.
 */
export function isTileWalkable(x, y, z, worldTiles, nexoData) {
  const raw = worldTiles?.[`${x},${y},${z}`];
  if (!raw) return false;
  if (!nexoData) return false;

  const ids = _extractItemIds(raw);
  if (ids.length === 0) return false;

  let hasWalkableTrue = false;
  let hasAnyKnownItem = false;

  for (const itemId of ids) {
    const meta = nexoData[String(itemId)];
    const walkable = _itemWalkable(meta, itemId);

    if (walkable === false) return false;   // bloqueio explícito → para imediatamente
    if (walkable === true) hasWalkableTrue = true;  // ao menos um confirma ground
    if (meta != null || isWalkableById(itemId) !== null) hasAnyKnownItem = true;
  }

  // Se nenhum item tem metadados no nexoData, não bloquear o movimento
  return hasWalkableTrue || !hasAnyKnownItem;
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
 * Verifica se um tile tem bloqueio EXPLÍCITO de movimento (parede real).
 * Diferente de isTileWalkable, esta função retorna true SOMENTE quando
 * há pelo menos um item com game.is_walkable === false.
 * Tiles sem dados ou sem flag explícita são considerados NÃO bloqueados.
 * Usado por dropItem para não bloquear drops em tiles sem metadados.
 */
export function isTileBlockedByWall(x, y, z, worldTiles, nexoData) {
  const raw = worldTiles?.[`${x},${y},${z}`];
  if (!raw || !nexoData) return false; // sem dados = não é parede
  for (const itemId of _extractItemIds(raw)) {
    if (_itemWalkable(nexoData[String(itemId)], itemId) === false) return true;
  }
  return false;
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
