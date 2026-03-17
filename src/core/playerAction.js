// ═══════════════════════════════════════════════════════════════
// playerAction.js — Enum e utilitários para ações do jogador
// Baseado no sistema PlayerAction do Tibia Canary
// ═══════════════════════════════════════════════════════════════

/**
 * Enum com todas as ações possíveis que um item pode triggerar
 * Baseado no enum PLAYER_ACTION do OTClient (src/client/const.h)
 *
 * Valores numéricos oficiais:
 *   0 = NONE
 *   1 = LOOK
 *   2 = USE
 *   3 = OPEN
 *   4 = AUTOWALK_HIGHLIGHT
 *
 * @enum {number|string}
 */
export const PlayerAction = {
  /** Nenhuma ação padrão */
  NONE: 0,

  /**
   * PLAYER_ACTION_LOOK (1)
   * Exibe descrição/inspeção do item
   * Usado em: itens examináveis, NPCs, creatures
   */
  LOOK: 1,

  /**
   * PLAYER_ACTION_USE (2)
   * Usa o item (ação padrão)
   * Usado em: baús, portas, máquinas, alavancas
   */
  USE: 2,

  /**
   * PLAYER_ACTION_OPEN (3)
   * Abre container/inventário
   * Usado em: baús, mochilas, caixas, portas
   */
  OPEN: 3,

  /**
   * PLAYER_ACTION_AUTOWALK_HIGHLIGHT (4)
   * Ao clicar, o player executa autowalk até o tile adjacente
   * Usado em: grama, chão, tiles walkáveis
   */
  AUTOWALK_HIGHLIGHT: 4,

  // ═══════════════════════════════════════════════════════════
  // AÇÕES ESTENDIDAS (não oficiais, uso interno do jogo)
  // ═══════════════════════════════════════════════════════════

  /**
   * Usa o item com hotkey (ex: rune no target)
   * Usado em: runes, poções, ferramentas
   */
  USE_WITH_HOTKEY: "USE_WITH_HOTKEY",

  /**
   * Usa o item em outro target (ex: chave em porta)
   * Usado em: chaves, ferramentas, itens combináveis
   */
  USE_ON_TARGET: "USE_ON_TARGET",

  /**
   * Abre container específico (variação de OPEN)
   */
  OPEN_CONTAINER: "OPEN_CONTAINER",

  /**
   * PLAYER_ACTION_TRADE
   * Inicia trade com NPC ou player
   * Usado em: NPCs comerciantes, players
   */
  TRADE: "PLAYER_ACTION_TRADE",

  /**
   * PLAYER_ACTION_BUY
   * Compra item de NPC
   * Usado em: shops de NPCs
   */
  BUY: "PLAYER_ACTION_BUY",

  /**
   * PLAYER_ACTION_SELL
   * Vende item para NPC
   * Usado em: shops de NPCs
   */
  SELL: "PLAYER_ACTION_SELL",

  /**
   * PLAYER_ACTION_TELEPORT
   * Teleporta o player para outra posição
   * Usado em: teleporters, magic forcefields
   */
  TELEPORT: "PLAYER_ACTION_TELEPORT",

  /**
   * PLAYER_ACTION_CHANGE_FLOOR
   * Move o player para outro floor (Z diferente)
   * Usado em: escadas, elevadores, buracos
   */
  CHANGE_FLOOR: "PLAYER_ACTION_CHANGE_FLOOR",

  /**
   * PLAYER_ACTION_ATTACK
   * Ataca target (creature/player)
   * Usado em: creatures hostis, PvP
   */
  ATTACK: "PLAYER_ACTION_ATTACK",

  /**
   * PLAYER_ACTION_FOLLOW
   * Segue target
   * Usado em: creatures, players
   */
  FOLLOW: "PLAYER_ACTION_FOLLOW",

  /**
   * PLAYER_ACTION_TALK
   * Inicia conversa com NPC
   * Usado em: NPCs
   */
  TALK: "PLAYER_ACTION_TALK",

  /**
   * PLAYER_ACTION_MESSAGE
   * Envia mensagem privada
   * Usado em: players
   */
  MESSAGE: "PLAYER_ACTION_MESSAGE",

  /**
   * PLAYER_ACTION_ADD_TO_VIP
   * Adiciona player à lista VIP
   */
  ADD_TO_VIP: "PLAYER_ACTION_ADD_TO_VIP",

  /**
   * PLAYER_ACTION_REMOVE_FROM_VIP
   * Remove player da lista VIP
   */
  REMOVE_FROM_VIP: "PLAYER_ACTION_REMOVE_FROM_VIP",

  /**
   * PLAYER_ACTION_PICKUP
   * Pega item do chão
   */
  PICKUP: "PLAYER_ACTION_PICKUP",

  /**
   * PLAYER_ACTION_MOVE
   * Move item (drag & drop)
   */
  MOVE: "PLAYER_ACTION_MOVE",

  /**
   * PLAYER_ACTION_ROTATE
   * Rotaciona item
   * Usado em: móveis, itens rotacionáveis
   */
  ROTATE: "PLAYER_ACTION_ROTATE",

  /**
   * PLAYER_ACTION_WRITE
   * Abre janela de escrita
   * Usado em: livros, pergaminhos, placas
   */
  WRITE: "PLAYER_ACTION_WRITE",

  /**
   * PLAYER_ACTION_BROWSE_FIELD
   * Abre browse field (vê itens no tile)
   */
  BROWSE_FIELD: "PLAYER_ACTION_BROWSE_FIELD",

  /**
   * PLAYER_ACTION_CONTEXT_MENU
   * Abre menu de contexto
   */
  CONTEXT_MENU: "PLAYER_ACTION_CONTEXT_MENU",

  /**
   * PLAYER_ACTION_CAST_SPELL
   * Conjura spell
   * Usado em: spells com target
   */
  CAST_SPELL: "PLAYER_ACTION_CAST_SPELL",

  /**
   * PLAYER_ACTION_IMBUE
   * Abre janela de imbue
   * Usado em: imbuing shrines
   */
  IMBUE: "PLAYER_ACTION_IMBUE",

  /**
   * PLAYER_ACTION_QUEST_LOG
   * Abre quest log
   */
  QUEST_LOG: "PLAYER_ACTION_QUEST_LOG",

  /**
   * PLAYER_ACTION_PARTY_INVITE
   * Convida para party
   */
  PARTY_INVITE: "PLAYER_ACTION_PARTY_INVITE",

  /**
   * PLAYER_ACTION_PARTY_JOIN
   * Aceita convite de party
   */
  PARTY_JOIN: "PLAYER_ACTION_PARTY_JOIN",

  /**
   * PLAYER_ACTION_PARTY_LEAVE
   * Sai da party
   */
  PARTY_LEAVE: "PLAYER_ACTION_PARTY_LEAVE",

  /**
   * PLAYER_ACTION_GUILD_INVITE
   * Convida para guild
   */
  GUILD_INVITE: "PLAYER_ACTION_GUILD_INVITE",

  /**
   * PLAYER_ACTION_GUILD_JOIN
   * Aceita convite de guild
   */
  GUILD_JOIN: "PLAYER_ACTION_GUILD_JOIN",

  /**
   * PLAYER_ACTION_GUILD_LEAVE
   * Sai da guild
   */
  GUILD_LEAVE: "PLAYER_ACTION_GUILD_LEAVE",
};

