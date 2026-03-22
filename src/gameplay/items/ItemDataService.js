// =============================================================================
// ItemDataService.js — mmoRPGEduc
// Serviço de consulta de propriedades de itens a partir do map_data.json.
//
// Fonte de dados: worldState.mapData (carregado no boot via map_data.json)
// Nenhuma chamada Firebase — apenas consulta do cache em memória.
// =============================================================================

import {
  isWalkableById,
  canReceiveItemsById,
  ITEM_CLASSIFICATION,
} from "./itemClassification.js";

// Mapeamento de slot numérico (flags_raw.clothes.slot) para nome canônico
const SLOT_NUMBER_TO_NAME = Object.freeze({
  0: "weapon",
  1: "shield",
  2: "head",
  3: "chest",
  4: "legs",
  5: "feet",
  6: "ring",
  7: "amulet",
  8: "back",
  9: "gloves",
});

// Categorias de walkability (OTClient/Canary compatible)
const WALKABILITY = {
  WALKABLE: "walkable", // Pode andar (chão, grama, água rasa)
  NOT_WALKABLE: "not_walkable", // Não pode andar (parede, móvel, obstáculo)
  SURFACE: "surface", // Superfície para itens (mesa, bancada, chão)
};

// Categorias de stack (empilhamento de itens)
const STACKABILITY = {
  STACKABLE: "stackable", // Pode empilhar (moedas, alimentos)
  NOT_STACKABLE: "not_stackable", // Não empilha (equipamentos, ferramentas)
};

// Categorias de "allow pickupable" (pode receber itens em cima)
const ALLOW_PICKUPABLE = {
  YES: "yes", // Pode receber itens (chão, mesas, bancadas)
  NO: "no", // Não recebe itens (parede, ar, água profunda)
};

export class ItemDataService {
  /**
   * @param {Object} mapData - Referência ao worldState.mapData (map_data.json em memória)
   */
  constructor(mapData) {
    this._data = mapData ?? {};
    this._cache = new Map();
  }

  // ---------------------------------------------------------------------------
  // Queries de capacidade (usadas por DragDropManager e itemActions)
  // ---------------------------------------------------------------------------

