// ═══════════════════════════════════════════════════════════════
// initRPGPlayerActions.js — Integração de Player Actions no RPG
// ═══════════════════════════════════════════════════════════════

import { getActionSystem } from "../../core/actionSystem.js";
import { registerDefaultActions } from "../../gameplay/defaultActions.js";
import { PlayerAction } from "../../core/playerAction.js";
import { PathFinder } from "../../core/pathfinding.js";
import { isTileWalkable } from "../../core/collision.js";
import { worldEvents, EVENT_TYPES } from "../../core/events.js";

/**
 * Inicializa Player Actions específico para o RPG
 * @param {Object} opts
 * @param {Object} opts.player - Player entity (myPos)
 * @param {Object} opts.worldState - Estado do mundo (map, camera, assets)
 * @param {HTMLCanvasElement} opts.canvas - Canvas do jogo
 * @param {Function} opts.onPlayerMove - Callback de movimento (nx, ny, nz, dir)
 * @param {Function} opts.onPlayerAction - Callback de ação
 */
export function initRPGPlayerActions({
  player,
  worldState,
  canvas,
  onPlayerMove,
  onPlayerAction,
}) {
  console.log("[RPG PlayerActions] Inicializando...");

  // 1. Registra ações padrão
  registerDefaultActions(worldState);

  // 2. Cria PathFinder com validação de colisão
  const pathFinder = new PathFinder({
    allowDiagonal: false, // RPG usa apenas 4 direções
    isWalkable: (x, y, z) => {
      // Usa sistema de colisão existente
      return isTileWalkable(
        x,
        y,
        z,
        worldState.map,
        worldState.assets?.mapData,
      );
    },
  });

  // 3. Listener para ITEM_OUT_OF_REACH — faz player se aproximar e move item
  let _pendingItemMove = null;

  const handleItemOutOfReach = (eventData) => {
    console.log("[RPG PlayerActions] ITEM_OUT_OF_REACH recebido:", eventData);
    const {
      targetPos,
      distance,
      maxRange,
      source,
      slotIndex,
      worldItemId,
      fromPos,
      moveToTarget,
    } = eventData;

    // Salva estado do item para mover após chegar
    _pendingItemMove = {
      source,
      slotIndex,
      worldItemId,
      targetPos,
      fromPos, // Posição de origem do item
    };

    // Determina para onde o player deve andar
    // Se moveToTarget=true, vai para o DESTINO (para soltar o item)
    // Se moveToTarget=false, vai para a ORIGEM (para pegar o item)
    const posToMoveTo = moveToTarget ? targetPos : fromPos;

    // Valida posToMoveTo antes de usar
    if (!posToMoveTo || posToMoveTo.x == null || posToMoveTo.y == null) {
      console.warn(
        "[RPG PlayerActions] posToMoveTo inválido:",
        posToMoveTo,
        "moveToTarget:",
        moveToTarget,
      );
      showFloatingText("Posição inválida", "error");
      return;
    }

    console.log(
      "[RPG PlayerActions] moveToTarget:",
      moveToTarget,
      "posToMoveTo:",
      posToMoveTo,
    );

    // Calcula posição adjacente à posição de destino
    const adjacentPos = findAdjacentPosition(
      player,
      posToMoveTo,
      worldState.map,
      worldState.assets?.mapData,
    );

    if (adjacentPos) {
      console.log(
        "[RPG PlayerActions] Movendo para posição adjacente:",
        adjacentPos,
        "para:",
        posToMoveTo,
      );
      // Move player até posição adjacente
      executeWalkTo(player, adjacentPos, pathFinder, onPlayerMove, () => {
        // Após chegar, tenta mover o item automaticamente
        console.log(
          "[RPG PlayerActions] Player chegou perto,",
          moveToTarget ? "tentando soltar item" : "tentando pegar item",
        );
        setTimeout(() => {
          if (_pendingItemMove) {
            // Re-envia a ação de move
            retryItemMove(_pendingItemMove, onPlayerAction);
            _pendingItemMove = null;
          }
        }, 300);
      });
    }
  };

  // Registra listener
  worldEvents.subscribe(EVENT_TYPES.ITEM_OUT_OF_REACH, handleItemOutOfReach);

  // Armazena para cleanup
  worldState._itemOutOfReachHandler = handleItemOutOfReach;
  worldState._getPendingItemMove = () => _pendingItemMove;
  worldState._clearPendingItemMove = () => {
    _pendingItemMove = null;
  };

  // 4. Setup de input específico para RPG
  setupRPGInputHandler({
    canvas,
    player,
    worldState,
    pathFinder,
    onPlayerMove,
    onPlayerAction,
  });

  console.log("[RPG PlayerActions] Sistema inicializado!");
  return { pathFinder };
}

