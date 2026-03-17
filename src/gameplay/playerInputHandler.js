// ═══════════════════════════════════════════════════════════════
// playerInputHandler.js — Handler de input do jogador com actions
// Integra mouse/keyboard com ActionSystem e PathFinder
// ═══════════════════════════════════════════════════════════════

import {
  PlayerAction,
  getActionCursor,
  actionRequiresTarget,
} from "../core/playerAction.js";
import { getActionSystem } from "../core/actionSystem.js";
import {
  PathFinder,
  DIRECTIONS,
  directionsToBytes,
} from "../core/pathfinding.js";
import { TILE_SIZE } from "../core/config.js";

/**
 * @typedef {Object} InputHandlerOptions
 * @property {HTMLCanvasElement} canvas
 * @property {Object} camera - { x, y }
 * @property {Object} worldState - Estado do mundo
 * @property {Function} onPlayerMove - Callback quando player move
 * @property {Function} onPlayerAction - Callback quando player executa ação
 * @property {Function} showLookMessage - Callback para mostrar mensagem de look
 */

/**
 * Handler de input para interação do jogador com o mundo
 */
export class PlayerInputHandler {
  constructor(options) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.worldState = options.worldState;
    this.onPlayerMove = options.onPlayerMove || (() => {});
    this.onPlayerAction = options.onPlayerAction || (() => {});
    this.showLookMessage = options.showLookMessage || (() => {});

    this.actionSystem = getActionSystem();
    this.pathFinder = null;

    this.currentAction = PlayerAction.NONE;
    this.hoverTile = null;
    this.selectedTarget = null;

