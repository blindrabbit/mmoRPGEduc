// ═══════════════════════════════════════════════════════════════
// defaultActions.js — Exemplos de ações para itens comuns
// Teleport, Porta, Baú, NPC, Escada, etc.
// ═══════════════════════════════════════════════════════════════

import { PlayerAction } from "../core/playerAction.js";
import { getActionSystem } from "../core/actionSystem.js";

/**
 * Registra todas as ações padrão no ActionSystem
 * @param {Object} worldState - Estado do mundo para acesso ao mapa/player
 */
export function registerDefaultActions(worldState) {
  const actionSystem = getActionSystem();

  // ═══════════════════════════════════════════════════════════
  // ESCADAS (PLAYER_ACTION_AUTOWALK_HIGHLIGHT)
  // ═══════════════════════════════════════════════════════════

  // Escada para cima (Z diminui)
  registerStairAction(actionSystem, worldState, {
    spriteIds: [
      // Escadas de pedra
      1900, 1901, 1902, 1903,
      // Escadas de madeira
      1910, 1911, 1912, 1913,
      // Rampas
      1920, 1921, 1922, 1923,
    ],
    floorChange: -1, // Sobe um floor
    action: PlayerAction.CHANGE_FLOOR, // ou 5+ para ações estendidas
  });

  // Escada para baixo (Z aumenta)
  registerStairAction(actionSystem, worldState, {
    spriteIds: [
      // Buracos
      2000, 2001, 2002, 2003,
      // Alçapões
      2010, 2011, 2012,
    ],
    floorChange: 1, // Desce um floor
    action: PlayerAction.CHANGE_FLOOR,
  });

  // Escada/ladder usada com ONUSE (botao direito) para subir andar
  registerLadderOnUseAction(actionSystem, {
    spriteIds: [1948],
    floorChange: -1,
  });

  // ═══════════════════════════════════════════════════════════
  // TELEPORTES
  // ═══════════════════════════════════════════════════════════

  registerTeleportAction(actionSystem, worldState, {
    spriteIds: [
      // Magic forcefield (azul)
      1800, 1801, 1802, 1803,
      // Teleport de fogo
      1810, 1811,
      // Teleport de energia
      1820, 1821,
    ],
    teleportTo: { x: 100, y: 100, z: 7 }, // Destino padrão (será sobrescrito)
  });

  // ═══════════════════════════════════════════════════════════
  // PORTAS (OPEN = 3)
  // ═══════════════════════════════════════════════════════════

  registerDoorAction(actionSystem, worldState, {
    spriteIds: [
      // Porta de madeira fechada
      3000, 3001, 3002, 3003,
      // Porta de ferro fechada
      3010, 3011, 3012, 3013,
      // Porta de castelo
      3020, 3021,
    ],
    closedStates: [3000, 3001, 3002, 3003, 3010, 3011, 3012, 3013, 3020, 3021],
    openStates: [3004, 3005, 3006, 3007, 3014, 3015, 3016, 3017, 3022, 3023],
    action: PlayerAction.OPEN, // 3
  });

  // ═══════════════════════════════════════════════════════════
  // BAÚS / CONTAINERS (OPEN = 3)
  // ═══════════════════════════════════════════════════════════

  registerContainerAction(actionSystem, worldState, {
    spriteIds: [
      // Baú de madeira
      4000, 4001,
      // Baú dourado
      4010, 4011,
      // Mochila
      4020,
      // Caixa
      4030, 4031,
    ],
    containerSize: { rows: 4, cols: 6 }, // Tamanho do inventário
    action: PlayerAction.OPEN, // 3
  });

  // ═══════════════════════════════════════════════════════════
  // NPCs (TALK = ação estendida)
  // ═══════════════════════════════════════════════════════════

  registerNPCAction(actionSystem, worldState, {
    spriteIds: [
      // NPC genérico
      5000, 5001, 5002, 5003,
      // Comerciante
      5010, 5011,
      // Guarda
      5020, 5021,
      // Rei/Rainha
      5030, 5031,
    ],
    action: PlayerAction.TALK,
    dialogTree: {
      // Árvore de diálogo simples
      greet: {
        text: "Olá, viajante! Como posso ajudar?",
        responses: [
          { text: "Comprar", next: "buy" },
          { text: "Vender", next: "sell" },
          { text: "Adeus", next: "farewell" },
        ],
      },
      buy: {
        text: "O que deseja comprar?",
        responses: [
          { text: "Poção", action: "buy_item", itemId: 1001, price: 50 },
          { text: "Voltar", next: "greet" },
        ],
      },
      sell: {
        text: "O que deseja vender?",
        responses: [{ text: "Voltar", next: "greet" }],
      },
      farewell: {
        text: "Até logo, viajante!",
        end: true,
      },
    },
  });

  // ═══════════════════════════════════════════════════════════
  // IMBUING SHRINE
  // ═══════════════════════════════════════════════════════════

  registerImbuingShrineAction(actionSystem, worldState, {
    spriteIds: [25060, 25061],
    requiresStorageValue: { key: "imbuement_unlocked", value: 1 },
  });

  // ═══════════════════════════════════════════════════════════
  // ITENS DE QUEST
  // ═══════════════════════════════════════════════════════════

  registerQuestObjectAction(actionSystem, worldState, {
    spriteIds: [6000, 6001, 6002],
    questId: "example_quest",
    message: "Você encontrou um objeto importante!",
  });

  // ═══════════════════════════════════════════════════════════
  // MÁQUINAS / MECHANISMS
  // ═══════════════════════════════════════════════════════════

  registerMechanismAction(actionSystem, worldState, {
    spriteIds: [7000, 7001, 7002, 7003],
    onUse: (ctx) => {
      console.log("[Mechanism] Usado em", ctx.target);
      // TODO: Triggerar eventos (abrir portas, spawnar creatures, etc)
      return true;
    },
  });

  console.log("[DefaultActions] Ações padrão registradas.");
}

