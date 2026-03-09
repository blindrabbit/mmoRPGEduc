// ═══════════════════════════════════════════════════════════════
// admin_loader.js — Parser OTBM JSON → Firebase world_tiles
// Usado por: admin.html
// Depende de: firebaseClient.js
// ═══════════════════════════════════════════════════════════════

import { db } from "../../../core/firebaseClient.js";
import {
  ref,
  set,
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-database.js";

const GROUND_Z = 7;

// ═══════════════════════════════════════════════════════════════
// PARSER OTBM → lookup "x,y,z"
// ═══════════════════════════════════════════════════════════════

/**
 * Percorre a árvore OTBM recursivamente e constrói o lookup de tiles.
 *
 * Estrutura esperada:
 *   node.type === 4  → TileArea  (define base_z do andar)
 *   node.type === 5  → Tile      (define x, y e lista de items)
 *   node.type === 6  → Item      (props.itemid)
 */
function parseOTBM(node, ctx = { z: GROUND_Z }, result = {}) {
  if (!node) return result;

  // TileArea — atualiza o z do contexto
  if (node.type === 4 && node.props) {
    ctx = { z: node.props.base_z ?? GROUND_Z };
  }

  // Tile — extrai posição e items
  if (node.type === 5 && node.props) {
    const { x, y } = node.props;
    const z = ctx.z;
    const key = `${x},${y},${z}`;

    const items = (node.children ?? [])
      .filter((c) => c.type === 6 && c.props?.itemid)
      .map((c) => c.props.itemid); // ← era c.props.item_id (bug corrigido)

    result[key] = { x, y, z, items };
  }

  for (const child of node.children ?? []) {
    parseOTBM(child, ctx, result);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════════════════════════════

/**
 * Faz o parse do JSON exportado pelo canary-map-editor
 * e envia os tiles ao Firebase em world_tiles.
 *
 * @param {object} mapData — JSON completo do OTBM
 * @returns {Promise<number>} — quantidade de tiles enviados
 */
export async function uploadWorld(mapData) {
  const worldTiles = parseOTBM(mapData);
  const count = Object.keys(worldTiles).length;

  if (count === 0) {
    console.warn("[admin_loader] ⚠️ Nenhum tile encontrado no JSON.");
    return 0;
  }

  await set(ref(db, "world_tiles"), worldTiles);
  console.log(`[admin_loader] ✅ ${count} tiles enviados ao Firebase.`);
  return count;
}
