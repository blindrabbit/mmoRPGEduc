// =============================================================================
// itemClassification.js — Classificação de itens para walkability e superfícies
// mmoRPGEduc — OTClient/Canary compatible
//
// Este arquivo define regras específicas para IDs de itens que não seguem
// as regras gerais de game.is_walkable e game.category_type.
//
// Use para:
//   - Forçar walkable em itens que são chão mas não têm a flag
//   - Forçar não-walkable em itens que parecem chão mas são decorativos
//   - Definir superfícies específicas (mesas, bancadas, prateleiras)
// =============================================================================

export const ITEM_CLASSIFICATION = Object.freeze({
  // Itens que SÃO walkable (chão, grama, água rasa)
  WALKABLE_IDS: new Set([
    // Chão básico
    410, // grama/terra
    351, // chão de madeira
    354, // chão de pedra
    355, // chão de tiles
  ]),

  // Itens que NÃO SÃO walkable (paredes, obstáculos)
  NOT_WALKABLE_IDS: new Set([
    // Paredes
    101, // parede básica
    1026,
    1027, // paredes multi-tile
    5712,
    5713,
    5714,
    5715,
    5717,
    5718,
    5719,
    5720,
    5721,
    5722,
    5723,
    5724,
    5725,
    5726,

    // Obstáculos/vegetação (árvores, arbustos)
    4597,
    4598,
    4599,
    4600,
    4601,
    4602, // vegetação baixa
    4609,
    4610,
    4611,
    4612,
    4613,
    4614, // arbustos
    4633,
    4634,
    4635,
    4636,
    4637,
    4638,
    4639,
    4644, // árvores/vegetação alta
  ]),

  // Itens que PODEM RECEBER itens em cima (superfícies)
  SURFACE_IDS: new Set([
    // Chão (sempre superfície)
    410, // grama
    351,
    354,
    355, // tipos de chão

    // Mesas e bancadas (adicionar IDs específicos quando identificar)
    // 2263,  // exemplo: mesa
    // 2908,  // exemplo: bancada
  ]),

  // Itens que NÃO PODEM receber itens em cima
  NO_SURFACE_IDS: new Set([
    // Paredes
    101,
    1026,
    1027,

    // Vegetação alta (árvores) - NÃO podem receber itens
    4633,
    4634,
    4635,
    4636,
    4637,
    4638,
    4639,
    4644,

    // Decoração de parede
    1281,
    1282, // hooks/ganchos
  ]),

  // Containers (sempre podem receber itens)
  CONTAINER_IDS: new Set([
    // Baús, barris, armários (adicionar quando identificar)
    // 1772,  // exemplo: baú
    // 1780,  // exemplo: barril
  ]),
});

/**
 * Verifica se um item é walkable (classificação específica por ID).
 * @param {number|string} tileId
 * @returns {boolean|null} true/false se classificado, null se não classificado
 */
export function isWalkableById(tileId) {
  const id = Number(tileId);
  if (ITEM_CLASSIFICATION.WALKABLE_IDS.has(id)) return true;
  if (ITEM_CLASSIFICATION.NOT_WALKABLE_IDS.has(id)) return false;
  return null; // Não classificado → usa regra geral
}

/**
 * Verifica se um item pode receber outros itens em cima.
 * @param {number|string} tileId
 * @returns {boolean|null} true/false se classificado, null se não classificado
 */
export function canReceiveItemsById(tileId) {
  const id = Number(tileId);
  if (ITEM_CLASSIFICATION.SURFACE_IDS.has(id)) return true;
  if (ITEM_CLASSIFICATION.CONTAINER_IDS.has(id)) return true;
  if (ITEM_CLASSIFICATION.NO_SURFACE_IDS.has(id)) return false;
  return null; // Não classificado → usa regra geral
}
