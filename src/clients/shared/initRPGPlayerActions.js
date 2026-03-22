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
  const actionSystem = getActionSystem();

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
      executeWalkTo(
        player,
        adjacentPos,
        pathFinder,
        onPlayerMove,
        () => {
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
        },
        worldState,
      );
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
    actionSystem,
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
  actionSystem,
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
      executeWalkTo(
        player,
        targetTile,
        pathFinder,
        onPlayerMove,
        undefined,
        worldState,
      );
    } else if (action === PlayerAction.CHANGE_FLOOR) {
      // Muda floor (escada)
      executeFloorChange(
        player,
        targetTile,
        metadata,
        pathFinder,
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

  const handleContextMenu = (e) => {
    e.preventDefault();

    // Mesmo comportamento de drag do click normal: nao aciona use apos drag de item.
    const isDraggingNow = document.body.classList.contains("item-dragging");
    if (_wasDragging || isDraggingNow) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const targetTile = {
      x: Math.floor((e.clientX - rect.left + worldState.camera.x) / 32),
      y: Math.floor((e.clientY - rect.top + worldState.camera.y) / 32),
      z: player.z ?? 7,
    };

    const tileKey = `${targetTile.x},${targetTile.y},${targetTile.z}`;
    const tileData = worldState.map?.[tileKey];
    const metadata = getTileMetadata(tileData, worldState.assets?.mapData);

    executeItemOnUse(
      player,
      targetTile,
      tileData,
      metadata,
      actionSystem,
      pathFinder,
      onPlayerMove,
      onPlayerAction,
      worldState,
    );
  };

  canvas.addEventListener("contextmenu", handleContextMenu);

  // Armazena para cleanup
  canvas._rpgActionHandler = handleClick;
  canvas._rpgContextMenuHandler = handleContextMenu;

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
    const effect = resolveStepOnEffects(
      nextPos.x,
      nextPos.y,
      nextPos.z,
      worldState,
    );
    if (effect?.type === "teleport") {
      onPlayerMove(effect.dest.x, effect.dest.y, effect.dest.z, direction);
      logger.debug(
        `[TileEffects] Teleporte → (${effect.dest.x},${effect.dest.y},${effect.dest.z})`,
      );
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
  pathFinder,
  onPlayerMove,
  onPlayerAction,
  worldState,
) {
  // Verifica se está adjacente à escada
  const dx = Math.abs(player.x - targetTile.x);
  const dy = Math.abs(player.y - targetTile.y);

  if (dx > 1 || dy > 1) {
    // Para escada não-walkable, anda até posição adjacente primeiro.
    const adjacentPos = findAdjacentPosition(
      player,
      targetTile,
      worldState.map,
      worldState.assets?.mapData,
    );

    if (!adjacentPos) {
      logger.warn(
        "[FloorChange] Sem posição adjacente para escada",
        targetTile,
      );
      return;
    }

    executeWalkTo(
      player,
      adjacentPos,
      pathFinder,
      onPlayerMove,
      () => {
        // Após chegar adjacente, dispara o floorChange do tile clicado.
        setTimeout(() => {
          doFloorChange(
            player,
            targetTile,
            metadata,
            onPlayerMove,
            onPlayerAction,
            worldState,
          );
        }, 120);
      },
      worldState,
    );
  } else {
    // Já está adjacente
    doFloorChange(
      player,
      targetTile,
      metadata,
      onPlayerMove,
      onPlayerAction,
      worldState,
    );
  }
}

/**
 * Executa a mudança de floor
 */
function doFloorChange(
  player,
  targetTile,
  metadata,
  onPlayerMove,
  onPlayerAction,
  worldState,
) {
  const effect = resolveStepOnEffects(
    targetTile.x,
    targetTile.y,
    targetTile.z ?? player.z ?? 7,
    worldState,
  );

  if (effect?.type !== "floor_change") {
    logger.warn("[FloorChange] Tile clicado nao retornou floor_change", {
      targetTile,
      floorChange: metadata?.floorChange,
    });
    return;
  }

  logger.debug("[FloorChange] Mudando para", {
    x: effect.newX,
    y: effect.newY,
    z: effect.newZ,
  });

  // Notifica mudança
  if (onPlayerAction) {
    onPlayerAction({
      type: "change_floor",
      fromZ: player.z,
      toZ: effect.newZ,
    });
  }

  // Move player
  onPlayerMove(
    effect.newX,
    effect.newY,
    effect.newZ,
    player.direcao || "frente",
  );
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
  if (!isAdjacentToPlayer(player, targetTile)) {
    logger.info("[OnUse] Bloqueado: item fora de alcance (somente adjacente)", {
      player: { x: player?.x, y: player?.y, z: player?.z },
      target: targetTile,
      itemName: metadata?.name,
    });
    return;
  }

  const tileKey = `${targetTile.x},${targetTile.y},${targetTile.z ?? player.z ?? 7}`;
  const tileData = worldState?.map?.[tileKey];
  const resolvedItemId = getTopItemId(tileData, worldState?.assets?.mapData);

  let resolvedMetadata = metadata;
  if (
    !isDoorMetadata(resolvedMetadata) &&
    Number.isFinite(Number(resolvedItemId))
  ) {
    const metadataById = worldState?.assets?.mapData?.[String(resolvedItemId)];
    if (metadataById) {
      resolvedMetadata = { ...metadataById, id: Number(resolvedItemId) };
    }
  }

  if (!isDoorMetadata(resolvedMetadata)) {
    const inferredDoorMetadata = inferDoorMetadataFromTile(
      tileData,
      resolvedItemId,
      worldState?.assets?.mapData,
      resolvedMetadata,
    );
    if (inferredDoorMetadata) {
      resolvedMetadata = inferredDoorMetadata;
    }
  }

  if (isDoorMetadata(resolvedMetadata)) {
    const enrichedDoorMetadata = enrichDoorMetadata(
      resolvedMetadata,
      worldState?.assets?.mapData,
    );
    executeDoor(targetTile, enrichedDoorMetadata, worldState, onPlayerAction);
    return;
  }

  logger.debug("[Use]", resolvedMetadata?.name || metadata?.name || targetTile);

  if (onPlayerAction) {
    onPlayerAction({
      type: "use",
      target: targetTile,
      itemId:
        resolvedMetadata?.id ??
        metadata?.id ??
        (Number.isFinite(Number(resolvedItemId))
          ? Number(resolvedItemId)
          : undefined),
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
  const mapData = worldState?.assets?.mapData;
  let door = metadata?.door;
  const transformOnUse = Number(metadata?.transformOnUse);

  const { x, y, z } = targetTile;
  const tileKey = `${x},${y},${z}`;
  const tile = worldState?.map?.[tileKey];
  if (!tile) return;

  const currentId = resolveDoorCurrentId(tile, metadata, worldState);
  if (!Number.isFinite(currentId)) {
    logger.warn("[Door] Nao foi possivel resolver ID atual da porta", {
      tileKey,
      metadataName: metadata?.name,
    });
    return;
  }

  if (!door) {
    door = inferDoorPairByName(currentId, mapData, metadata);
  }

  let isOpen = false;
  let nextId = null;

  if (
    Number.isFinite(Number(door?.openId)) &&
    Number.isFinite(Number(door?.closedId))
  ) {
    const openId = Number(door.openId);
    const closedId = Number(door.closedId);
    isOpen = currentId === openId;
    nextId = isOpen ? closedId : openId;
  } else if (Number.isFinite(transformOnUse)) {
    nextId = transformOnUse;
  }

  if (!Number.isFinite(nextId)) {
    logger.warn("[Door] Porta sem open/close IDs ou transformOnUse", {
      tileKey,
      currentId,
      metadataName: metadata?.name,
    });
    return;
  }

  // Fallback solicitado: se ID de transformação não existir no metadata (Firebase),
  // não aplica alteração e apenas informa no console.
  const nextMeta = mapData?.[String(nextId)] ?? null;
  if (!nextMeta) {
    logger.info(
      `[Door] ID de transformação ${nextId} não encontrado no mapData (Firebase). Nenhuma alteração aplicada.`,
      {
        tileKey,
        currentId,
        nextId,
        metadataName: metadata?.name,
      },
    );
    return;
  }

  logger.debug(
    `[Door] ${isOpen ? "Fechando" : "Abrindo"} porta ${currentId} → ${nextId} em ${tileKey}`,
  );

  // Troca o item no tile localmente (todos os layers)
  const layerKeys = Object.keys(tile).filter((k) => !isNaN(Number(k)));
  for (const layerKey of layerKeys) {
    const layer = tile[layerKey];
    if (!Array.isArray(layer)) continue;
    for (let i = 0; i < layer.length; i++) {
      const item = layer[i];
      if (typeof item === "object" && item !== null) {
        const itemId = Number(readItemId(item));
        if (itemId === currentId) {
          item.id = nextId;
        }
      } else if (Number(item) === currentId) {
        layer[i] = nextId;
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
          typeof item === "object"
            ? Number(readItemId(item)) === currentId
              ? { ...item, id: nextId }
              : item
            : Number(item) === currentId
              ? nextId
              : item,
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
  if (!isAdjacentToPlayer(player, targetTile)) {
    logger.info("[Open] Bloqueado: alvo fora de alcance (somente adjacente)", {
      player: { x: player?.x, y: player?.y, z: player?.z },
      target: targetTile,
      itemName: metadata?.name,
    });
    return;
  }

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
 * Executa ONUSE de item (clique direito).
 * Prioriza ActionSystem (itemAction/positionAction) e cai para USE padrao.
 */
function executeItemOnUse(
  player,
  targetTile,
  tileData,
  metadata,
  actionSystem,
  pathFinder,
  onPlayerMove,
  onPlayerAction,
  worldState,
) {
  if (!actionSystem) return;

  // Regra de alcance do onUse no mapa:
  // - permitido apenas para itens adjacentes ao SQM do player
  // - uso de itens do inventário é tratado por InventoryUI/actionProcessor (sem este limite)
  if (!isAdjacentToPlayer(player, targetTile)) {
    logger.info("[OnUse] Bloqueado: alvo fora de alcance (somente adjacente)", {
      player: { x: player?.x, y: player?.y, z: player?.z },
      target: targetTile,
    });
    return;
  }

  const targetItemId =
    getTopItemId(tileData, worldState.assets?.mapData) ?? metadata?.id;

  const baseTargetMetadata =
    (targetItemId != null
      ? worldState.assets?.mapData?.[String(targetItemId)]
      : null) ?? metadata;

  const targetMetadata = baseTargetMetadata
    ? {
        ...baseTargetMetadata,
        id:
          targetItemId ??
          baseTargetMetadata.id ??
          readItemId(baseTargetMetadata),
      }
    : null;

  if (!targetItemId) {
    if (targetMetadata) {
      executeUse(
        player,
        targetTile,
        targetMetadata,
        onPlayerAction,
        worldState,
      );
    }
    return;
  }

  const ctx = {
    player,
    target: {
      id: targetItemId,
      x: targetTile.x,
      y: targetTile.y,
      z: targetTile.z ?? player.z ?? 7,
    },
    metadata: targetMetadata,
    onUse: () => {
      executeUse(
        player,
        targetTile,
        targetMetadata,
        onPlayerAction,
        worldState,
      );
      return true;
    },
    onChangeFloor: (changeCtx) => {
      const newX = changeCtx?.newX ?? player.x;
      const newY = changeCtx?.newY ?? player.y;
      const newZ = changeCtx?.newZ ?? player.z;

      if (onPlayerAction) {
        onPlayerAction({
          type: "change_floor",
          fromZ: player.z,
          toZ: newZ,
          target: {
            x: targetTile.x,
            y: targetTile.y,
            z: targetTile.z ?? player.z ?? 7,
          },
          itemId: targetItemId,
          trigger: "onuse",
        });
      }

      onPlayerMove(newX, newY, newZ, player.direcao || "frente");
      return true;
    },
  };

  const success = actionSystem.executeFromTile(ctx);
  if (success) {
    logger.debug("[OnUse] Executado", {
      itemId: targetItemId,
      targetTile,
    });
    return;
  }

  if (targetMetadata) {
    executeUse(player, targetTile, targetMetadata, onPlayerAction, worldState);
  }
}

function isAdjacentToPlayer(player, targetTile) {
  if (!player || !targetTile) return false;
  const px = Math.round(Number(player.x));
  const py = Math.round(Number(player.y));
  const pz = Number(player.z ?? 7);
  const tx = Math.round(Number(targetTile.x));
  const ty = Math.round(Number(targetTile.y));
  const tz = Number(targetTile.z ?? pz);
  if (
    !Number.isFinite(px) ||
    !Number.isFinite(py) ||
    !Number.isFinite(tx) ||
    !Number.isFinite(ty)
  ) {
    return false;
  }
  if (tz !== pz) return false;
  const dx = Math.abs(px - tx);
  const dy = Math.abs(py - ty);
  return dx <= 1 && dy <= 1;
}

function isDoorMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return false;
  const lowerName = String(metadata.name ?? "").toLowerCase();
  return (
    !!metadata.door ||
    metadata.primaryType === "doors" ||
    metadata.category === "doors" ||
    metadata.game?.category_type === "door" ||
    metadata.game?.is_door === true ||
    metadata.transformOnUse != null ||
    lowerName.includes("door")
  );
}

/**
 * Garante que a metadata de porta tem o bloco door preenchido.
 * Se não tem, tenta inferir a partir do ID ou mapData.
 */
function enrichDoorMetadata(metadata, mapData) {
  if (!metadata) return metadata;

  if (metadata.door || metadata.transformOnUse != null) {
    return metadata;
  }

  const itemId = Number(metadata.id ?? metadata.itemid ?? metadata.itemId);
  if (!Number.isFinite(itemId) || !mapData) {
    return metadata;
  }

  const sourceMetadata = mapData[String(itemId)];
  if (!sourceMetadata) {
    return metadata;
  }

  if (sourceMetadata.door) {
    return {
      ...metadata,
      door: sourceMetadata.door,
    };
  }

  const inferredDoor = inferDoorPairByName(itemId, mapData, sourceMetadata);
  if (inferredDoor) {
    return {
      ...metadata,
      door: inferredDoor,
    };
  }

  return metadata;
}

function inferDoorPairByName(itemId, mapData, metadata) {
  const id = Number(itemId);
  if (!Number.isFinite(id) || !mapData) return null;

  const sourceMetadata = metadata ?? mapData[String(id)] ?? null;
  const sourceName = String(sourceMetadata?.name ?? "").toLowerCase();
  if (!sourceName.includes("door")) return null;

  const getName = (candidateId) =>
    String(mapData?.[String(candidateId)]?.name ?? "").toLowerCase();

  if (sourceName.includes("open door")) {
    const closedId = id - 1;
    const closedName = getName(closedId);
    if (closedName.includes("door")) {
      return { openId: id, closedId, state: "open" };
    }
  }

  if (sourceName.includes("closed door")) {
    const openId = id + 1;
    const openName = getName(openId);
    if (openName.includes("door")) {
      return { openId, closedId: id, state: "closed" };
    }
  }

  if (sourceName.includes("locked door")) {
    const closedId = id + 1;
    const openId = id + 2;
    const closedName = getName(closedId);
    const openName = getName(openId);
    if (closedName.includes("door") && openName.includes("door")) {
      return {
        openId,
        closedId,
        lockedId: id,
        requiresKey: true,
        uidRequired: true,
        state: "locked",
      };
    }
  }

  return null;
}

function inferDoorMetadataFromTile(
  tileData,
  preferredId,
  mapData,
  fallbackMetadata,
) {
  const ids = [];

  if (Number.isFinite(Number(preferredId))) {
    ids.push(Number(preferredId));
  }

  const pushId = (raw) => {
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    if (!ids.includes(id)) ids.push(id);
  };

  if (Array.isArray(tileData)) {
    for (const item of tileData) {
      pushId(typeof item === "object" ? readItemId(item) : item);
    }
  } else if (tileData && typeof tileData === "object") {
    const layerKeys = Object.keys(tileData)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    for (const layerKey of layerKeys) {
      const layer = tileData[String(layerKey)];
      if (!Array.isArray(layer)) continue;
      for (const item of layer) {
        pushId(typeof item === "object" ? readItemId(item) : item);
      }
    }
  }

  for (const id of ids) {
    const metadata = mapData?.[String(id)];
    if (!metadata) continue;

    if (isDoorMetadata(metadata)) {
      if (metadata.door || metadata.transformOnUse != null) {
        return { ...metadata, id };
      }

      const inferredDoor = inferDoorPairByName(id, mapData, metadata);
      if (inferredDoor) {
        return { ...metadata, id, door: inferredDoor };
      }

      return { ...metadata, id };
    }

    const inferredDoor = inferDoorPairByName(id, mapData, metadata);
    if (inferredDoor) {
      return { ...metadata, id, door: inferredDoor };
    }
  }

  const fallbackId = Number(
    fallbackMetadata?.id ??
      fallbackMetadata?.itemid ??
      fallbackMetadata?.itemId,
  );
  if (Number.isFinite(fallbackId)) {
    const inferredDoor = inferDoorPairByName(
      fallbackId,
      mapData,
      fallbackMetadata,
    );
    if (inferredDoor) {
      return { ...fallbackMetadata, id: fallbackId, door: inferredDoor };
    }
  }

  return null;
}

function resolveDoorCurrentId(tile, metadata, worldState) {
  const door = metadata?.door;

  if (
    Number.isFinite(Number(door?.openId)) &&
    Number.isFinite(Number(door?.closedId))
  ) {
    const openId = Number(door.openId);
    const closedId = Number(door.closedId);

    const idFromPair = findItemIdInTile(
      tile,
      (id) => id === openId || id === closedId,
    );
    if (Number.isFinite(idFromPair)) return idFromPair;
  }

  const metadataId = Number(metadata?.id);
  if (Number.isFinite(metadataId)) {
    const idFromMetadata = findItemIdInTile(tile, (id) => id === metadataId);
    if (Number.isFinite(idFromMetadata)) return idFromMetadata;
  }

  return getTopItemId(tile, worldState?.assets?.mapData);
}

function findItemIdInTile(tileData, predicate) {
  if (!tileData || typeof predicate !== "function") return null;

  let items;
  if (Array.isArray(tileData)) {
    items = tileData;
  } else if (Array.isArray(tileData.items)) {
    items = tileData.items;
  } else {
    items = [];
    const layerKeys = Object.keys(tileData)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    for (const k of layerKeys) {
      const layer = tileData[String(k)];
      if (Array.isArray(layer)) items.push(...layer);
    }
  }

  for (const item of items) {
    const itemId = Number(typeof item === "object" ? readItemId(item) : item);
    if (!Number.isFinite(itemId)) continue;
    if (predicate(itemId)) return itemId;
  }

  return null;
}

function getTopItemId(tileData, mapData) {
  if (!tileData || !mapData) return null;

  let items;
  if (Array.isArray(tileData)) {
    items = tileData;
  } else if (Array.isArray(tileData.items)) {
    items = tileData.items;
  } else {
    items = [];
    const layerKeys = Object.keys(tileData)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    for (const k of layerKeys) {
      const layer = tileData[String(k)];
      if (Array.isArray(layer)) items.push(...layer);
    }
  }

  for (const item of items) {
    const itemId = typeof item === "object" ? readItemId(item) : item;
    if (!Number.isFinite(Number(itemId))) continue;
    const itemMetadata = mapData[String(itemId)];
    if (
      itemMetadata &&
      itemMetadata.game?.layer !== 0 &&
      itemMetadata.game?.movement_cost == null
    ) {
      return itemId;
    }
  }

  if (items.length > 0) {
    const first = items[0];
    return typeof first === "object" ? readItemId(first) : first;
  }

  return null;
}

function readItemId(item) {
  if (!item || typeof item !== "object") return item;
  if (item.id != null) return item.id;
  if (item.itemid != null) return item.itemid;
  if (item.itemId != null) return item.itemId;
  if (item.tileId != null) return item.tileId;
  if (item.spriteId != null) return item.spriteId;
  return undefined;
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
  const raw = metadata.flags_raw || {};
  // ✅ Novo: flags planos em game; Fallback: flags_raw (legado protobuf)
  const bank = game.bank ?? raw.bank;
  const clip = game.clip ?? raw.clip;
  const bottom = game.bottom ?? raw.bottom;

  // Verifica default_action
  const defaultActionRaw = game.default_action ?? raw.defaultAction;
  const defaultAction =
    typeof defaultActionRaw === "object"
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

  if (metadata.floorChange || game.category_type === "floor_change") {
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
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a); // descending: camada 2 antes da 0
    for (const k of layerKeys) {
      const layer = tileData[String(k)];
      if (Array.isArray(layer)) items.push(...layer);
    }
  }

  // Prioriza primeiro item que não é ground (layer 0)
  for (const item of items) {
    const spriteId = typeof item === "object" ? readItemId(item) : item;
    if (!Number.isFinite(Number(spriteId))) continue;
    const metadata = nexoData[String(spriteId)];
    if (
      metadata &&
      metadata.game?.layer !== 0 &&
      metadata.game?.movement_cost == null
    ) {
      return { ...metadata, id: Number(spriteId) };
    }
  }

  // Fallback: primeiro item encontrado
  if (items.length > 0) {
    const first = items[0];
    const spriteId = typeof first === "object" ? readItemId(first) : first;
    const fallbackMeta = nexoData[String(spriteId)];
    return fallbackMeta ? { ...fallbackMeta, id: Number(spriteId) } : null;
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
  if (canvas?._rpgContextMenuHandler) {
    canvas.removeEventListener("contextmenu", canvas._rpgContextMenuHandler);
    canvas._rpgContextMenuHandler = null;
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
    canvas.removeEventListener(
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
