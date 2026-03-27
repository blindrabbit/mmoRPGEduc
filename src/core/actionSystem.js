// ═══════════════════════════════════════════════════════════════
// actionSystem.js — Sistema de ações de itens e tiles
// Inspirado no sistema Actions do Tibia Canary
// ═══════════════════════════════════════════════════════════════

import { PlayerAction } from "../core/playerAction.js";

/**
 * @typedef {Object} ActionContext
 * @property {Object} player - Jogador que executou a ação
 * @property {number} player.x - Posição X do player
 * @property {number} player.y - Posição Y do player
 * @property {number} player.z - Posição Z (floor) do player
 * @property {Object} target - Alvo da ação (item, tile, creature)
 * @property {number} target.id - Sprite ID do alvo
 * @property {number} target.x - Posição X do alvo
 * @property {number} target.y - Posição Y do alvo
 * @property {number} target.z - Posição Z do alvo
 * @property {Object} [item] - Item sendo usado (se aplicável)
 * @property {number} item.id - Sprite ID do item
 * @property {number} [item.count] - Quantidade do item
 * @property {Object} [metadata] - Metadata do sprite (appearances_map.json)
 */

/**
 * @typedef {Object} ActionHandler
 * @property {string} name - Nome da ação
 * @property {Function} execute - Função que executa a ação
 * @property {string} [cursor] - Cursor/ícone para feedback visual
 */

/**
 * Sistema de registro e execução de ações
 */
export class ActionSystem {
  constructor() {
    /** @type {Map<string, ActionHandler>} */
    this.handlers = new Map();

    /** @type {Map<string, Function>} */
    this.positionActions = new Map(); // "x,y,z" -> handler

    /** @type {Map<number, Function>} */
    this.itemActions = new Map(); // spriteId -> handler

    this.registerDefaultHandlers();
  }

  /**
   * Registra handlers padrão para cada PlayerAction
   */
  registerDefaultHandlers() {
    // AUTOWALK_HIGHLIGHT - executado no inputHandler
    this.register(PlayerAction.AUTOWALK_HIGHLIGHT, {
      name: "Autowalk Highlight",
      execute: (ctx) => this.handleAutowalkHighlight(ctx),
      cursor: "walk",
    });

    // LOOK
    this.register(PlayerAction.LOOK, {
      name: "Look",
      execute: (ctx) => this.handleLook(ctx),
      cursor: "inspect",
    });

    // USE
    this.register(PlayerAction.USE, {
      name: "Use",
      execute: (ctx) => this.handleUse(ctx),
      cursor: "use",
    });

    // OPEN_CONTAINER
    this.register(PlayerAction.OPEN_CONTAINER, {
      name: "Open Container",
      execute: (ctx) => this.handleOpenContainer(ctx),
      cursor: "open",
    });

    // TELEPORT
    this.register(PlayerAction.TELEPORT, {
      name: "Teleport",
      execute: (ctx) => this.handleTeleport(ctx),
      cursor: "teleport",
    });

    // CHANGE_FLOOR
    this.register(PlayerAction.CHANGE_FLOOR, {
      name: "Change Floor",
      execute: (ctx) => this.handleChangeFloor(ctx),
      cursor: "floor",
    });

    // TALK
    this.register(PlayerAction.TALK, {
      name: "Talk",
      execute: (ctx) => this.handleTalk(ctx),
      cursor: "talk",
    });

    // ATTACK
    this.register(PlayerAction.ATTACK, {
      name: "Attack",
      execute: (ctx) => this.handleAttack(ctx),
      cursor: "attack",
    });

    // PICKUP
    this.register(PlayerAction.PICKUP, {
      name: "Pickup",
      execute: (ctx) => this.handlePickup(ctx),
      cursor: "pickup",
    });

    // IMBUE
    this.register(PlayerAction.IMBUE, {
      name: "Imbue",
      execute: (ctx) => this.handleImbue(ctx),
      cursor: "imbue",
    });
  }

  /**
   * Registra um handler para uma ação
   * @param {string} action - PlayerAction
   * @param {ActionHandler} handler
   */
  register(action, handler) {
    if (!action || !handler?.execute) {
      console.error("[ActionSystem] register: action ou handler inválido");
      return false;
    }
    this.handlers.set(action, handler);
    return true;
  }

  /**
   * Registra uma ação específica para uma posição
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {Function} handler - (ctx) => boolean
   */
  registerPositionAction(x, y, z, handler) {
    const key = `${x},${y},${z}`;
    this.positionActions.set(key, handler);
  }