  /**
   * Retorna true se o item com este tileId pode ser pego pelo jogador.
   * Fonte: game.pickupable (novo flat) || game.is_pickupable || flags_raw.take
   * @param {number|string} tileId
   */
  canPickUp(tileId) {
    const entry = this._get(tileId);
    if (!entry) return false;
    return !!(entry.game?.pickupable || entry.game?.is_pickupable || entry.flags_raw?.take);
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
    return entry?.game?.category_type === "item";
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
  // NOVO: Walkability e Superfícies (OTClient/Canary compatible)
  // ---------------------------------------------------------------------------

  /**
   * Classifica se um tile é walkable (pode ser pisado por creatures).
   * Regras (OTClient/Canary compatible):
   *   1. Verifica classificação específica por ID (itemClassification.js)
   *   2. is_walkable = true → WALKABLE
   *   3. is_walkable = false → NOT_WALKABLE
   *   4. Fallback: flags_raw (bank.waypoints, unpass)
   *   5. Sem flag → assume NOT_WALKABLE (seguro)
   * @param {number|string} tileId
   * @returns {string} 'walkable' | 'not_walkable'
   */
  getWalkability(tileId) {
    const id = Number(tileId);

    // 1. Verifica classificação específica por ID
    const byId = isWalkableById(id);
    if (byId !== null) {
      return byId ? WALKABILITY.WALKABLE : WALKABILITY.NOT_WALKABLE;
    }

    // 2. Verifica metadata do item
    const entry = this._get(tileId);
    if (!entry) return WALKABILITY.NOT_WALKABLE;

    if (entry.game?.is_walkable === true) return WALKABILITY.WALKABLE;
    if (entry.game?.is_walkable === false) return WALKABILITY.NOT_WALKABLE;

    // 3. game.walkable (novo flat) → derivado de unpass
    if (entry.game?.walkable === true) return WALKABILITY.WALKABLE;
    if (entry.game?.walkable === false) return WALKABILITY.NOT_WALKABLE;

    // 4. Flags planos (novo formato) e flags_raw (legado)
    const bank = entry.game?.bank ?? entry.flags_raw?.bank;
    if (typeof bank === "object" ? bank?.waypoints > 0 : bank != null) return WALKABILITY.WALKABLE;
    if (entry.game?.unpass === true || entry.flags_raw?.unpass === true) return WALKABILITY.NOT_WALKABLE;

    return WALKABILITY.NOT_WALKABLE;
  }

  /**
   * Verifica se um tile pode receber itens em cima (allow pickupable).
   * Regras (OTClient/Canary compatible):
   *   1. Verifica classificação específica por ID
   *   2. Chão (render_layer=0, is_walkable=true) → SIM
   *   3. Containers (baús, barris, armários) → SIM
   *   4. Mobília/superfícies (mesas, bancadas) → SIM
   *   5. Paredes → NÃO
   *   6. Itens altos não-walkable → NÃO
   * @param {number|string} tileId
   * @returns {string} 'yes' | 'no'
   */
  canReceiveItems(tileId) {
    const id = Number(tileId);

    // 1. Verifica classificação específica por ID
    const byId = canReceiveItemsById(id);
    if (byId !== null) {
      return byId ? ALLOW_PICKUPABLE.YES : ALLOW_PICKUPABLE.NO;
    }

    // 2. Verifica metadata do item
    const entry = this._get(tileId);
    if (!entry) return ALLOW_PICKUPABLE.NO;

    const game = entry.game || {};
    const flags = entry.flags_raw || {};

    // Chão walkable sempre pode receber itens
    if (game.is_walkable === true && game.render_layer === 0) {
      return ALLOW_PICKUPABLE.YES;
    }

    // Containers (baús, barris, armários) podem receber itens
    if (game.category_type === "container" || game.is_container) {
      return ALLOW_PICKUPABLE.YES;
    }

    // Mobília/superfícies (mesas, bancadas, prateleiras)
    if (
      ["furniture", "surface", "table", "counter"].includes(game.category_type)
    ) {
      return ALLOW_PICKUPABLE.YES;
    }

    // Paredes NÃO podem receber itens
    if (game.category_type === "wall" || flags.bottom) {
      return ALLOW_PICKUPABLE.NO;
    }

    // Itens altos (render_layer >= 2) que não são walkable → NÃO
    if (game.render_layer >= 2 && game.is_walkable !== true) {
      return ALLOW_PICKUPABLE.NO;
    }

    // Default: NÃO (seguro)
    return ALLOW_PICKUPABLE.NO;
  }

  /**
   * Verifica se um tile é uma superfície para itens (mesa, bancada, chão).
   * Similar a canReceiveItems, mas mais restritivo.
   * @param {number|string} tileId
   * @returns {boolean}
   */
  isSurface(tileId) {
    const entry = this._get(tileId);
    if (!entry) return false;

    const game = entry.game || {};

    // Chão é superfície
    if (game.is_walkable === true && game.render_layer === 0) {
      return true;
    }

    // Mobília específica
    const surfaceTypes = [
      "furniture",
      "surface",
      "table",
      "counter",
      "desk",
      "shelf",
    ];
    if (surfaceTypes.includes(game.category_type)) {
      return true;
    }

    return false;
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
    return entry?.variants?.[variantIdx] ?? entry?.variants?.["0"] ?? null;
  }

  /**
   * Retorna a chave de variante OTClient para uma quantidade de item stackable.
   * Mapeamento idêntico ao do mapRenderer (spec OTClient):
   *   0-1 → "0", 2 → "1", 3 → "2", 4-9 → "3",
   *   10-24 → "4", 25-49 → "5", 50-99 → "6", 100+ → "7"
   *
   * @param {number} qty
   * @returns {string} chave de variante ("0"–"7")
   */
  static getStackableVariantKey(qty) {
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    if (q <= 1) return "0";
    if (q === 2) return "1";
    if (q === 3) return "2";
    if (q <= 9) return "3";
    if (q <= 24) return "4";
    if (q <= 49) return "5";
    if (q <= 99) return "6";
    return "7";
  }

  /**
   * Retorna a chave de variante de sprite adequada para a quantidade informada.
   * Usa mapeamento OTClient (idêntico ao mapRenderer) para garantir que o sprite
   * no inventário seja o mesmo exibido no mapa.
   *
   * Retorna "0" se o item não for stackable ou tiver apenas uma variante.
   *
   * @param {number|string} tileId
   * @param {number} qty
   * @returns {string} chave de variante ("0"–"7")
   */
  getVariantForQuantity(tileId, qty) {
    const entry = this._get(tileId);
    if (!entry?.variants) return "0";
    const count = Object.keys(entry.variants).length;
    if (count <= 1) return "0";
    return ItemDataService.getStackableVariantKey(qty);
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