/**
 * Setup do handler de input para RPG
 */
function setupRPGInputHandler({
  canvas,
  player,
  worldState,
  pathFinder,
  onPlayerMove,
  onPlayerAction,
}) {
  // Flag para detectar se veio de um drag
  let _wasDragging = false;
  let _dragTimeout = null;
  let _dragOrigin = null; // Posição onde o drag começou
  let _dragTarget = null; // Posição do tile sob o mouse no pointerdown

  // Listener de pointerdown — salva origem do drag
  const handlePointerDown = (e) => {
    // Converte posição do clique em tile
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const tileX = Math.floor((clickX + worldState.camera.x) / 32);
    const tileY = Math.floor((clickY + worldState.camera.y) / 32);

    _dragOrigin = { x: tileX, y: tileY, z: player.z ?? 7 };
    _dragTarget = { x: tileX, y: tileY, z: player.z ?? 7 };
    console.log("[RPG Input] pointerdown — origem do drag:", _dragOrigin);
  };

  // Listener de pointerup — marca que houve drag recente
  const handlePointerUp = () => {
    console.log(
      "[RPG Input] pointerup — _dragTarget:",
      _dragTarget,
      "_dragOrigin:",
      _dragOrigin,
    );

    // SÓ marca _wasDragging se realmente houve drag (classe item-dragging no body)
    const hadActualDrag = document.body.classList.contains("item-dragging");

    if (hadActualDrag) {
      console.log("[RPG Input] pointerup com drag detectado");
      _wasDragging = true;

      // Limpa timeout anterior se existir
      if (_dragTimeout) clearTimeout(_dragTimeout);

      // Reset após 200ms (tempo suficiente para o click ser disparado)
      _dragTimeout = setTimeout(() => {
        _wasDragging = false;
        _dragOrigin = null;
        _dragTarget = null;
        console.log("[RPG Input] _wasDragging resetado");
      }, 200);
    } else {
      console.log("[RPG Input] pointerup SEM drag");
    }
  };

  // Adiciona listeners GLOBAIS (capturing phase) para garantir que pegamos o evento
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("pointerup", handlePointerUp, true);

  // Também adiciona no canvas
  canvas.addEventListener("pointerdown", handlePointerDown, true);
  canvas.addEventListener("pointerup", handlePointerUp, true);

  // Armazena handlers para cleanup
  canvas._rpgPointerUpHandler = handlePointerUp;
  canvas._rpgPointerDownHandler = handlePointerDown;

  // Handler de clique no canvas
  const handleClick = (e) => {
    console.log(
      "[RPG Input] handleClick — _dragTarget:",
      _dragTarget,
      "_dragOrigin:",
      _dragOrigin,
    );

    // Verifica se há drag em andamento (via classe CSS)
    const isDraggingNow = document.body.classList.contains("item-dragging");

    // SE VEIO DE DRAG — Não processa como autowalk
    if (_wasDragging || isDraggingNow) {
      console.log(
        "[RPG Input] Ignorado — _wasDragging:",
        _wasDragging,
        "isDraggingNow:",
        isDraggingNow,
      );
      return;
    }

    console.log("[RPG Input] Processando clique normal");
    console.log(
      "[RPG Input] _wasDragging:",
      _wasDragging,
      "isDraggingNow:",
      isDraggingNow,
    );

    // Usa _dragTarget (posição no pointerdown) se disponível
    // Isso faz o player andar até ONDE CLICOU inicialmente, não onde soltou
    const targetTile = _dragTarget || {
      x: Math.floor(
        (e.clientX -
          canvas.getBoundingClientRect().left +
          worldState.camera.x) /
          32,
      ),
      y: Math.floor(
        (e.clientY - canvas.getBoundingClientRect().top + worldState.camera.y) /
          32,
      ),
      z: player.z ?? 7,
    };

    console.log(
      "[RPG Input] targetTile:",
      targetTile,
      "_dragTarget foi usado:",
      !!_dragTarget,
    );

    // Limpa drag target após usar
    _dragTarget = null;
    _dragOrigin = null;

    // Pega metadata do tile
    const tileKey = `${targetTile.x},${targetTile.y},${targetTile.z}`;
    const tileData = worldState.map?.[tileKey];
    const metadata = getTileMetadata(tileData, worldState.assets?.mapData);

    // Determina ação
    const action = determineAction(player, targetTile, metadata);

    console.log("[RPG Input] Clique em", targetTile, "Ação:", action);

    // Executa ação
    if (action === PlayerAction.AUTOWALK_HIGHLIGHT || action === 4) {
      // Move para o tile clicado (ou origem do drag)
      executeWalkTo(player, targetTile, pathFinder, onPlayerMove);
    } else if (action === PlayerAction.CHANGE_FLOOR) {
      // Muda floor (escada)
      executeFloorChange(
        player,
        targetTile,
        metadata,
        onPlayerMove,
        onPlayerAction,
      );
    } else if (action === PlayerAction.LOOK || action === 1) {
      // Look
      executeLook(targetTile, metadata);
    } else if (action === PlayerAction.USE || action === 2) {
      // Use
      executeUse(player, targetTile, metadata, onPlayerAction);
    } else if (action === PlayerAction.OPEN || action === 3) {
      // Open
      executeOpen(player, targetTile, metadata, onPlayerAction);
    } else if (action === PlayerAction.ATTACK) {
      // Attack - delega para sistema de combate existente
      executeAttack(targetTile, worldState);
    }
  };

  // Adiciona listener
  canvas.addEventListener("click", handleClick);

  // Armazena para cleanup
  canvas._rpgActionHandler = handleClick;

  // Mouse move (opcional - para highlight)
  const handleMouseMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const tileX = Math.floor(
      (e.clientX - rect.left + worldState.camera.x) / 32,
    );
    const tileY = Math.floor((e.clientY - rect.top + worldState.camera.y) / 32);

    // Atualiza cursor baseado na ação
    const tileKey = `${tileX},${tileY},${player.z ?? 7}`;
    const tileData = worldState.map?.[tileKey];
    const metadata = getTileMetadata(tileData, worldState.assets?.mapData);
    const action = determineAction(
      player,
      { x: tileX, y: tileY, z: player.z },
      metadata,
    );

    canvas.style.cursor = getActionCursor(action);
  };

  canvas.addEventListener("mousemove", handleMouseMove);
  canvas._rpgMouseMoveHandler = handleMouseMove;
}