  /**
   * Registra uma ação específica para um tipo de item
   * @param {number} spriteId - ID do sprite
   * @param {Function} handler - (ctx) => boolean
   */
  registerItemAction(spriteId, handler) {
    this.itemActions.set(spriteId, handler);
  }

  /**
   * Remove ação de uma posição
   */
  unregisterPositionAction(x, y, z) {
    const key = `${x},${y},${z}`;
    return this.positionActions.delete(key);
  }

  /**
   * Remove ação de um item
   */
  unregisterItemAction(spriteId) {
    return this.itemActions.delete(spriteId);
  }

  /**
   * Executa uma ação genérica
   * @param {string} action - PlayerAction
   * @param {ActionContext} ctx
   * @returns {boolean} true se executou com sucesso
   */
  execute(action, ctx) {
    const handler = this.handlers.get(action);
    if (!handler) {
      console.warn(`[ActionSystem] Ação não registrada: ${action}`);
      return false;
    }

    try {
      return handler.execute(ctx) !== false;
    } catch (error) {
      console.error(`[ActionSystem] Erro ao executar ${action}:`, error);
      return false;
    }
  }

  /**
   * Tenta executar ação baseada no tile/item clicado
   * Prioridade: positionAction > itemAction > defaultAction do metadata
   * @param {Object} context
   * @returns {boolean}
   */
  executeFromTile(context) {
    const { player, target } = context;

    console.log(
      `[ActionSystem.executeFromTile] target.id=${target?.id} target=(${target?.x},${target?.y},${target?.z})`,
    );
    console.log(
      `[ActionSystem.executeFromTile] itemActions size=${this.itemActions.size} handlers:`,
      Array.from(this.itemActions.keys()),
    );

    // 1. Verifica ação específica da posição
    const posKey = `${target.x},${target.y},${target.z}`;
    const posHandler = this.positionActions.get(posKey);
    if (posHandler) {
      console.log(
        `[ActionSystem.executeFromTile] positionAction encontrada em ${posKey}`,
      );
      try {
        return posHandler(context) !== false;
      } catch (error) {
        console.error(
          "[ActionSystem] Erro ao executar ação da posição:",
          error,
        );
      }
    }

    // 2. Verifica ação específica do item
    const itemHandler = this.itemActions.get(target.id);
    if (itemHandler) {
      console.log(
        `[ActionSystem.executeFromTile] itemAction encontrada para id=${target.id}`,
      );
      try {
        return itemHandler(context) !== false;
      } catch (error) {
        console.error("[ActionSystem] Erro ao executar ação do item:", error);
      }
    } else {
      console.log(
        `[ActionSystem.executeFromTile] itemAction NÃO encontrada para id=${target.id}`,
      );
    }

    // 3. Usa defaultAction do metadata
    const metadata = context.metadata;
    const defaultAction =
      metadata?.game?.default_action || metadata?.flags_raw?.defaultAction;
    if (defaultAction) {
      console.log(
        `[ActionSystem.executeFromTile] defaultAction=${defaultAction}`,
      );
      return this.execute(defaultAction, context);
    }

    // 4. Fallback: ação USE padrão
    console.log(`[ActionSystem.executeFromTile] Fallback: USE padrao`);
    return this.execute(PlayerAction.USE, context);
  }

  // ═══════════════════════════════════════════════════════════
  // HANDLERS PADRÃO
  // ═══════════════════════════════════════════════════════════

