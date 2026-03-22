// ═══════════════════════════════════════════════════════════════
// initRPGPlayerActions.js — Integração de Player Actions no RPG
// ═══════════════════════════════════════════════════════════════

import { getActionSystem } from "../../core/actionSystem.js";
import { registerDefaultActions } from "../../gameplay/defaultActions.js";
import { PlayerAction, getActionCursor } from "../../core/playerAction.js";
import { PathFinder } from "../../core/pathfinding.js";
import { isTileWalkable } from "../../core/collision.js";
import { worldEvents, EVENT_TYPES } from "../../core/events.js";
import { resolveStepOnEffects } from "../../core/TileEffects.js";
import { calculateStepDuration } from "../../gameplay/gameCore.js";
import { getDirectionFromDelta } from "../../gameplay/combatLogic.js";
import { logger } from "../../core/logger.js";

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
  logger.debug("[RPG PlayerActions] Inicializando...");

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
    logger.debug("[RPG PlayerActions] ITEM_OUT_OF_REACH recebido:", eventData);
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
      logger.warn(
        "[RPG PlayerActions] posToMoveTo inválido:",
        posToMoveTo,
        "moveToTarget:",
        moveToTarget,
      );
      showFloatingText("Posição inválida", "error");
      return;
    }

    logger.debug(
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
      logger.debug(
        "[RPG PlayerActions] Movendo para posição adjacente:",
        adjacentPos,
        "para:",
        posToMoveTo,
      );
      // Move player até posição adjacente
      executeWalkTo(player, adjacentPos, pathFinder, onPlayerMove, () => {
        // Após chegar, tenta mover o item automaticamente
        logger.debug(
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
      }, worldState);
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

  logger.debug("[RPG PlayerActions] Sistema inicializado!");
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
    logger.debug("[RPG Input] pointerdown — origem do drag:", _dragOrigin);
  };

  // Listener de pointerup — marca que houve drag recente
  const handlePointerUp = () => {
    logger.debug(
      "[RPG Input] pointerup — _dragTarget:",
      _dragTarget,
      "_dragOrigin:",
      _dragOrigin,
    );

    // SÓ marca _wasDragging se realmente houve drag (classe item-dragging no body)
    const hadActualDrag = document.body.classList.contains("item-dragging");

    if (hadActualDrag) {
      logger.debug("[RPG Input] pointerup com drag detectado");
      _wasDragging = true;

      // Limpa timeout anterior se existir
      if (_dragTimeout) clearTimeout(_dragTimeout);

      // Reset após 200ms (tempo suficiente para o click ser disparado)
      _dragTimeout = setTimeout(() => {
        _wasDragging = false;
        _dragOrigin = null;
        _dragTarget = null;
        logger.debug("[RPG Input] _wasDragging resetado");
      }, 200);
    } else {
      logger.debug("[RPG Input] pointerup SEM drag");
    }
  };

  // Adiciona listeners no canvas (capturing phase)
  canvas.addEventListener("pointerdown", handlePointerDown, true);
  canvas.addEventListener("pointerup", handlePointerUp, true);

  // Armazena handlers para cleanup
  canvas._rpgPointerUpHandler = handlePointerUp;
  canvas._rpgPointerDownHandler = handlePointerDown;

  // Handler de clique no canvas
  const handleClick = (e) => {
    logger.debug(
      "[RPG Input] handleClick — _dragTarget:",
      _dragTarget,
      "_dragOrigin:",
      _dragOrigin,
    );

    // Verifica se há drag em andamento (via classe CSS)
    const isDraggingNow = document.body.classList.contains("item-dragging");

    // SE VEIO DE DRAG — Não processa como autowalk
    if (_wasDragging || isDraggingNow) {
      logger.debug(
        "[RPG Input] Ignorado — _wasDragging:",
        _wasDragging,
        "isDraggingNow:",
        isDraggingNow,
      );
      return;
    }

    logger.debug("[RPG Input] Processando clique normal");
    logger.debug(
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

    logger.debug(
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

    logger.debug("[RPG Input] Clique em", targetTile, "Ação:", action);

    // Executa ação
    if (action === PlayerAction.AUTOWALK_HIGHLIGHT || action === 4) {
      // Move para o tile clicado (ou origem do drag)
      executeWalkTo(player, targetTile, pathFinder, onPlayerMove, undefined, worldState);
    } else if (action === PlayerAction.CHANGE_FLOOR) {
      // Muda floor (escada)
      executeFloorChange(
        player,
        targetTile,
        metadata,
        onPlayerMove,
        onPlayerAction,
        worldState,
      );
    } else if (action === PlayerAction.LOOK || action === 1) {
      // Look
      executeLook(targetTile, metadata);
    } else if (action === PlayerAction.USE || action === 2) {
      // Use (inclui toggle de portas)
      executeUse(player, targetTile, metadata, onPlayerAction, worldState);
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
  worldState,
) {
  const start = { x: player.x, y: player.y, z: player.z };
  const goal = targetTile;

  // Encontra caminho
  const result = pathFinder.findPath(start, goal);

  if (!result || result.path.length === 0) {
    logger.warn("[RPG PathFinder] Sem caminho para", goal);
    return;
  }

  // Segue o caminho passo a passo — começa em 1 para pular o nó de origem
  let stepIndex = 1;

  function nextStep() {
    if (stepIndex >= result.path.length) {
      logger.debug("[RPG Autowalk] Concluso!");
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

    // Verifica efeito de tile (teleporte ou escada)
    const effect = resolveStepOnEffects(nextPos.x, nextPos.y, nextPos.z, worldState);
    if (effect?.type === "teleport") {
      onPlayerMove(effect.dest.x, effect.dest.y, effect.dest.z, direction);
      logger.debug(`[TileEffects] Teleporte → (${effect.dest.x},${effect.dest.y},${effect.dest.z})`);
      if (onComplete) onComplete();
      return; // interrompe o autowalk
    }
    if (effect?.type === "floor_change") {
      onPlayerMove(effect.newX, effect.newY, effect.newZ, direction);
      logger.debug(`[TileEffects] Mudança de andar → Z=${effect.newZ}`);
      if (onComplete) onComplete();
      return; // interrompe o autowalk
    }

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
  worldState,
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

  logger.debug("[FloorChange] Mudando para Z =", newZ);

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
  logger.debug("[Look]", message);

  // Exibe no chat/log do RPG
  showRPGMessage(message, "look");
}

/**
 * Executa ação de Use.
 * Se o item for uma porta (metadata.door), delega para executeDoor.
 */
function executeUse(player, targetTile, metadata, onPlayerAction, worldState) {
  if (metadata?.door) {
    executeDoor(targetTile, metadata, worldState, onPlayerAction);
    return;
  }

  logger.debug("[Use]", metadata?.name || targetTile);

  if (onPlayerAction) {
    onPlayerAction({
      type: "use",
      target: targetTile,
      itemId: metadata?.id,
    });
  }
}

/**
 * Abre ou fecha uma porta trocando o item no tile pelo openId/closedId.
 * A porta precisa estar no worldState.map (tile) e ter metadata.door.
 *
 * @param {{x,y,z}} targetTile
 * @param {Object}  metadata   — entrada do map_data com .door e .id
 * @param {Object}  worldState — estado do mundo (worldState.map)
 * @param {Function} onPlayerAction — callback para enviar ação ao servidor
 */
function executeDoor(targetTile, metadata, worldState, onPlayerAction) {
  const door = metadata?.door;
  if (!door) return;

  const { x, y, z } = targetTile;
  const tileKey = `${x},${y},${z}`;
  const tile = worldState?.map?.[tileKey];
  if (!tile) return;

  const currentId = metadata.id;
  const isOpen = currentId === door.openId;
  const nextId = isOpen ? door.closedId : door.openId;

  logger.debug(`[Door] ${isOpen ? "Fechando" : "Abrindo"} porta ${currentId} → ${nextId} em ${tileKey}`);

  // Troca o item no tile localmente (todos os layers)
  const layerKeys = Object.keys(tile).filter((k) => !isNaN(Number(k)));
  for (const layerKey of layerKeys) {
    const layer = tile[layerKey];
    if (!Array.isArray(layer)) continue;
    for (const item of layer) {
      if (typeof item === "object" && item !== null && item.id === currentId) {
        item.id = nextId;
      }
    }
  }

  // Invalida cache de render para forçar re-draw
  if (worldState.floorIndex) {
    const floorMap = worldState.floorIndex.get(z);
    if (floorMap) {
      const record = floorMap.get(tileKey);
      if (record) {
        // Rebuilda flatItems para refletir a troca
        record.flatItems = record.flatItems?.map((item) =>
          typeof item === "object" && item?.id === currentId ? { ...item, id: nextId } : item
        );
      }
    }
  }

  // Notifica servidor/Firebase para persistir a mudança
  if (onPlayerAction) {
    onPlayerAction({
      type: "toggle_door",
      target: { x, y, z },
      fromId: currentId,
      toId: nextId,
    });
  }
}

/**
 * Executa ação de Open
 */
function executeOpen(player, targetTile, metadata, onPlayerAction) {
  logger.debug("[Open]", metadata?.name || targetTile);

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
      logger.debug("[Attack] Alvo:", mob);

      // Dispatch de evento para o sistema de combate
      window.dispatchEvent(
        new CustomEvent("rpgAttackTarget", {
          detail: { targetId: id, target: mob },
        }),
      );

      return;
    }
  }

  logger.warn("[Attack] Nenhum alvo no tile");
}

/**
 * Determina ação baseada no contexto
 */
function determineAction(player, tile, metadata) {
  if (!metadata) return PlayerAction.AUTOWALK_HIGHLIGHT;

  const game = metadata.game || {};
  const raw  = metadata.flags_raw || {};
  // ✅ Novo: flags planos em game; Fallback: flags_raw (legado protobuf)
  const bank      = game.bank      ?? raw.bank;
  const clip      = game.clip      ?? raw.clip;
  const bottom    = game.bottom    ?? raw.bottom;

  // Verifica default_action
  const defaultActionRaw = game.default_action ?? raw.defaultAction;
  const defaultAction = typeof defaultActionRaw === "object"
    ? defaultActionRaw?.action
    : defaultActionRaw;
  if (defaultAction != null) return defaultAction;

  // Ground tile (bank ou layer 0) → autowalk
  if (bank || (game.layer ?? game.render_layer) === 0) {
    return PlayerAction.AUTOWALK_HIGHLIGHT;
  }

  // GroundBorder (clip sem bottom) → autowalk
  if (clip && !bottom) {
    return PlayerAction.AUTOWALK_HIGHLIGHT;
  }

  // Porta → USE (toggle abre/fecha)
  if (metadata.door) {
    return PlayerAction.USE;
  }

  // Container → OPEN
  if (game.container) {
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
 * Pega metadata de um tile — suporta formato compacto {\"0\":[...],\"2\":[...]} e legado
 */
function getTileMetadata(tileData, nexoData) {
  if (!tileData || !nexoData) return null;

  // Achata todas as layers em um array flat (formato compacto do map_compacto.json)
  let items;
  if (Array.isArray(tileData)) {
    items = tileData;
  } else if (Array.isArray(tileData.items)) {
    items = tileData.items;
  } else {
    // Formato {"0":[...],"2":[...]} — itera layers em ordem decrescente (2→1→0)
    // para priorizar items sobre ground
    items = [];
    const layerKeys = Object.keys(tileData)
      .map(Number).filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a); // descending: camada 2 antes da 0
    for (const k of layerKeys) {
      const layer = tileData[String(k)];
      if (Array.isArray(layer)) items.push(...layer);
    }
  }

  // Prioriza primeiro item que não é ground (layer 0)
  for (const item of items) {
    const spriteId = typeof item === "object" ? item.id : item;
    const metadata = nexoData[String(spriteId)];
    if (metadata && metadata.game?.layer !== 0 && metadata.game?.movement_cost == null) {
      return metadata;
    }
  }

  // Fallback: primeiro item encontrado
  if (items.length > 0) {
    const first = items[0];
    const spriteId = typeof first === "object" ? first.id : first;
    return nexoData[String(spriteId)];
  }

  return null;
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

  logger.debug(`[RPG ${type}]`, message);
}

/**
 * Encontra posição adjacente walkável ao target
 */
function findAdjacentPosition(player, targetPos, map, nexoData) {
  // Valida player
  if (!player) {
    logger.warn("[findAdjacentPosition] Player undefined");
    return null;
  }

  // Valida targetPos
  if (!targetPos || targetPos.x == null || targetPos.y == null) {
    logger.warn("[findAdjacentPosition] targetPos inválido:", targetPos);
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
  logger.debug("[RPG PlayerActions] Retry item move:", pendingMove);

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

  logger.debug("[RPG PlayerActions] Ação de move re-enviada");
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
    canvas._rpgPointerUpHandler = null;
  }
  if (canvas?._rpgPointerDownHandler) {
    canvas.removeEventListener("pointerdown", canvas._rpgPointerDownHandler, true);
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