/**
 * Executa walk até um tile
 */
function executeWalkTo(
  player,
  targetTile,
  pathFinder,
  onPlayerMove,
  onComplete,
) {
  const start = { x: player.x, y: player.y, z: player.z };
  const goal = targetTile;

  // Encontra caminho
  const result = pathFinder.findPath(start, goal);

  if (!result || result.path.length === 0) {
    console.warn("[RPG PathFinder] Sem caminho para", goal);
    return;
  }

  // Segue o caminho passo a passo — começa em 1 para pular o nó de origem
  let stepIndex = 1;

  function nextStep() {
    if (stepIndex >= result.path.length) {
      console.log("[RPG Autowalk] Concluso!");
      // Callback ao finalizar
      if (onComplete) onComplete();
      return;
    }

    const nextPos = result.path[stepIndex];
    const direction = getDirectionFromDelta(
      nextPos.x - result.path[stepIndex - 1].x,
      nextPos.y - result.path[stepIndex - 1].y,
    );

    // Move player
    onPlayerMove(nextPos.x, nextPos.y, nextPos.z, direction);

    stepIndex++;

    // Próximo passo após delay
    const speed = player.speed ?? 100;
    const stepDuration = calculateStepDuration(speed);
    setTimeout(nextStep, stepDuration);
  }

  nextStep();
}