/**
 * Registra ação de escada
 */
function registerStairAction(actionSystem, worldState, config) {
  const { spriteIds, floorChange, action } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { player, onChangeFloor } = ctx;

      if (!player) return false;

      // Verifica se player está adjacente
      const dx = Math.abs(ctx.target.x - player.x);
      const dy = Math.abs(ctx.target.y - player.y);

      if (dx > 1 || dy > 1) {
        // Precisa fazer autowalk primeiro
        return false;
      }

      const newZ = player.z + floorChange;

      if (onChangeFloor) {
        return onChangeFloor({ ...ctx, newZ, floorChange });
      }

      // Move player
      player.z = newZ;
      console.log(`[Stair] Player mudou para floor ${newZ}`);
      return true;
    });
  }
}

/**
 * Registra ação de ONUSE para escadas/ladder.
 * Usado no clique direito para forcar mudanca de floor em itens utilizaveis.
 */
function registerLadderOnUseAction(actionSystem, config) {
  const { spriteIds, floorChange = -1 } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { player, target, onChangeFloor } = ctx;

      if (!player || !target) return false;

      const dx = Math.abs(target.x - player.x);
      const dy = Math.abs(target.y - player.y);
      if (dx > 1 || dy > 1) {
        return false;
      }

      const newZ = (player.z ?? 7) + floorChange;

      if (onChangeFloor) {
        return (
          onChangeFloor({
            ...ctx,
            newX: player.x,
            newY: player.y,
            newZ,
            floorChange,
          }) !== false
        );
      }

      player.z = newZ;
      console.log(`[LadderOnUse] Player mudou para floor ${newZ}`);
      return true;
    });
  }
}

/**
 * Registra ação de teleporte
 */
function registerTeleportAction(actionSystem, worldState, config) {
  const { spriteIds, teleportTo } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { player, teleportTo: customDest } = ctx;

      if (!player) return false;

      // Verifica se player está em cima do teleport
      const dx = Math.abs(ctx.target.x - player.x);
      const dy = Math.abs(ctx.target.y - player.y);

      if (dx > 0 || dy > 0) {
        console.warn("[Teleport] Player precisa estar em cima do teleport");
        return false;
      }

      const dest = customDest || teleportTo;

      if (dest && dest.x != null && dest.y != null && dest.z != null) {
        player.x = dest.x;
        player.y = dest.y;
        player.z = dest.z;
        console.log(
          `[Teleport] Player teleportado para ${player.x}, ${player.y}, ${player.z}`,
        );
        return true;
      }

      return false;
    });
  }
}

/**
 * Registra ação de porta
 */
function registerDoorAction(actionSystem, worldState, config) {
  const { spriteIds, closedStates, openStates } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { target, updateTileSprite } = ctx;

      if (!target) return false;

      const currentIndex = closedStates.indexOf(target.id);
      const isOpen = currentIndex === -1;

      if (isOpen) {
        // Fecha porta
        const closedId = openStates[openStates.indexOf(target.id)];
        if (closedId && updateTileSprite) {
          updateTileSprite(target.x, target.y, target.z, target.id, closedId);
          console.log("[Door] Porta fechada");
          return true;
        }
      } else {
        // Abre porta
        const openId = openStates[currentIndex];
        if (openId && updateTileSprite) {
          updateTileSprite(target.x, target.y, target.z, target.id, openId);
          console.log("[Door] Porta aberta");
          return true;
        }
      }

      return false;
    });
  }
}

