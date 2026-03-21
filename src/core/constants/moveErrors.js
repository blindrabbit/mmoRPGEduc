// ═══════════════════════════════════════════════════════════════
// moveErrors.js — Códigos de retorno para movimentação de itens
// Baseado em src/game/game.h do OpenTibia Canary (RETURNVALUE_*)
// ═══════════════════════════════════════════════════════════════

/**
 * @readonly
 * @enum {string}
 */
export const MOVE_ERRORS = {
  SUCCESS: "SUCCESS",

  // Movimento/posição
  NOTPOSSIBLE: "NOTPOSSIBLE",                   // Parâmetros inválidos / estado inválido
  THEREISNOWAY: "THEREISNOWAY",                 // Pathfinding falhou / player muito longe
  CANNOTTHROWITEMTHERE: "CANNOTTHROWITEMTHERE", // Tile proibido (flag, PZ, casa, etc.)

  // Espaço
  NOTENOUGHROOM: "NOTENOUGHROOM",               // Container/tile/slot cheio
  CONTAINERNOTENOUGHROOM: "CONTAINERNOTENOUGHROOM",

  // Equipamento
  CANNOTBEDRESSED: "CANNOTBEDRESSED",           // Slot incompatível com item
  LEVELTOLOW: "LEVELTOLOW",                     // Level insuficiente
  VOCATIONMISMATCH: "VOCATIONMISMATCH",         // Vocação não pode usar
  PREMIUMREQUIRED: "PREMIUMREQUIRED",           // Requer conta Premium

  // Propriedade
  ITEMISNOTYOURS: "ITEMISNOTYOURS",             // Item pertence a outro player

  // Stackables
  STACK_LIMIT_EXCEEDED: "STACK_LIMIT_EXCEEDED", // count > 100

  // Sistema
  COOLDOWN_ACTIVE: "COOLDOWN_ACTIVE",           // Aguardar cooldown (100ms mínimo)
  NETWORK_ERROR: "NETWORK_ERROR",               // Falha de comunicação
  UNKNOWN_ACTION: "UNKNOWN_ACTION",             // Tipo de ação não registrado
  INTERNAL_ERROR: "INTERNAL_ERROR",             // Erro inesperado no worldEngine
};

/**
 * Mensagens amigáveis para exibição ao jogador
 * @type {Object<string, string>}
 */
const USER_MESSAGES = {
  [MOVE_ERRORS.ITEMISNOTYOURS]: "Este item não pertence a você.",
  [MOVE_ERRORS.CANNOTBEDRESSED]: "Este item não pode ser equipado aqui.",
  [MOVE_ERRORS.LEVELTOLOW]: "Seu nível é muito baixo para este item.",
  [MOVE_ERRORS.VOCATIONMISMATCH]: "Sua vocação não pode usar este item.",
  [MOVE_ERRORS.PREMIUMREQUIRED]: "Este item requer conta Premium.",
  [MOVE_ERRORS.CONTAINERNOTENOUGHROOM]: "Este container está cheio.",
  [MOVE_ERRORS.NOTENOUGHROOM]: "Não há espaço suficiente.",
  [MOVE_ERRORS.CANNOTTHROWITEMTHERE]: "Não é possível mover o item para lá.",
  [MOVE_ERRORS.THEREISNOWAY]: "Você está muito longe para esta ação.",
  [MOVE_ERRORS.STACK_LIMIT_EXCEEDED]: "Limite de stack excedido (máx: 100).",
  [MOVE_ERRORS.COOLDOWN_ACTIVE]: "Aguarde um momento e tente novamente.",
  [MOVE_ERRORS.NETWORK_ERROR]: "Erro de conexão. Tente novamente.",
};

/**
 * Retorna mensagem amigável para exibição ao jogador
 * @param {string} errorCode - MOVE_ERRORS.*
 * @returns {string}
 */
export function getUserMessage(errorCode) {
  return USER_MESSAGES[errorCode] ?? "Ação não pôde ser completada.";
}