/**
 * Executa mudança de floor (escada)
 */
function executeFloorChange(
  player,
  targetTile,
  metadata,
  onPlayerMove,
  onPlayerAction,
) {
  // Verifica se está adjacente à escada
  const dx = Math.abs(player.x - targetTile.x);
  const dy = Math.abs(player.y - targetTile.y);

  if (dx > 1 || dy > 1) {
    // Precisa andar até a escada primeiro
    executeWalkTo(player, targetTile, null, (nx, ny, nz, dir) => {
      onPlayerMove(nx, ny, nz, dir);
      // Após chegar, executa mudança de floor
      setTimeout(() => {
        doFloorChange(player, metadata, onPlayerMove, onPlayerAction);
      }, 200);
    });
  } else {
    // Já está adjacente
    doFloorChange(player, metadata, onPlayerMove, onPlayerAction);
  }
}

/**
 * Executa a mudança de floor
 */
function doFloorChange(player, metadata, onPlayerMove, onPlayerAction) {
  const floorChange = metadata?.game?.floor_change || -1;
  const newZ = (player.z ?? 7) + floorChange;

  console.log("[FloorChange] Mudando para Z =", newZ);

  // Notifica mudança
  if (onPlayerAction) {
    onPlayerAction({
      type: "change_floor",
      fromZ: player.z,
      toZ: newZ,
    });
  }

  // Move player
  onPlayerMove(player.x, player.y, newZ, player.direcao || "frente");
}

/**
 * Executa ação de Look
 */
function executeLook(targetTile, metadata) {
  const name = metadata?.name || `Item ${targetTile.x},${targetTile.y}`;
  const description = metadata?.description || "";

  const message = description ? `${name}: ${description}` : name;
  console.log("[Look]", message);

  // Exibe no chat/log do RPG
  showRPGMessage(message, "look");
}

/**
 * Executa ação de Use
 */
function executeUse(player, targetTile, metadata, onPlayerAction) {
  console.log("[Use]", metadata?.name || targetTile);

  if (onPlayerAction) {
    onPlayerAction({
      type: "use",
      target: targetTile,
      itemId: metadata?.id,
    });
  }
}

/**
 * Executa ação de Open
 */
function executeOpen(player, targetTile, metadata, onPlayerAction) {
  console.log("[Open]", metadata?.name || targetTile);

  if (onPlayerAction) {
    onPlayerAction({
      type: "open",
      target: targetTile,
      itemId: metadata?.id,
    });
  }
}

/**
 * Executa ação de Attack
 */
function executeAttack(targetTile, worldState) {
  // Delega para sistema de combate existente
  // Encontra monstro no tile
  const monsters = worldState.getMonsters?.() || {};

  for (const [id, mob] of Object.entries(monsters)) {
    if (!mob || (mob.stats?.hp ?? 0) <= 0 || mob.dead) continue;
    if (
      Math.round(mob.x) === targetTile.x &&
      Math.round(mob.y) === targetTile.y
    ) {
      // Triggera ataque
      console.log("[Attack] Alvo:", mob);

      // Dispatch de evento para o sistema de combate
      window.dispatchEvent(
        new CustomEvent("rpgAttackTarget", {
          detail: { targetId: id, target: mob },
        }),
      );

      return;
    }
  }

  console.warn("[Attack] Nenhum alvo no tile");
}

