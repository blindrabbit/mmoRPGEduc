// ═══════════════════════════════════════════════════════════════
// itemConstants.js — Constantes de itens
// Baseado nas regras do OpenTibia Canary
// ═══════════════════════════════════════════════════════════════
import { EQUIPMENT_DATA } from "../equipmentData.js";

/**
 * Slots do inventário (IDs numéricos conforme Tibia/OT)
 * @readonly
 * @enum {number}
 */
export const INVENTORY_SLOTS = {
  HEAD: 1,
  NECK: 2,
  BACK: 3,
  BODY: 4,
  RIGHT: 5,
  LEFT: 6,
  LEGS: 7,
  FEET: 8,
  FINGER: 9,
  AMMO: 10,
};

/**
 * Nome canônico de cada slot (lowercase, alinhado com INVENTORY_SLOTS e EQUIPMENT_DATA)
 * @type {Object<number, string>}
 */
export const SLOT_NAMES = {
  1: "head",
  2: "neck",
  3: "back",
  4: "body",
  5: "right",
  6: "left",
  7: "legs",
  8: "feet",
  9: "finger",
  10: "ammo",
};

/**
 * Mapeamento: weaponType/primarytype → slots compatíveis (IDs numéricos)
 * Baseado em game/creature.cpp do Canary (slots1/slots2)
 * @type {Object<string, number[]>}
 */
export const ITEM_TYPE_TO_SLOTS = {
  helmet: [INVENTORY_SLOTS.HEAD],
  hat: [INVENTORY_SLOTS.HEAD],
  amulet: [INVENTORY_SLOTS.NECK],
  necklace: [INVENTORY_SLOTS.NECK],
  backpack: [INVENTORY_SLOTS.BACK],
  container: [INVENTORY_SLOTS.BACK],
  armor: [INVENTORY_SLOTS.BODY],
  sword: [INVENTORY_SLOTS.RIGHT, INVENTORY_SLOTS.LEFT],
  axe: [INVENTORY_SLOTS.RIGHT, INVENTORY_SLOTS.LEFT],
  club: [INVENTORY_SLOTS.RIGHT, INVENTORY_SLOTS.LEFT],
  distance: [INVENTORY_SLOTS.RIGHT, INVENTORY_SLOTS.LEFT],
  wand: [INVENTORY_SLOTS.RIGHT],
  rod: [INVENTORY_SLOTS.RIGHT],
  spellbook: [INVENTORY_SLOTS.LEFT],
  shield: [INVENTORY_SLOTS.LEFT],
  legs: [INVENTORY_SLOTS.LEGS],
  boots: [INVENTORY_SLOTS.FEET],
  ring: [INVENTORY_SLOTS.FINGER],
  ammunition: [INVENTORY_SLOTS.AMMO],
  quiver: [INVENTORY_SLOTS.AMMO],
};

/**
 * Limites de stack/itens baseados no Canary
 */
export const STACK_LIMITS = {
  /** Máximo de itens por stack (coin, arrow, etc.) */
  MAX_STACK: 100,
  /** Máximo de itens no chão por tile */
  MAX_ITEMS_PER_TILE: 10,
  /** Slots de um container padrão */
  CONTAINER_SLOTS: 20,
};

/**
 * Cooldown mínimo entre ações de item (ms)
 */
export const ACTION_COOLDOWN_MS = 100;

/**
 * Distância máxima para PEGAR item do chão → inventário (Chebyshev).
 * 1 = apenas os 8 SQMs adjacentes + SQM do próprio player (regra OT original).
 */
export const MAX_PICKUP_DISTANCE = 1;

/**
 * Distância máxima para DROPAR/JOGAR item no chão (Chebyshev).
 * 15 = padrão do jogo (definido pelo design do projeto, não pelo OT original).
 * Permite ao jogador largar itens em tiles mais distantes.
 */
export const MAX_DROP_DISTANCE = 15;

/**
 * Mapa de normalização de nomes de slot.
 * Aceita nomes vindos do items.xml (Canary), da UI legada e da UI nova,
 * todos resolvendo para o nome canônico usado em EQUIPMENT_DATA.
 *
 * Fontes:
 *   items.xml: "hand", "shield", "head", "armor", "legs", "feet"
 *   UI legada: "weapon", "helmet", "chest", "ring", "amulet", "boots", "backpack"
 *   Canônico:  "right", "left", "head", "body", "legs", "feet", "finger", "neck", "back", "ammo"
 * @type {Object<string, string>}
 */
export const SLOT_ALIASES = Object.freeze({
  // IDs numéricos dos slots (persistência legada)
  1: "head",
  2: "neck",
  3: "back",
  4: "body",
  5: "right",
  6: "left",
  7: "legs",
  8: "feet",
  9: "finger",
  10: "ammo",

  // Mão direita / arma
  hand: "right",
  weapon: "right",
  right: "right",

  // Mão esquerda / escudo
  shield: "left",
  left: "left",
  offhand: "left",

  // Cabeça
  head: "head",
  helmet: "head",

  // Corpo
  body: "body",
  armor: "body",
  chest: "body",

  // Pernas
  legs: "legs",

  // Pés
  feet: "feet",
  boots: "feet",

  // Colar
  neck: "neck",
  amulet: "neck",
  necklace: "neck",

  // Costas
  back: "back",
  backpack: "back",

  // Dedo
  finger: "finger",
  ring: "finger",

  // Munição
  ammo: "ammo",
  ammunition: "ammo",
});

/**
 * Normaliza qualquer variação de nome de slot para o nome canônico.
 * Ex: "weapon" → "right", "hand" → "right", "armor" → "body"
 * @param {string} slotName
 * @returns {string} nome canônico, ou o próprio valor se não mapeado
 */
export function normalizeSlotName(slotName) {
  return (
    SLOT_ALIASES[String(slotName).toLowerCase()] ??
    String(slotName).toLowerCase()
  );
}

/**
 * Retorna os slots compatíveis para um tipo de item
 * @param {string} itemType - category_type ou item_type do metadata
 * @returns {number[]}
 */
export function getCompatibleSlots(itemType) {
  return ITEM_TYPE_TO_SLOTS[itemType] ?? [];
}

/**
 * Verifica se um slot é compatível com um tipo de item
 * @param {string} itemType
 * @param {number} slotId
 * @returns {boolean}
 */
export function isSlotCompatible(itemType, slotId) {
  return getCompatibleSlots(itemType).includes(slotId);
}

/**
 * Retorna o nome canônico do slot (ex: "right", "left", "body") para um itemId,
 * consultando EQUIPMENT_DATA como fonte primária.
 * Retorna null se o item não for um equipamento.
 * @param {number|string} itemId
 * @returns {string|null}
 */
export function getSlotForEquipmentId(itemId) {
  return EQUIPMENT_DATA[Number(itemId)]?.slot ?? null;
}

/**
 * Verifica se um itemId pode ser equipado no slot informado (nome canônico).
 * @param {number|string} itemId
 * @param {string} slotName - nome canônico, ex: "right", "left", "head"
 * @returns {boolean}
 */
export function canEquipInSlot(itemId, slotName) {
  const equipSlot = getSlotForEquipmentId(itemId);
  return equipSlot === slotName;
}
