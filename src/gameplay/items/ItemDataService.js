// =============================================================================
// ItemDataService.js — mmoRPGEduc
// Serviço de consulta de propriedades de itens a partir do map_data.json.
//
// Responsabilidades:
//   • Responder se um tile/item pode ser movido (is_movable)
//   • Responder se um tile/item pode ser pego (is_pickupable)
//   • Expor metadados do item (categoria, sprite, etc.)
//   • Servir como fonte da verdade para drag & drop e itemActions
//
// Fonte de dados: worldState.mapData (carregado no boot via map_data.json)
// Nenhuma chamada Firebase — apenas consulta do cache em memória.
//
// Estrutura esperada em map_data.json por entrada:
//   {
//     "3349": {
//       "id": 3349,
//       "variants": { "0": { "x":1808,"y":0,"w":31,"h":31,"atlas_name":"atlas_items","atlas_index":2 } },
//       "game": {
//         "is_movable": true,
//         "is_pickupable": true,
//         "is_stackable": false,
//         "is_usable": false,
//         "category_type": "item",
//         "render_layer": 2
//       },
//       "flags_raw": {
//         "take": true,
//         "clothes": { "slot": 0 },
//         "item_name": null
//       }
//     }
//   }
// =============================================================================

// Mapeamento de slot numérico (flags_raw.clothes.slot) para nome canônico
// Baseado nos dados observados em map_data.json (slots 0 e 6 encontrados)
// Expandir conforme mais itens forem catalogados
const SLOT_NUMBER_TO_NAME = Object.freeze({
  0: 'weapon',
  1: 'shield',
  2: 'head',
  3: 'chest',
  4: 'legs',
  5: 'feet',
  6: 'ring',
  7: 'amulet',
  8: 'back',
  9: 'gloves',
});

export class ItemDataService {
  /**
   * @param {Object} mapData - Referência ao worldState.mapData (map_data.json em memória)
   */
  constructor(mapData) {
    this._data = mapData ?? {};
  }

  // ---------------------------------------------------------------------------
  // Queries de capacidade (usadas por DragDropManager e itemActions)
  // ---------------------------------------------------------------------------

  /**
   * Retorna true se o item com este tileId pode ser pego pelo jogador.
   * Fonte: game.is_pickupable || flags_raw.take
   * @param {number|string} tileId
   */
  canPickUp(tileId) {
    const entry = this._get(tileId);
    if (!entry) return false;
    return !!(entry.game?.is_pickupable || entry.flags_raw?.take);
  }

  /**
   * Retorna true se o item pode ser movido (arrastado no drag & drop).
   * Fonte: game.is_movable
   * @param {number|string} tileId
   */
  canMove(tileId) {
    const entry = this._get(tileId);
    if (!entry) return false;
    return !!entry.game?.is_movable;
  }

  /**
   * Retorna true se o tileId corresponde a um item (não terreno, não objeto fixo).
   * Fonte: game.category_type === 'item'
   * @param {number|string} tileId
   */
  isItem(tileId) {
    const entry = this._get(tileId);
    return entry?.game?.category_type === 'item';
  }

  /**
   * Retorna true se o item é empilhável.
   * @param {number|string} tileId
   */
  isStackable(tileId) {
    return !!this._get(tileId)?.game?.is_stackable;
  }

  /**
   * Retorna true se o item pode ser usado diretamente.
   * @param {number|string} tileId
   */
  isUsable(tileId) {
    return !!this._get(tileId)?.game?.is_usable;
  }

  // ---------------------------------------------------------------------------
  // Consultas de metadados
  // ---------------------------------------------------------------------------

  /**
   * Retorna o objeto `game` completo da entrada, ou null se não encontrado.
   * @param {number|string} tileId
   * @returns {{ is_movable, is_pickupable, is_stackable, is_usable, category_type, render_layer }|null}
   */
  getGameProps(tileId) {
    return this._get(tileId)?.game ?? null;
  }

  /**
   * Retorna as informações de sprite de uma variante do item.
   * @param {number|string} tileId
   * @param {number} [variantIdx=0]
   * @returns {{ x, y, w, h, atlas_name, atlas_index }|null}
   */
  getVariant(tileId, variantIdx = 0) {
    const entry = this._get(tileId);
    return entry?.variants?.[variantIdx] ?? entry?.variants?.['0'] ?? null;
  }

  /**
   * Retorna o nome canônico do slot de equipamento (ex: 'weapon', 'ring')
   * a partir do número em flags_raw.clothes.slot, ou null se não for equipamento.
   * @param {number|string} tileId
   * @returns {string|null}
   */
  getEquipmentSlotName(tileId) {
    const entry = this._get(tileId);
    const slotNum = entry?.flags_raw?.clothes?.slot;
    if (slotNum == null) return null;
    return SLOT_NUMBER_TO_NAME[slotNum] ?? `slot_${slotNum}`;
  }

  /**
   * Retorna o nome do item (flags_raw.item_name) ou null se não definido.
   * @param {number|string} tileId
   */
  getItemName(tileId) {
    return this._get(tileId)?.flags_raw?.item_name ?? null;
  }

  /**
   * Retorna a entrada completa de map_data para o tileId, ou null.
   * @param {number|string} tileId
   * @returns {Object|null}
   */
  getEntry(tileId) {
    return this._get(tileId) ?? null;
  }

  /**
   * Retorna todos os tileIds com is_pickupable=true.
   * @returns {number[]}
   */
  getAllPickupableIds() {
    return Object.keys(this._data)
      .filter((k) => this.canPickUp(k))
      .map(Number);
  }

  /**
   * Retorna todos os tileIds com category_type === 'item'.
   * @returns {number[]}
   */
  getAllItemIds() {
    return Object.keys(this._data)
      .filter((k) => this.isItem(k))
      .map(Number);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _get(tileId) {
    if (tileId == null) return null;
    return this._data[tileId] ?? this._data[String(tileId)] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Singleton de conveniência — populado pelo initializer.js no boot
// ---------------------------------------------------------------------------

let _instance = null;

/**
 * Inicializa o singleton com o mapData carregado no boot.
 * Deve ser chamado UMA VEZ em initInventoryUI() (ou initServices()).
 * @param {Object} mapData
 */
export function initItemDataService(mapData) {
  _instance = new ItemDataService(mapData);
  return _instance;
}

/**
 * Retorna o singleton. Retorna null se ainda não inicializado.
 * @returns {ItemDataService|null}
 */
export function getItemDataService() {
  return _instance;
}