/**
 * Determina ação baseada no contexto
 */
function determineAction(player, tile, metadata) {
  if (!metadata) return PlayerAction.AUTOWALK_HIGHLIGHT;

  // Verifica default_action
  const defaultActionRaw =
    metadata.game?.default_action || metadata.flags_raw?.defaultAction;
  const defaultAction =
    typeof defaultActionRaw === "object"
      ? defaultActionRaw?.action
      : defaultActionRaw;

  if (defaultAction != null) {
    return defaultAction;
  }

  // Inferência baseada em flags
  const flags = metadata.flags_raw || {};
  const game = metadata.game || {};

  if (flags.bank || game.render_layer === 0) {
    return PlayerAction.AUTOWALK_HIGHLIGHT;
  }

  if (flags.clip) {
    return PlayerAction.AUTOWALK_HIGHLIGHT;
  }

  if (flags.container) {
    return PlayerAction.OPEN;
  }

  if (game.category_type === "teleport") {
    return PlayerAction.TELEPORT;
  }

  if (game.category_type === "npc") {
    return PlayerAction.TALK;
  }

  if (game.category_type === "creature") {
    return PlayerAction.ATTACK;
  }

  if (game.category_type === "floor_change") {
    return PlayerAction.CHANGE_FLOOR;
  }

  return PlayerAction.AUTOWALK_HIGHLIGHT;
}

/**
 * Pega metadata de um tile
 */
function getTileMetadata(tileData, nexoData) {
  if (!tileData || !nexoData) return null;

  // Tile pode ser array ou objeto
  const items = Array.isArray(tileData) ? tileData : tileData.items || [];

  // Pega primeiro item não-ground (prioriza items visíveis)
  for (const item of items) {
    const spriteId = typeof item === "object" ? item.id : item;
    const metadata = nexoData[String(spriteId)];
    if (metadata && metadata.category !== "ground") {
      return metadata;
    }
  }

  // Fallback: pega primeiro item
  if (items.length > 0) {
    const firstItem = items[0];
    const spriteId = typeof firstItem === "object" ? firstItem.id : firstItem;
    return nexoData[String(spriteId)];
  }

  return null;
}

/**
 * Converte delta em direção
 */
function getDirectionFromDelta(dx, dy) {
  if (dx === 0 && dy === -1) return "costas";
  if (dx === 0 && dy === 1) return "frente";
  if (dx === -1 && dy === 0) return "lado-esquerdo";
  if (dx === 1 && dy === 0) return "lado";
  return "frente";
}

/**
 * Calcula duração do passo
 */
function calculateStepDuration(speed) {
  // Fórmula do RPG: speed 100 = 400ms, speed 200 = 200ms
  return Math.max(100, Math.floor(40000 / speed));
}

/**
 * Retorna cursor baseado na ação
 */
function getActionCursor(action) {
  const cursorMap = {
    0: "default",
    1: "crosshair",
    2: "pointer",
    3: "pointer",
    4: "move",
    ATTACK: "crosshair",
    TALK: "help",
    TELEPORT: "alias",
  };
  return cursorMap[action] || "default";
}

/**
 * Mostra mensagem no chat do RPG
 */
function showRPGMessage(message, type = "system") {
  // Envia evento para o chat do RPG
  window.dispatchEvent(
    new CustomEvent("rpgChatMessage", {
      detail: { message, type },
    }),
  );

  console.log(`[RPG ${type}]`, message);
}

/**
 * Encontra posição adjacente walkável ao target
 */
