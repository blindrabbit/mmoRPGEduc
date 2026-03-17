// ═══════════════════════════════════════════════════════════════
// initPlayerActions.js — Integração do sistema de Player Actions
// Para usar no worldEngine.html ou rpg.html
// ═══════════════════════════════════════════════════════════════

import { getActionSystem } from "../../../core/actionSystem.js";
import { registerDefaultActions } from "../../../gameplay/defaultActions.js";
import { createPlayerInputHandler } from "../../../gameplay/playerInputHandler.js";
import { PlayerAction } from "../../../core/playerAction.js";

/**
 * Inicializa o sistema de Player Actions
 * @param {Object} opts
 * @param {Object} opts.worldState - Estado do mundo
 * @param {HTMLCanvasElement} opts.canvas - Canvas do jogo
 * @param {Object} opts.camera - Câmera (x, y)
 * @param {Function} opts.onPlayerMove - Callback de movimento
 * @param {Function} opts.onPlayerAction - Callback de ação
 */
export function initPlayerActions({
  worldState,
  canvas,
  camera,
  onPlayerMove,
  onPlayerAction,
}) {
  console.log("[PlayerActions] Inicializando sistema...");

  // 1. Registra ações padrão (escadas, portas, NPCs, etc)
  registerDefaultActions(worldState);
  console.log("[PlayerActions] Ações padrão registradas.");

  // 2. Cria o handler de input
  const inputHandler = createPlayerInputHandler({
    canvas,
    camera,
    worldState,

    // Callback de movimento (autowalk)
    onPlayerMove: (moveData) => {
      console.log("[PlayerActions] Movimento:", moveData);

      if (moveData.type === "autowalk") {
        // Executa autowalk com as direções calculadas pelo pathfinding
        executeAutoWalk(moveData.directions, moveData.path);

        // Se tiver ação associada (ex: escada), executa após chegar
        if (moveData.action) {
          scheduleAction(moveData.action, moveData.target);
        }
      }

      // Callback externo
      if (onPlayerMove) {
        onPlayerMove(moveData);
      }
    },

    // Callback de ação (use, talk, attack, etc)
    onPlayerAction: (actionData) => {
      console.log("[PlayerActions] Ação:", actionData);

      // Processa ação baseada no tipo
      switch (actionData.type) {
        case "action":
          handleGenericAction(actionData);
          break;
        case "open_container":
          handleOpenContainer(actionData);
          break;
        case "chat":
          handleChat(actionData);
          break;
        case "change_floor":
          handleChangeFloor(actionData);
          break;
        default:
          console.log(
            "[PlayerActions] Ação não implementada:",
            actionData.type,
          );
      }

      // Callback externo
      if (onPlayerAction) {
        onPlayerAction(actionData);
      }
    },

    // Callback para mostrar mensagem de look
    showLookMessage: (message) => {
      console.log("[Look]", message);
      // Exibe no chat ou HUD
      showLookMessage(message);
    },
  });

  console.log("[PlayerActions] Sistema inicializado com sucesso!");

  return { inputHandler };
}

/**
 * Executa autowalk (movimento automático)
 * @param {number[]} directions - Array de direções (1-8)
 * @param {Object[]} path - Caminho calculado
 */
function executeAutoWalk(directions, path) {
  if (!directions || directions.length === 0) return;

  let currentIndex = 0;
  const stepDelay = 150; // ms entre cada passo (ajustável)

  function step() {
    if (currentIndex >= directions.length) {
      console.log("[AutoWalk] Concluso!");
      return;
    }

    const dir = directions[currentIndex];
    const delta = getDirectionDelta(dir);

    // Atualiza posição do player
    const player = window.worldState?.player;
    if (player) {
      player.x += delta.dx;
      player.y += delta.dy;

      // Atualiza câmera para seguir o player
      updateCameraToPlayer();
    }

    currentIndex++;

    // Próximo passo
    setTimeout(step, stepDelay);
  }

  step();
}

/**
 * Agenda ação para executar após autowalk
 */
function scheduleAction(action, target) {
  // Será executada quando o autowalk completar
  console.log("[PlayerActions] Ação agendada:", action, target);
}

/**
 * Handle genérico de ação
 */
function handleGenericAction(actionData) {
  const { action, target, metadata } = actionData;

  switch (action) {
    case PlayerAction.LOOK: // 1
      console.log("[Look]", metadata?.name || `Item ${target?.id}`);
      break;

    case PlayerAction.USE: // 2
      console.log("[Use]", metadata?.name || `Item ${target?.id}`);
      break;

    case PlayerAction.OPEN: // 3
      console.log("[Open]", metadata?.name || `Item ${target?.id}`);
      break;

    case PlayerAction.AUTOWALK_HIGHLIGHT: // 4
      console.log("[Autowalk]", target);
      break;

    default:
      console.log("[Action]", action, target);
  }
}

/**
 * Handle para abrir container
 */
function handleOpenContainer(actionData) {
  const { id, x, y, z } = actionData;
  console.log("[OpenContainer]", { id, x, y, z });

  // TODO: Abrir UI de container
  // openContainerUI(id, x, y, z);
}

/**
 * Handle para chat com NPC
 */
function handleChat(actionData) {
  const { id, name } = actionData;
  console.log("[Chat] Falando com", name, "ID:", id);

  // TODO: Abrir UI de diálogo
  // openDialogUI(id, name);
}

/**
 * Handle para mudança de floor
 */
function handleChangeFloor(actionData) {
  const { newZ } = actionData;
  const player = window.worldState?.player;

  if (player) {
    player.z = newZ;
    console.log("[ChangeFloor] Player agora em Z =", newZ);

    // Atualiza HUD de floor
    updateFloorHUD(newZ);
  }
}

/**
 * Delta de movimento por direção
 */
function getDirectionDelta(direction) {
  const deltas = {
    1: { dx: 1, dy: 0 }, // EAST
    2: { dx: 1, dy: -1 }, // NORTHEAST
    3: { dx: 0, dy: -1 }, // NORTH
    4: { dx: -1, dy: -1 }, // NORTHWEST
    5: { dx: -1, dy: 0 }, // WEST
    6: { dx: -1, dy: 1 }, // SOUTHWEST
    7: { dx: 0, dy: 1 }, // SOUTH
    8: { dx: 1, dy: 1 }, // SOUTHEAST
  };
  return deltas[direction] || { dx: 0, dy: 0 };
}

/**
 * Atualiza câmera para seguir o player
 */
function updateCameraToPlayer() {
  const ws = window.worldState;
  if (!ws?.player || !ws?.camera) return;

  const cols = 30; // WORLDENGINE.canvasCols
  const rows = 25; // WORLDENGINE.canvasRows

  ws.camera.x = ws.player.x - Math.floor(cols / 2);
  ws.camera.y = ws.player.y - Math.floor(rows / 2);
}

/**
 * Atualiza HUD de floor
 */
function updateFloorHUD(z) {
  const hudEl = document.getElementById("hud-z");
  if (hudEl) {
    hudEl.textContent = z;
  }
}

/**
 * Mostra mensagem de look
 */
function showLookMessage(message) {
  // Adiciona ao chat ou HUD
  const chatEl = document.getElementById("chat-messages");
  if (chatEl) {
    const line = document.createElement("div");
    line.className = "chat-line";
    line.innerHTML = `<span class="chat-ts">[${new Date().toLocaleTimeString()}]</span> <span class="chat-text">${message}</span>`;
    chatEl.appendChild(line);
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}
