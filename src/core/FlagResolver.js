// ═══════════════════════════════════════════════════════════════
// FlagResolver.js — Resolve IDs de flags de tile para propriedades
//
// O map_compacto.json armazena um ID numérico em tile.flags.
// O map_flag_definitions.json mapeia cada ID para um objeto de flags.
//
// Uso:
//   FlagResolver.init(definitions)  — carrega o map_flag_definitions.json
//   FlagResolver.resolve(flagId)    — retorna objeto de flags completo
//   FlagResolver.isProtectionZone(flagId)
//   FlagResolver.canDropItem(flagId)
//   FlagResolver.isHouse(flagId)
// ═══════════════════════════════════════════════════════════════

/**
 * Valores padrão quando o ID de flag não está definido no arquivo.
 * Todos os campos permissivos para não bloquear comportamento atual.
 */
const DEFAULT_FLAGS = Object.freeze({
  isProtectionZone: false,
  isHouse: false,
  isNoPvP: false,
  isNoLogout: false,
  isPvPZone: false,
  isFloorChange: false,
  isDepot: false,
  isMailbox: false,
  isTrashHolder: false,
  isBed: false,
  isBlocked: false,
  isBlockSolid: false,
  isBlockPath: false,
  isImmovableBlockSolid: false,
  isImmovableBlockPath: false,
  supportsHangable: false,
  isWalkable: true,
  canDropItem: true,
});

let _definitions = null;

export const FlagResolver = {
  /**
   * Inicializa o resolver com o conteúdo do map_flag_definitions.json.
   * @param {Object} definitions - { "0": {...}, "1": {...}, ... }
   */
  init(definitions) {
    _definitions = definitions && typeof definitions === "object" ? definitions : {};
  },

  /**
   * Resolve o ID de flag para um objeto de propriedades completo.
   * Campos ausentes na definição herdam os valores de DEFAULT_FLAGS.
   * @param {number|string} flagId
   * @returns {Readonly<Object>}
   */
  resolve(flagId) {
    const key = String(flagId ?? 0);
    const def = _definitions?.[key];
    if (!def) return DEFAULT_FLAGS;
    return Object.freeze({ ...DEFAULT_FLAGS, ...def });
  },

  /** @param {number|string} flagId */
  isProtectionZone(flagId) {
    return this.resolve(flagId).isProtectionZone === true;
  },

  /** @param {number|string} flagId */
  canDropItem(flagId) {
    return this.resolve(flagId).canDropItem !== false;
  },

  /** @param {number|string} flagId */
  isHouse(flagId) {
    return this.resolve(flagId).isHouse === true;
  },

  /** @param {number|string} flagId */
  isWalkable(flagId) {
    return this.resolve(flagId).isWalkable !== false;
  },
};