/**
 * Mapeia ação para ícone/feedback visual no cursor
 * @param {number|string} action - PlayerAction (valor numérico ou string)
 * @returns {string} Nome do cursor/ícone
 */
export function getActionCursor(action) {
  const cursorMap = {
    // Valores oficiais OTClient
    [0]: "default", // NONE
    [1]: "inspect", // LOOK
    [2]: "use", // USE
    [3]: "open", // OPEN
    [4]: "walk", // AUTOWALK_HIGHLIGHT

    // Ações estendidas (strings)
    USE_WITH_HOTKEY: "hotkey",
    USE_ON_TARGET: "target",
    OPEN_CONTAINER: "open",
    TRADE: "trade",
    BUY: "buy",
    SELL: "sell",
    TELEPORT: "teleport",
    CHANGE_FLOOR: "floor",
    ATTACK: "attack",
    FOLLOW: "follow",
    TALK: "talk",
    MESSAGE: "message",
    PICKUP: "pickup",
    MOVE: "move",
    ROTATE: "rotate",
    WRITE: "write",
    IMBUE: "imbue",
    CAST_SPELL: "spell",
  };
  return cursorMap[action] || "default";
}

/**
 * Verifica se a ação requer target adicional
 * @param {number|string} action - PlayerAction
 * @returns {boolean}
 */
export function actionRequiresTarget(action) {
  const targetActions = new Set([
    "USE_ON_TARGET",
    "ATTACK",
    "FOLLOW",
    "TRADE",
    "MESSAGE",
    "CAST_SPELL",
  ]);
  return targetActions.has(action);
}

/**
 * Verifica se a ação é de movimento
 * @param {number|string} action - PlayerAction
 * @returns {boolean}
 */
export function actionIsMovement(action) {
  const movementActions = new Set([
    4, // AUTOWALK_HIGHLIGHT
    "TELEPORT",
    "CHANGE_FLOOR",
  ]);
  return movementActions.has(action);
}