  /**
   * PLAYER_ACTION_AUTOWALK_HIGHLIGHT
   * Move o player até o tile adjacente e executa a ação
   */
  handleAutowalkHighlight(ctx) {
    const { player, target, onStep } = ctx;

    if (!player || !target) return false;

    // Calcula direção necessária
    const dx = target.x - player.x;
    const dy = target.y - player.y;

    // Se já está adjacente, executa ação diretamente
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0)) {
      if (onStep) onStep();
      return true;
    }

    // TODO: Implementar pathfinding até tile adjacente
    // Por enquanto, move apenas 1 tile na direção
    const newX = player.x + Math.sign(dx);
    const newY = player.y + Math.sign(dy);

    // Valida movimento (será implementado no pathfinding)
    if (onStep) {
      onStep({ x: newX, y: newY, z: player.z });
    }

    return true;
  }

  /**
   * PLAYER_ACTION_LOOK
   * Exibe descrição do item/creature
   */
  handleLook(ctx) {
    const { target, metadata, showLookMessage } = ctx;

    if (!target) return false;

    const name = metadata?.name || metadata?.game?.name || "Unknown";
    const description =
      metadata?.description || metadata?.game?.description || "";

    const message = description ? `${name}: ${description}` : name;

    if (showLookMessage) {
      showLookMessage(message);
    } else {
      console.log(`[Look] ${message}`);
    }

    return true;
  }

  /**
   * PLAYER_ACTION_USE
   * Usa o item (ação genérica)
   */
  handleUse(ctx) {
    const { target, metadata, onUse } = ctx;

    if (!target) return false;

    // Callback personalizado se fornecido
    if (onUse) {
      return onUse(ctx) !== false;
    }

    // Comportamento padrão: apenas log
    const name = metadata?.name || `Item ${target.id}`;
    console.log(`[Use] ${name} em (${target.x}, ${target.y}, ${target.z})`);

    return true;
  }

  /**
   * PLAYER_ACTION_OPEN_CONTAINER
   * Abre container
   */
  handleOpenContainer(ctx) {
    const { target, openContainerUI } = ctx;

    if (!target) return false;

    if (openContainerUI) {
      openContainerUI(target.id, target.x, target.y, target.z);
      return true;
    }

    console.log(
      `[OpenContainer] ${target.id} em (${target.x}, ${target.y}, ${target.z})`,
    );
    return true;
  }

  /**
   * PLAYER_ACTION_TELEPORT
   * Teleporta para outra posição
   */
  handleTeleport(ctx) {
    const { target, teleportTo, player } = ctx;

    if (!target || !teleportTo) return false;

    const dest =
      typeof teleportTo === "function" ? teleportTo(ctx) : teleportTo;

    if (dest && dest.x != null && dest.y != null && dest.z != null) {
      player.x = dest.x;
      player.y = dest.y;
      player.z = dest.z;
      console.log(`[Teleport] ${player.x}, ${player.y}, ${player.z}`);
      return true;
    }

    return false;
  }

  /**
   * PLAYER_ACTION_CHANGE_FLOOR
   * Move para outro floor
   */
  handleChangeFloor(ctx) {
    const { target, metadata, player, onChangeFloor } = ctx;

    if (!target || !player) return false;

    // Determina direção baseada no tipo de escada/rampa
    const floorChange = metadata?.game?.floor_change || 0;
    const newZ = player.z + floorChange;

    if (onChangeFloor) {
      return onChangeFloor({ ...ctx, newZ }) !== false;
    }

    // Padrão: escada para cima (z diminui) ou para baixo (z aumenta)
    player.z = newZ;
    console.log(`[ChangeFloor] ${player.x}, ${player.y}, ${player.z}`);
    return true;
  }

  /**
   * PLAYER_ACTION_TALK
   * Inicia conversa com NPC
   */
  handleTalk(ctx) {
    const { target, openChatUI, metadata } = ctx;

    if (!target) return false;

    const npcName = metadata?.name || "NPC";

    if (openChatUI) {
      openChatUI(target.id, npcName);
      return true;
    }

    console.log(`[Talk] Falando com ${npcName} em (${target.x}, ${target.y})`);
    return true;
  }

  /**
   * PLAYER_ACTION_ATTACK
   * Ataca target
   */
  handleAttack(ctx) {
    const { target, player, onAttack } = ctx;

    if (!target || !player) return false;

    if (onAttack) {
      return onAttack(ctx) !== false;
    }

    console.log(`[Attack] Atacando target em (${target.x}, ${target.y})`);
    return true;
  }

  /**
   * PLAYER_ACTION_PICKUP
   * Pega item do chão
   */
  handlePickup(ctx) {
    const { target, player, onPickup } = ctx;

    if (!target || !player) return false;

    if (onPickup) {
      return onPickup(ctx) !== false;
    }

    console.log(
      `[Pickup] Pegando item ${target.id} em (${target.x}, ${target.y})`,
    );
    return true;
  }

  /**
   * PLAYER_ACTION_IMBUE
   * Abre janela de imbue
   */
  handleImbue(ctx) {
    const { target, openImbueUI } = ctx;

    if (!target) return false;

    if (openImbueUI) {
      openImbueUI(target.x, target.y, target.z);
      return true;
    }

    console.log(`[Imbue] Abrindo imbue window em (${target.x}, ${target.y})`);
    return true;
  }
}

// Singleton
let _actionSystem = null;

/**
 * Obtém ou cria instância singleton do ActionSystem
 * @returns {ActionSystem}
 */
export function getActionSystem() {
  if (!_actionSystem) {
    _actionSystem = new ActionSystem();
  }
  return _actionSystem;
}

/**
 * Reset (útil para testes/hot-reload)
 */
export function resetActionSystem() {
  _actionSystem = null;
}