    this.setupEventListeners();
    this.updatePathFinder();
  }

  /**
   * Atualiza PathFinder com dados do mapa
   */
  updatePathFinder() {
    const map = this.worldState?.map;
    const nexoData = this.worldState?.assets?.mapData;

    if (!map) return;

    this.pathFinder = new PathFinder({
      allowDiagonal: true,
      diagonalCost: 1.414,

      isWalkable: (x, y, z) => {
        const tileKey = `${x},${y},${z}`;
        const tile = map[tileKey];

        if (!tile) return false;

        // Verifica se tile é walkable
        // Tile pode ser array de items ou objeto com layers
        const items = Array.isArray(tile) ? tile : tile.items || [];

        for (const item of items) {
          const spriteId = typeof item === "object" ? item.id : item;
          const metadata = nexoData?.[String(spriteId)];

          if (!metadata) continue;

          // Verifica flags de walkability
          const flags = metadata.flags_raw || {};
          const game = metadata.game || {};

          // Não walkable: unpass, blocks_movement, wall, etc
          if (flags.unpass || flags.unmove) return false;
          if (game.is_walkable === false) return false;
          if (game.blocks_movement) return false;

          // Categoria que bloqueiam
          const category = String(game.category_type || "").toLowerCase();
          if (["wall", "obstacle", "blocking"].includes(category)) return false;
        }

        return true;
      },
    });
  }

  /**
   * Setup de event listeners
   */
  setupEventListeners() {
    // Mouse move
    this.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));

    // Mouse leave
    this.canvas.addEventListener("mouseleave", () => {
      this.hoverTile = null;
      this.updateCursor();
    });

    // Mouse click
    this.canvas.addEventListener("mousedown", (e) => this.handleMouseDown(e));

    // Mouse dblclick (look)
    this.canvas.addEventListener("dblclick", (e) => this.handleDoubleClick(e));

    // Context menu (right click)
    this.canvas.addEventListener("contextmenu", (e) =>
      this.handleContextMenu(e),
    );

    // Keyboard
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));
  }

  /**
   * Converte posição do mouse em posição do tile
   */
  screenToTile(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    const canvasX = (screenX - rect.left) * scaleX;
    const canvasY = (screenY - rect.top) * scaleY;

    const tileX = Math.floor(canvasX / TILE_SIZE + this.camera.x);
    const tileY = Math.floor(canvasY / TILE_SIZE + this.camera.y);

    return { x: tileX, y: tileY, z: this.worldState?.activeZ || 7 };
  }

  /**
   * Handle mouse move
   */
  handleMouseMove(e) {
    const tile = this.screenToTile(e.clientX, e.clientY);
    this.hoverTile = tile;

    // Atualiza cursor baseado na ação possível
    this.updateCursor();

    // Highlight tile (opcional, para debug)
    if (window.DEBUG_HOVER) {
      console.log(`Hover: ${tile.x}, ${tile.y}, ${tile.z}`);
    }
  }

  /**
   * Handle mouse down
   */
  handleMouseDown(e) {
    if (!this.hoverTile) return;

    const player = this.worldState?.player;
    if (!player) return;

    const tile = this.hoverTile;
    const metadata = this.getTileMetadata(tile);

    // Botão esquerdo
    if (e.button === 0) {
      this.handleLeftClick(player, tile, metadata);
    }
    // Botão do meio (wheel)
    else if (e.button === 1) {
      this.handleMiddleClick(player, tile, metadata);
    }
  }

  /**
   * Handle left click (ação principal)
   */
  handleLeftClick(player, tile, metadata) {
    // Determina ação baseada no metadata ou contexto
    const action = this.determineAction(player, tile, metadata);

    if (action === PlayerAction.AUTOWALK_HIGHLIGHT) {
      this.executeAutowalkHighlight(player, tile, metadata);
    } else if (actionRequiresTarget(action)) {
      // Seleciona target
      this.selectedTarget = tile;
      this.executeAction(action, player, tile, metadata);
    } else {
      this.executeAction(action, player, tile, metadata);
    }
  }

  /**
   * Handle middle click (look)
   */
  handleMiddleClick(player, tile, metadata) {
    this.executeAction(PlayerAction.LOOK, player, tile, metadata);
  }

  /**
   * Handle double click (look detalhado)
   */
  handleDoubleClick(e) {
    if (!this.hoverTile) return;

    const player = this.worldState?.player;
    const tile = this.hoverTile;
    const metadata = this.getTileMetadata(tile);

    this.executeAction(PlayerAction.LOOK, player, tile, metadata);
  }

  /**
   * Handle right click (context menu)
   */
  handleContextMenu(e) {
    e.preventDefault();

    if (!this.hoverTile) return;

    const player = this.worldState?.player;
    const tile = this.hoverTile;
    const metadata = this.getTileMetadata(tile);

    // Abre menu de contexto com ações disponíveis
    this.showContextMenu(player, tile, metadata);
  }

  /**
   * Handle keyboard
   */
  handleKeyDown(e) {
    // Atalhos de teclado
    switch (e.key.toLowerCase()) {
      case "l":
        // Look no tile selecionado
        if (this.selectedTarget) {
          const player = this.worldState?.player;
          const metadata = this.getTileMetadata(this.selectedTarget);
          this.executeAction(
            PlayerAction.LOOK,
            player,
            this.selectedTarget,
            metadata,
          );
        }
        break;

      case "u":
        // Use no tile selecionado
        if (this.selectedTarget) {
          const player = this.worldState?.player;
          const metadata = this.getTileMetadata(this.selectedTarget);
          this.executeAction(
            PlayerAction.USE,
            player,
            this.selectedTarget,
            metadata,
          );
        }
        break;

      case "a":
        // Attack
        if (this.selectedTarget) {
          const player = this.worldState?.player;
          this.executeAction(PlayerAction.ATTACK, player, this.selectedTarget);
        }
        break;

      case "t":
        // Talk
        if (this.selectedTarget) {
          const player = this.worldState?.player;
          const metadata = this.getTileMetadata(this.selectedTarget);
          this.executeAction(
            PlayerAction.TALK,
            player,
            this.selectedTarget,
            metadata,
          );
        }
        break;

      case "escape":
        // Deselect
        this.selectedTarget = null;
        break;
    }
  }

  /**
   * Determina ação baseada no contexto
   */
  determineAction(player, tile, metadata) {
    // 1. Verifica ação específica da posição
    const posKey = `${tile.x},${tile.y},${tile.z}`;
    if (this.actionSystem.positionActions.has(posKey)) {
      // Ação customizada registrada
      const handler = this.actionSystem.positionActions.get(posKey);
      // Retorna ação baseada no handler
      return PlayerAction.USE;
    }

    // 2. Verifica ação específica do item
    if (tile.id && this.actionSystem.itemActions.has(tile.id)) {
      return PlayerAction.USE;
    }

    // 3. Usa defaultAction do metadata (pode ser número ou objeto)
    if (metadata) {
      const defaultActionRaw =
        metadata.game?.default_action || metadata.flags_raw?.defaultAction;

      // Converte para valor numérico se for objeto { action: 4 }
      const defaultAction =
        typeof defaultActionRaw === "object"
          ? defaultActionRaw?.action
          : defaultActionRaw;

      if (defaultAction != null) {
        // Valores oficiais OTClient: 0=NONE, 1=LOOK, 2=USE, 3=OPEN, 4=AUTOWALK_HIGHLIGHT
        if (typeof defaultAction === "number") {
          return defaultAction;
        }
        // String para ações estendidas
        return defaultAction;
      }

      // Inferência baseada em flags
      const flags = metadata.flags_raw || {};
      const game = metadata.game || {};

      if (flags.bank || game.render_layer === 0) {
        // Ground - autowalk (4)
        return PlayerAction.AUTOWALK_HIGHLIGHT;
      }

      if (flags.clip) {
        // Ground border - autowalk (4)
        return PlayerAction.AUTOWALK_HIGHLIGHT;
      }

      if (flags.container) {
        return PlayerAction.OPEN; // 3
      }

      if (flags.door) {
        return PlayerAction.OPEN; // 3
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

      if (game.is_stackable || game.is_pickupable) {
        return PlayerAction.PICKUP;
      }
    }

    // 4. Default: autowalk para tiles vazios, look para items
    return PlayerAction.AUTOWALK_HIGHLIGHT;
  }

  /**
   * Executa AUTOWALK_HIGHLIGHT
   */
  executeAutowalkHighlight(player, tile, metadata) {
    if (!this.pathFinder) {
      console.warn("[InputHandler] PathFinder não inicializado");
      return;
    }

    // Encontra caminho até tile adjacente
    const playerPos = { x: player.x, y: player.y, z: player.z };
    const targetPos = { x: tile.x, y: tile.y, z: tile.z };

    const result = this.pathFinder.findPathToAdjacent(playerPos, targetPos);

    if (!result) {
      console.warn("[InputHandler] Sem caminho até", tile);
      return;
    }

    // Converte direções para bytes
    const directions = directionsToBytes(result.directions);

    // Envia/comanda movimento
    if (this.onPlayerMove) {
      this.onPlayerMove({
        type: "autowalk",
        directions,
        path: result.path,
        target: tile,
        action: metadata?.game?.default_action,
      });
    }

    console.log(
      `[Autowalk] ${directions.length} passos até (${tile.x}, ${tile.y})`,
    );
  }

  /**
   * Executa ação genérica
   */
  executeAction(action, player, tile, metadata) {
    const context = {
      player: { x: player.x, y: player.y, z: player.z },
      target: { id: tile.id, x: tile.x, y: tile.y, z: tile.z },
      metadata,
      showLookMessage: this.showLookMessage,
      onUse: (ctx) => this.onPlayerAction({ ...ctx, action: "use" }),
      onAttack: (ctx) => this.onPlayerAction({ ...ctx, action: "attack" }),
      onTalk: (ctx) => this.onPlayerAction({ ...ctx, action: "talk" }),
      openContainerUI: (id, x, y, z) =>
        this.onPlayerAction({ type: "open_container", id, x, y, z }),
      openChatUI: (id, name) => this.onPlayerAction({ type: "chat", id, name }),
      teleportTo: metadata?.game?.teleport_to || null,
      onChangeFloor: (ctx) =>
        this.onPlayerAction({ ...ctx, type: "change_floor" }),
    };

    const success = this.actionSystem.executeFromTile(context);

    if (success && this.onPlayerAction) {
      this.onPlayerAction({
        type: "action",
        action,
        target: tile,
        metadata,
      });
    }

    return success;
  }

  /**
   * Mostra menu de contexto
   */
  showContextMenu(player, tile, metadata) {
    // TODO: Implementar menu de contexto UI
    const actions = [
      { label: "Look", action: PlayerAction.LOOK },
      { label: "Use", action: PlayerAction.USE },
      { label: "Attack", action: PlayerAction.ATTACK },
      { label: "Talk", action: PlayerAction.TALK },
    ];

    console.log("[ContextMenu]", actions);
  }

  /**
   * Atualiza cursor baseado na ação
   */
  updateCursor() {
    if (!this.hoverTile) {
      this.canvas.style.cursor = "default";
      return;
    }

    const player = this.worldState?.player;
    if (!player) return;

    const metadata = this.getTileMetadata(this.hoverTile);
    const action = this.determineAction(player, this.hoverTile, metadata);
    const cursor = getActionCursor(action);

    this.canvas.style.cursor = cursor;
    this.currentAction = action;
  }

  /**
   * Pega metadata do tile
   */
  getTileMetadata(tile) {
    if (!tile?.id) return null;

    const nexoData = this.worldState?.assets?.mapData;
    return nexoData?.[String(tile.id)] || null;
  }

  /**
   * Set action manual (para spells, etc)
   */
  setManualAction(action) {
    this.currentAction = action;
    this.updateCursor();
  }

  /**
   * Cleanup
   */
  destroy() {
    this.canvas.removeEventListener("mousemove", () => {});
    this.canvas.removeEventListener("mouseleave", () => {});
    this.canvas.removeEventListener("mousedown", () => {});
    this.canvas.removeEventListener("dblclick", () => {});
    this.canvas.removeEventListener("contextmenu", () => {});
  }
}

/**
 * Cria handler de input
 * @param {InputHandlerOptions} options
 * @returns {PlayerInputHandler}
 */
export function createPlayerInputHandler(options) {
  return new PlayerInputHandler(options);
}
