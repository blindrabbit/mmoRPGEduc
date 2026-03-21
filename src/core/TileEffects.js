// ═══════════════════════════════════════════════════════════════
// TileEffects.js — Efeitos ao pisar em um tile
//
// Detecta automaticamente o que acontece quando o player pisa em
// um tile: teleportes e mudanças de andar (escadas/buracos).
//
// Uso:
//   const effect = resolveStepOnEffects(x, y, z, worldState);
//   if (effect?.type === 'teleport')      → mover player para effect.dest
//   if (effect?.type === 'floor_change')  → mover player para effect.newX/Y/Z
//
// Fontes de dados:
//   teleportDest  — por instância de item em worldState.map[coord]
//   isFloorChange — por tile flag em worldState.flagDefs (FlagResolver)
// ═══════════════════════════════════════════════════════════════

import { FlagResolver } from "./FlagResolver.js";

// ── Teleport ────────────────────────────────────────────────────

/**
 * Lê os itens do tile e procura teleportDest em qualquer layer.
 * Ignora destinos (0,0,0) — teleporte não configurado no editor.
 * @param {Object} tile  — entrada de worldState.map[coord]
 * @returns {{x:number, y:number, z:number}|null}
 */
function _findTeleportDest(tile) {
  if (!tile || typeof tile !== "object") return null;

  // Suporta ambos os formatos: { layers: {…} } e { "0": […], "1": […] }
  const layers =
    tile.layers != null &&
    typeof tile.layers === "object" &&
    !Array.isArray(tile.layers)
      ? tile.layers
      : tile;

  for (const [key, layerItems] of Object.entries(layers)) {
    if (key.startsWith("_")) continue; // ignora __flags, __houseId
    if (!Array.isArray(layerItems)) continue;
    for (const item of layerItems) {
      if (!item || typeof item !== "object") continue;
      const d = item.teleportDest;
      if (d && (d.x !== 0 || d.y !== 0 || d.z !== 0)) {
        return { x: d.x, y: d.y, z: d.z };
      }
    }
  }
  return null;
}

// ── Floor Change ────────────────────────────────────────────────

/**
 * Dado que um tile tem isFloorChange=true, determina para qual
 * andar (z) o player deve ir, inferindo a direção por contexto:
 *
 *  - Se há tile no mesmo (x,y) no andar ACIMA (z-1) → subir
 *  - Senão → descer (z+1)
 *
 * Posição de saída segue o padrão clássico do Tibia:
 *  - Subindo: mesma posição x,y no andar acima
 *  - Descendo: player aparece 1 tile ao sul (y+1) no andar abaixo,
 *    pois o "buraco" fica no tile de origem
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Object} map  — worldState.map
 * @returns {{newX:number, newY:number, newZ:number}}
 */
function _resolveFloorChangeDirection(x, y, z, map) {
  const aboveCoord = `${x},${y},${z - 1}`;
  const goingUp = map?.[aboveCoord] != null;

  if (goingUp) {
    return { newX: x, newY: y, newZ: z - 1 };
  }
  // Descendo: aparece 1 tile ao sul no andar abaixo (padrão Tibia)
  return { newX: x, newY: y + 1, newZ: z + 1 };
}

// ── API pública ─────────────────────────────────────────────────

/**
 * Verifica se o tile em (x, y, z) tem efeito ao ser pisado.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Object} worldState  — { map, flagDefs }
 * @returns {null
 *   | { type: 'teleport',      dest: {x,y,z} }
 *   | { type: 'floor_change',  newX, newY, newZ }
 * }
 */
export function resolveStepOnEffects(x, y, z, worldState) {
  const coord = `${x},${y},${z}`;
  const tile = worldState?.map?.[coord];
  if (!tile) return null;

  // 1. Teleporte — instância de item tem teleportDest configurado
  const dest = _findTeleportDest(tile);
  if (dest) {
    return { type: "teleport", dest };
  }

  // 2. Mudança de andar — tile flag isFloorChange
  const flagId = tile.__flags ?? 0;
  const flags = FlagResolver.resolve(flagId);
  if (flags.isFloorChange) {
    const { newX, newY, newZ } = _resolveFloorChangeDirection(
      x,
      y,
      z,
      worldState.map,
    );
    return { type: "floor_change", newX, newY, newZ };
  }

  return null;
}