/**
 * Registra ação de container/baú
 */
function registerContainerAction(actionSystem, worldState, config) {
  const { spriteIds, containerSize } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { target, openContainerUI } = ctx;

      if (!target) return false;

      if (openContainerUI) {
        openContainerUI({
          id: target.id,
          x: target.x,
          y: target.y,
          z: target.z,
          size: containerSize,
          items: [], // TODO: Carregar items do container
        });
        console.log(`[Container] Abrindo container ${target.id}`);
        return true;
      }

      return false;
    });
  }
}

/**
 * Registra ação de NPC
 */
function registerNPCAction(actionSystem, worldState, config) {
  const { spriteIds, dialogTree } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { target, openChatUI, showLookMessage } = ctx;

      if (!target) return false;

      // Verifica se player está adjacente
      const dx = Math.abs(ctx.player.x - target.x);
      const dy = Math.abs(ctx.player.y - target.y);

      if (dx > 1 || dy > 1) {
        console.warn("[NPC] Player precisa estar adjacente ao NPC");
        return false;
      }

      if (openChatUI) {
        openChatUI({
          npcId: target.id,
          x: target.x,
          y: target.y,
          z: target.z,
          dialogTree,
        });
        return true;
      }

      // Fallback: mostra mensagem de saudação
      if (showLookMessage && dialogTree?.greet) {
        showLookMessage(dialogTree.greet.text);
      }

      return true;
    });
  }
}

/**
 * Registra ação de Imbuing Shrine
 */
function registerImbuingShrineAction(actionSystem, worldState, config) {
  const { spriteIds, requiresStorageValue } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { player, openImbueUI, showLookMessage } = ctx;

      if (!player) return false;

      // Verifica requisito de storage
      if (requiresStorageValue) {
        const { key, value } = requiresStorageValue;
        const playerValue = player.storage?.[key] || 0;

        if (playerValue < value) {
          if (showLookMessage) {
            showLookMessage(
              "Você não tem conhecimento suficiente para usar este shrine.",
            );
          }
          return false;
        }
      }

      // Verifica se player está adjacente
      const dx = Math.abs(player.x - ctx.target.x);
      const dy = Math.abs(player.y - ctx.target.y);

      if (dx > 1 || dy > 1) {
        return false;
      }

      if (openImbueUI) {
        openImbueUI({
          x: ctx.target.x,
          y: ctx.target.y,
          z: ctx.target.z,
        });
        return true;
      }

      return false;
    });
  }
}

/**
 * Registra ação de objeto de quest
 */
function registerQuestObjectAction(actionSystem, worldState, config) {
  const { spriteIds, questId, message } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { player, showLookMessage, setStorageValue } = ctx;

      if (!player) return false;

      // Verifica se já completou
      const completed = player.storage?.[`quest_${questId}_completed`];
      if (completed) {
        if (showLookMessage) {
          showLookMessage("Você já interagiu com este objeto.");
        }
        return false;
      }

      // Marca quest como completada
      if (setStorageValue) {
        setStorageValue(`quest_${questId}_completed`, 1);
      }

      if (showLookMessage) {
        showLookMessage(message);
      }

      console.log(`[Quest] ${questId}: ${message}`);
      return true;
    });
  }
}

/**
 * Registra ação de mechanism
 */
function registerMechanismAction(actionSystem, worldState, config) {
  const { spriteIds, onUse } = config;

  for (const spriteId of spriteIds) {
    actionSystem.registerItemAction(spriteId, (ctx) => {
      const { player, target } = ctx;

      if (!player || !target) return false;

      // Verifica se player está adjacente
      const dx = Math.abs(player.x - target.x);
      const dy = Math.abs(player.y - target.y);

      if (dx > 1 || dy > 1) {
        return false;
      }

      if (onUse) {
        return onUse(ctx);
      }

      return false;
    });
  }
}

/**
 * Registra ação customizada para uma posição específica
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Function} handler - (ctx) => boolean
 */
export function registerPositionAction(x, y, z, handler) {
  const actionSystem = getActionSystem();
  actionSystem.registerPositionAction(x, y, z, handler);
}

/**
 * Registra ação customizada para um sprite específico
 * @param {number} spriteId
 * @param {Function} handler - (ctx) => boolean
 */
export function registerCustomItemAction(spriteId, handler) {
  const actionSystem = getActionSystem();
  actionSystem.registerItemAction(spriteId, handler);
}