function findAdjacentPosition(player, targetPos, map, nexoData) {
  // Valida player
  if (!player) {
    console.warn("[findAdjacentPosition] Player undefined");
    return null;
  }

  // Valida targetPos
  if (!targetPos || targetPos.x == null || targetPos.y == null) {
    console.warn("[findAdjacentPosition] targetPos inválido:", targetPos);
    return {
      x: Math.round(player.x),
      y: Math.round(player.y),
      z: player.z ?? 7,
    };
  }

  const targetX = Math.round(targetPos.x);
  const targetY = Math.round(targetPos.y);
  const targetZ = targetPos.z ?? player.z ?? 7;

  // Posições adjacentes (4 direções)
  const adjacentOffsets = [
    { dx: 0, dy: -1 }, // Norte
    { dx: 0, dy: 1 }, // Sul
    { dx: -1, dy: 0 }, // Oeste
    { dx: 1, dy: 0 }, // Leste
  ];

  for (const { dx, dy } of adjacentOffsets) {
    const adjX = targetX + dx;
    const adjY = targetY + dy;

    // Verifica se é walkable
    if (isTileWalkable(adjX, adjY, targetZ, map, nexoData)) {
      return { x: adjX, y: adjY, z: targetZ };
    }
  }

  // Se nenhuma adjacente for walkável, retorna a própria posição do target
  return { x: targetX, y: targetY, z: targetZ };
}

/**
 * Re-envia ação de mover item após player se aproximar
 */
function retryItemMove(pendingMove, onPlayerAction) {
  console.log("[RPG PlayerActions] Retry item move:", pendingMove);

  const { source, slotIndex, worldItemId, targetPos } = pendingMove;

  if (source === "inventory" && slotIndex != null) {
    // Move item do inventário para o chão
    onPlayerAction({
      type: "item",
      payload: {
        itemAction: "drop",
        slotIndex,
        toX: Math.round(targetPos.x),
        toY: Math.round(targetPos.y),
        toZ: targetPos.z ?? 7,
      },
    });
  } else if (source === "world" && worldItemId && !targetPos) {
    // Pegar item do mundo para o inventário
    onPlayerAction({
      type: "item",
      payload: {
        itemAction: "pickUp",
        worldItemId,
      },
    });
  } else if (source === "world" && worldItemId) {
    // Move item no mundo
    onPlayerAction({
      type: "item",
      payload: {
        itemAction: "moveWorld",
        worldItemId,
        toX: Math.round(targetPos.x),
        toY: Math.round(targetPos.y),
        toZ: targetPos.z ?? 7,
      },
    });
  }

  console.log("[RPG PlayerActions] Ação de move re-enviada");
}

/**
 * Cleanup
 */
export function cleanupRPGPlayerActions(canvas) {
  if (canvas?._rpgActionHandler) {
    canvas.removeEventListener("click", canvas._rpgActionHandler);
    canvas._rpgActionHandler = null;
  }
  if (canvas?._rpgMouseMoveHandler) {
    canvas.removeEventListener("mousemove", canvas._rpgMouseMoveHandler);
    canvas._rpgMouseMoveHandler = null;
  }
  // Remove listeners de pointer (com capture=true)
  if (canvas?._rpgPointerUpHandler) {
    canvas.removeEventListener("pointerup", canvas._rpgPointerUpHandler, true);
    document.removeEventListener(
      "pointerup",
      canvas._rpgPointerUpHandler,
      true,
    );
    canvas._rpgPointerUpHandler = null;
  }
  if (canvas?._rpgPointerDownHandler) {
    canvas.removeEventListener(
      "pointerdown",
      canvas._rpgPointerDownHandler,
      true,
    );
    document.removeEventListener(
      "pointerdown",
      canvas._rpgPointerDownHandler,
      true,
    );
    canvas._rpgPointerDownHandler = null;
  }
  // Remove listener de ITEM_OUT_OF_REACH
  if (canvas?._itemOutOfReachHandler) {
    worldEvents.unsubscribe(
      EVENT_TYPES.ITEM_OUT_OF_REACH,
      canvas._itemOutOfReachHandler,
    );
    canvas._itemOutOfReachHandler = null;
  }
  // Limpa pending item move
  if (canvas?._clearPendingItemMove) {
    canvas._clearPendingItemMove();
  }
  // Limpa drag target
  if (canvas) {
    canvas._dragTarget = null;
    canvas._dragOrigin = null;
  }
}
