// ═══════════════════════════════════════════════════════════════
// initializer.js — Orquestração da inicialização
// ═══════════════════════════════════════════════════════════════
import { NEW_ASSETS } from "../../../core/config.js";
import { RuntimeConfig } from "../../../core/runtimeConfig.js";
import { worldEvents, EVENT_TYPES } from "../../../core/events.js";
import { WorldTick } from "../engine/worldTick.js";
import { TransientGC } from "../engine/transientGC.js";
import { WakeLockService } from "../services/wakeLock.js";
import { FirebaseSync } from "../services/firebaseSync.js";
import { MouseHandler } from "../input/mouseHandler.js";
import { KeyboardHandler } from "../input/keyboardHandler.js";
import { ZoomHandler } from "../input/zoomHandler.js";
import { FloorHUD } from "../ui/floorHUD.js";
import { WorldStateHUD } from "../ui/worldStateHUD.js";
import { Tooltip } from "../ui/tooltip.js";
import { HUDRenderer } from "../rendering/hudRenderer.js";
import { MetricsHUD } from "../ui/metricsHUD.js";
import { createProgressionUI } from "../../shared/ui/ProgressionUI.js";
import {
  buildDropPreviewMessage,
  DRAG_PREVIEW_TEXT,
} from "../../shared/ui/dragPreviewMessages.js";
import { DragDropManager } from "../../shared/input/DragDropManager.js";
import { InventoryUI } from "../../shared/ui/InventoryUI.js";
import {
  dbWatch,
  dbSet,
  dbGet,
  watchPlayerData,
  PATHS,
} from "../../../core/db.js";
import { initItemDataService } from "../../../gameplay/items/ItemDataService.js";
import { renderWorld } from "../../../render/worldRenderer.js";
import { buildFloorIndex } from "../../../render/mapRenderer.js";
import { getMonsters, getPlayers } from "../../../core/worldStore.js";
import { applyCameraMovement } from "../../../gameplay/inputController.js";
import { TILE_SIZE } from "../../../core/config.js";
import { createAnimationClock } from "../../../core/animationClock.js";

export class Initializer {
  constructor({ logger, canvas, canvasSetup, worldState, config }) {
    this.logger = logger;
    this.canvas = canvas;
    this.canvasSetup = canvasSetup;
    this.worldState = worldState;
    this.config = config;

    // Serviços
    this.worldTick = null;
    this.transientGC = null;
    this.wakeLock = null;
    this.firebaseSync = null;

    // Input
    this.mouseHandler = null;
    this.keyboardHandler = null;
    this.zoomHandler = null;

    // UI
    this.floorHUD = null;
    this.worldStateHUD = null;
    this.metricsHUD = null;
    this.tooltip = null;
    this.hudRenderer = null;
    this.progressionUI = null;
    this.dragDropManager = null;
    this.inventoryUI = null;

    // Loop
    this.gameLoop = null;
    this._rafId = null;

    // Worker sync — armazena unsubscribers para limpeza posterior
    this._workerUnsubscribers = [];
    this._inventoryUnsubscribers = [];
  }

  _clearInventorySubscriptions() {
    for (const unsub of this._inventoryUnsubscribers) unsub?.();
    this._inventoryUnsubscribers = [];
  }

  async init() {
    // 0. Conectar RuntimeConfig ao Firebase (hot reload de parâmetros operacionais)
    RuntimeConfig.init(dbWatch, dbGet);
    await RuntimeConfig.seed(dbGet, dbSet);

    // 1. Carregar mapa e assets
    await this.loadMapAssets();

    // 2. Inicializar serviços
    this.initServices();

    // 3. Inicializar input
    this.initInput();

    // 4. Inicializar UI
    this.initUI();

    // 5. Inicializar loop de rendering (rAF)
    // Nota: WorldTick já processa a IA e atualiza o Firebase.
    // O worker bridge é redundante aqui e causaria double-update no worldStore.
    this.initGameLoop();

    // 6. Marcar como ready
    this.worldState.ready = true;

    // 7. Iniciar Firebase sync buttons
    this.firebaseSync?.setupButtons();

    // 8. Inicializar Progression UI (FASE 4)
    this.initProgressionUI();

    // 9. Watcher de world_items para renderização no canvas (independente de player)
    this.initWorldItemsRendering();

    // 10. Inicializar Inventário + Drag & Drop
    this.initInventoryUI();
  }

  async loadMapAssets() {
    this.logger.info("[1/4] map_compacto.json");
    const mapRes = await fetch(NEW_ASSETS.mapFile);
    if (!mapRes.ok)
      throw new Error(`HTTP ${mapRes.status} — ${NEW_ASSETS.mapFile}`);
    this.worldState.map = await mapRes.json();
    this.logger.ok(
      `Mapa carregado: ${Object.keys(this.worldState.map).length} tiles`,
    );

    this.logger.info("[2/4] tilesData (Firebase)");
    const remoteTilesData = await dbGet(PATHS.tilesData);
    if (!remoteTilesData || typeof remoteTilesData !== "object") {
      throw new Error("tilesData indisponível no Firebase");
    }
    this.worldState.mapData = remoteTilesData;
    this.logger.ok(
      `Metadata carregada: ${Object.keys(this.worldState.mapData).length} itens`,
    );

    this.logger.info("[3/4] Atlas segmentados");
    const atlasLoaded = await this.worldState.assetsMgr.loadMapAssets?.(
      NEW_ASSETS.basePath,
    );
    if (!atlasLoaded) throw new Error("Falha ao carregar atlas de mapa");
    this.logger.ok(
      `Atlas carregados: ${this.worldState.assetsMgr.mapAtlases?.length ?? 0} atlas`,
    );

    this.logger.info("Construindo floorIndex...");
    this.worldState.floorIndex = buildFloorIndex(this.worldState.map);
    this.logger.ok(`floorIndex: ${this.worldState.floorIndex.size} andares`);

    // Centralizar câmera
    const firstKey = Object.keys(this.worldState.map)[0];
    if (firstKey) {
      const [fx, fy] = firstKey.split(",").map(Number);
      const { centerCamera } = await import("../../../render/mapRenderer.js");
      this.worldState.camera = centerCamera(
        { x: fx, y: fy },
        this.canvasSetup.cols,
        this.canvasSetup.rows,
      );
      this.logger.ok(
        `Câmera centralizada: ${this.worldState.camera.x},${this.worldState.camera.y}`,
      );
    }

    // Atualizar HUD
    document.getElementById("hud-tiles").innerText = Object.keys(
      this.worldState.map,
    ).length;

    // 4/4. Carregar sprites legados (outfits/monstros)
    this.logger.info("[4/4] sprites...");
    const { loadAllSprites } = await import("../../../render/assetLoader.js");
    const totalPacks = await loadAllSprites(this.worldState.assetsMgr);
    this.logger.ok(`${totalPacks} packs carregados`);
  }

  /**
   * Escuta world_items no Firebase e injeta na layer 99 do mapa para renderização.
   * Roda SEMPRE, independente de currentPlayerId ou InventoryUI ativo.
   * Separa responsabilidade de renderização do drag-drop cache (initInventoryUI).
   */
  initWorldItemsRendering() {
    const ws = this.worldState;
    const LAYER = "99";

    const clearLayer = () => {
      for (const coord of Object.keys(ws.map ?? {})) {
        if (ws.map[coord]?.[LAYER]) {
          delete ws.map[coord][LAYER];
          if (Object.keys(ws.map[coord]).length === 0) delete ws.map[coord];
        }
      }
    };

    const unsubWorldItems = dbWatch("world_items", (items) => {
      clearLayer();
      let dirty = false;

      if (items && typeof items === "object") {
        for (const [itemId, item] of Object.entries(items)) {
          if (!item) continue;
          const tileId = Number(item.tileId ?? item.id);
          const x = Number(item.x);
          const y = Number(item.y);
          const z = Number(item.z ?? 7);
          if (
            !Number.isFinite(tileId) ||
            tileId <= 0 ||
            !Number.isFinite(x) ||
            !Number.isFinite(y)
          )
            continue;

          const coord = `${x},${y},${z}`;
          if (
            !ws.map[coord] ||
            typeof ws.map[coord] !== "object" ||
            Array.isArray(ws.map[coord])
          ) {
            ws.map[coord] = {};
          }
          if (!Array.isArray(ws.map[coord][LAYER])) ws.map[coord][LAYER] = [];
          ws.map[coord][LAYER].push({
            id: tileId,
            count: Number(item.quantity ?? item.count ?? 1),
            __worldItemId: itemId,
          });
          dirty = true;
        }
      }

      ws.floorIndex = buildFloorIndex(ws.map ?? {});
    });

    if (typeof unsubWorldItems === "function") {
      this._workerUnsubscribers.push(unsubWorldItems);
    }
  }

  initServices() {
    const { WORLDENGINE } = this.config;

    // World Tick
    this.worldTick = new WorldTick(
      this.worldState,
      WORLDENGINE.worldTickMs,
      this.logger,
    );
    this.worldTick.start();

    // Transient GC
    this.transientGC = new TransientGC(this.worldState, this.logger);
    this.transientGC.start();

    // Wake Lock
    this.wakeLock = new WakeLockService(this.logger);
    this.wakeLock.init();

    // Firebase Sync
    this.firebaseSync = new FirebaseSync(
      this.worldState,
      this.logger,
      NEW_ASSETS,
    );

    this.firebaseSync
      .syncModelsAndSchemasFromLocal()
      .then(() => {
        this.logger.ok("Schemas/modelos locais sincronizados no Firebase.");
      })
      .catch((e) => {
        this.logger.warn(
          `Falha ao sincronizar schemas/modelos no boot: ${e?.message ?? e}`,
        );
      });
  }

  initInput() {
    const { WORLDENGINE, FLOORRANGE } = this.config;

    this.mouseHandler = new MouseHandler(
      this.canvas,
      this.worldState,
      this.config,
    );
    this.keyboardHandler = new KeyboardHandler(
      this.worldState,
      FLOORRANGE,
      this.logger,
      () => this.floorHUD?.update(),
    );
    this.zoomHandler = new ZoomHandler(this.canvas, this.worldState);
  }

  initUI() {
    this.floorHUD = new FloorHUD(this.worldState, this.config.FLOORRANGE);
    this.worldStateHUD = new WorldStateHUD();
    this.metricsHUD = new MetricsHUD("metrics-panel");
    this.tooltip = new Tooltip(this.canvas, this.worldState, this.config);
    this.hudRenderer = new HUDRenderer(this.worldState);

    this.floorHUD.update();
    this.worldStateHUD.init();
    this.metricsHUD.init();
  }

  /**
   * Loop de rendering leve via requestAnimationFrame.
   * Apenas atualiza HUDs de estado (tick count, GC, wake lock).
   * A lógica de jogo roda no WorldTick (main thread) e no worker.
   */
  initGameLoop() {
    const canvas = this.canvas;
    const ctx = canvas.getContext("2d");
    const ws = this.worldState;
    const cs = this.canvasSetup;
    const animationClock = createAnimationClock({ maxDeltaMs: 80 });
    const FIXED_STEP_MS = 1000 / 60;
    const MAX_CATCHUP_STEPS = 4;

    let accumulatorMs = 0;

    const tick = (ts) => {
      const frameTime = animationClock.tick(ts);
      accumulatorMs = Math.min(
        accumulatorMs + frameTime.delta,
        FIXED_STEP_MS * MAX_CATCHUP_STEPS,
      );

      this.hudRenderer.update();

      if (ws.isReady()) {
        let catchupSteps = 0;
        while (
          accumulatorMs >= FIXED_STEP_MS &&
          catchupSteps < MAX_CATCHUP_STEPS
        ) {
          applyCameraMovement(ws.camera, 1.0);
          accumulatorMs -= FIXED_STEP_MS;
          catchupSteps += 1;
        }

        renderWorld({
          ctx,
          camX: ws.camera.x * TILE_SIZE,
          camY: ws.camera.y * TILE_SIZE,
          activeZ: ws.activeZ,
          animClock: animationClock.now,
          ts,
          canvasW: cs.canvasW,
          canvasH: cs.canvasH,
          cols: cs.cols,
          rows: cs.rows,
          map: ws.map,
          assets: ws.assetsMgr,
          anim: ws.anim,
          floorIndex: ws.floorIndex,
          extraEntities: { ...getMonsters(), ...getPlayers() },
          renderOptions: {
            showHP: true,
            showName: true,
            renderMode: "high",
            viewMode: "gm",
            entitiesOnTop: true,
            mapTallBeforeEntities: false,
            upperFloorsBeforeEntities: true,
            topDecorBeforeEntities: false,
          },
        });
      }

      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
    this.logger.ok("[GameLoop] Loop de rendering iniciado (rAF).");
  }

  initProgressionUI() {
    // =========================================================================
    // PROGRESSION UI (FASE 4) — Bootstrap
    // =========================================================================

    try {
      // Criar instância de ProgressionUI com elementos do DOM
      this.progressionUI = createProgressionUI({
        xpBarElement: document.getElementById("xp-bar-fill"),
        xpTextElement: document.getElementById("xp-text"),
        levelElement: document.getElementById("player-level"),
        statPointsElement: document.getElementById("stat-points-available"),
        levelUpModal: document.getElementById("level-up-modal"),
        statButtons: {
          FOR: document.getElementById("btn-alloc-for"),
          INT: document.getElementById("btn-alloc-int"),
          AGI: document.getElementById("btn-alloc-agi"),
          VIT: document.getElementById("btn-alloc-vit"),
        },
        statValues: {
          FOR: document.getElementById("stat-val-for"),
          INT: document.getElementById("stat-val-int"),
          AGI: document.getElementById("stat-val-agi"),
          VIT: document.getElementById("stat-val-vit"),
        },
      });

      // Definir player ID atual (ajustar conforme sua lógica de auth)
      if (window.currentPlayerId) {
        this.progressionUI.setCurrentPlayerId(window.currentPlayerId);
      }

      // Atualizar UI quando player stats mudarem (ENTITY_UPDATE)
      worldEvents.subscribe(EVENT_TYPES.ENTITY_UPDATE, (e) => {
        if (
          e.type === "player" &&
          e.id === window.currentPlayerId &&
          e.updates?.stats
        ) {
          this.progressionUI.updatePlayerStats(e.updates.stats);
        }
      });

      this.logger.ok("✓ ProgressionUI inicializado com sucesso");
    } catch (error) {
      this.logger.warn(
        `⚠ Falha ao inicializar ProgressionUI: ${error?.message ?? error}`,
      );
    }
  }

  initInventoryUI() {
    try {
      this._clearInventorySubscriptions();

      const container = document.getElementById("inventory-ui-container");
      if (!container) {
        this.logger.warn(
          "⚠ #inventory-ui-container não encontrado — InventoryUI ignorado",
        );
        return;
      }

      const playerId = window.currentPlayerId ?? "worldengine";
      if (!window.currentPlayerId) {
        this.logger.warn(
          "⚠ window.currentPlayerId não definido — usando contexto worldengine para drag global",
        );
      }

      const ws = this.worldState;

      // ── ItemDataService: fonte de verdade para canPickUp/canMove ─────────
      const itemDataService = initItemDataService(ws.mapData ?? {});
      this.logger.ok(
        `✓ ItemDataService: ${itemDataService.getAllItemIds().length} itens indexados`,
      );

      // ── Cache local de world_items (Firebase) indexado por coordenada ──
      // Chave primária: ID Firebase  Chave secundária: "x,y,z"
      const WORLD_ITEM_LAYER = 99;
      const _worldItemsById = {};
      const _worldItemsByCoord = {};
      const _renderedWorldItems = {};
      const _removedMapSourceKeys = new Set();
      const _claimedMapSourceKeys = new Set();

      const _buildMapSourceKey = (coord, layer, tileId) =>
        `${String(coord)}|${Number(layer)}|${Number(tileId)}`;

      const _removeTileFromLayer = (coord, layerKey, predicate) => {
        const mapTile = ws.map?.[coord];
        if (!mapTile) return false;

        const tiles = mapTile?.[layerKey];
        if (!Array.isArray(tiles) || tiles.length === 0) return false;

        const idx = tiles.findIndex(predicate);
        if (idx < 0) return false;

        tiles.splice(idx, 1);
        if (tiles.length === 0) delete mapTile[layerKey];
        if (Object.keys(mapTile).length === 0) delete ws.map[coord];
        return true;
      };

      const _removeMapTileAndRefreshFloorIndex = (coord, mapLayer, tileId) => {
        const removed = _removeTileFromLayer(
          coord,
          String(mapLayer),
          (t) => Number(t?.id) === Number(tileId),
        );
        if (removed) ws.floorIndex = buildFloorIndex(ws.map ?? {});
      };

      const _applyMapClaimsSnapshot = (claims) => {
        const all = claims && typeof claims === "object" ? claims : {};
        let dirty = false;
        for (const claim of Object.values(all)) {
          if (!claim || typeof claim !== "object") continue;
          const coord = String(claim.sourceCoord ?? "");
          const layer = Number(claim.sourceLayer);
          const tileId = Number(claim.sourceTileId);
          if (!coord || !Number.isFinite(layer) || !Number.isFinite(tileId))
            continue;

          const sourceKey = _buildMapSourceKey(coord, layer, tileId);
          if (_claimedMapSourceKeys.has(sourceKey)) continue;

          _claimedMapSourceKeys.add(sourceKey);
          _removedMapSourceKeys.add(sourceKey);
          const removed = _removeTileFromLayer(
            coord,
            String(layer),
            (t) => Number(t?.id) === tileId,
          );
          dirty = removed || dirty;
        }

        if (dirty) {
          ws.floorIndex = buildFloorIndex(ws.map ?? {});
        }
      };

      const _removeRenderedWorldItem = (worldItemId) => {
        const prev = _renderedWorldItems[worldItemId];
        if (!prev) return false;
        const removed = _removeTileFromLayer(
          prev.coord,
          String(prev.layer),
          (t) => t?.__worldItemId === worldItemId,
        );
        delete _renderedWorldItems[worldItemId];
        return removed;
      };

      const _applyRenderedWorldItem = (worldItemId, item) => {
        const tileId = Number(item?.tileId ?? item?.id);
        const x = Number(item?.x);
        const y = Number(item?.y);
        const z = Number(item?.z ?? 7);
        if (
          !Number.isFinite(tileId) ||
          !Number.isFinite(x) ||
          !Number.isFinite(y)
        ) {
          return false;
        }

        const coord = `${x},${y},${z}`;
        if (
          !ws.map[coord] ||
          typeof ws.map[coord] !== "object" ||
          Array.isArray(ws.map[coord])
        ) {
          ws.map[coord] = {};
        }

        const layerKey = String(WORLD_ITEM_LAYER);
        if (!Array.isArray(ws.map[coord][layerKey]))
          ws.map[coord][layerKey] = [];

        ws.map[coord][layerKey].push({
          id: tileId,
          count: Number(item?.quantity ?? 1),
          __worldItemId: worldItemId,
        });

        _renderedWorldItems[worldItemId] = {
          coord,
          layer: WORLD_ITEM_LAYER,
          tileId,
        };

        return true;
      };

      const _clearWorldItemLayer = () => {
        const layerKey = String(WORLD_ITEM_LAYER);
        for (const coord of Object.keys(ws.map ?? {})) {
          if (ws.map[coord]?.[layerKey]) {
            delete ws.map[coord][layerKey];
            if (Object.keys(ws.map[coord]).length === 0) delete ws.map[coord];
          }
        }
        for (const k of Object.keys(_renderedWorldItems))
          delete _renderedWorldItems[k];
      };

      const _applyWorldItemsSnapshotToMap = (items) => {
        const next = items && typeof items === "object" ? items : {};
        let dirty = false;

        // Limpa toda a camada 99 do mapa antes de re-aplicar, garantindo
        // que chamadas repetidas de initInventoryUI não causem duplicatas.
        const hadRendered = Object.keys(_renderedWorldItems).length > 0;
        const hasLayer99 = Object.values(ws.map ?? {}).some(
          (cell) => cell?.[String(WORLD_ITEM_LAYER)],
        );
        if (hadRendered || hasLayer99) {
          _clearWorldItemLayer();
          dirty = true;
        }

        for (const [id, item] of Object.entries(next)) {
          if (
            item?.fromMap &&
            item?.sourceCoord != null &&
            item?.sourceLayer != null &&
            item?.sourceTileId != null
          ) {
            const sourceKey = `${item.sourceCoord}|${item.sourceLayer}|${item.sourceTileId}`;
            if (!_removedMapSourceKeys.has(sourceKey)) {
              const removedSource = _removeTileFromLayer(
                String(item.sourceCoord),
                String(item.sourceLayer),
                (t) => Number(t?.id) === Number(item.sourceTileId),
              );
              if (removedSource) {
                _removedMapSourceKeys.add(sourceKey);
                dirty = true;
              }
            }
          }

          dirty = _applyRenderedWorldItem(id, item) || dirty;
        }

        if (dirty) {
          ws.floorIndex = buildFloorIndex(ws.map ?? {});
        }
      };

      function _rebuildWorldItemsCache(items) {
        for (const k of Object.keys(_worldItemsById)) delete _worldItemsById[k];
        for (const k of Object.keys(_worldItemsByCoord))
          delete _worldItemsByCoord[k];

        _applyWorldItemsSnapshotToMap(items);

        if (items && typeof items === "object") {
          for (const [id, item] of Object.entries(items)) {
            _worldItemsById[id] = item;
            if (item.x != null && item.y != null) {
              const coord = `${item.x},${item.y},${item.z ?? 7}`;
              if (!_worldItemsByCoord[coord]) _worldItemsByCoord[coord] = [];
              _worldItemsByCoord[coord].push(item);
            }
          }
        }
      }

      // ── Adapter: posição de tela → tile do mundo ──────────────────────
      const worldRendererAdapter = {
        screenToWorld: (clientX, clientY) => {
          const rect = this.canvas.getBoundingClientRect();
          const scaleX = this.canvas.width / rect.width;
          const scaleY = this.canvas.height / rect.height;
          const px = (clientX - rect.left) * scaleX;
          const py = (clientY - rect.top) * scaleY;
          const camXWorld = (ws.camera?.x ?? 0) * TILE_SIZE;
          const camYWorld = (ws.camera?.y ?? 0) * TILE_SIZE;
          return {
            x: Math.floor((px + camXWorld) / TILE_SIZE),
            y: Math.floor((py + camYWorld) / TILE_SIZE),
            z: ws.activeZ ?? 7,
          };
        },
        // Inverso: tile do mundo → posição de tela (canto sup-esq do tile)
        worldToScreen: (tileX, tileY) => {
          const rect = this.canvas.getBoundingClientRect();
          const scaleX = this.canvas.width / rect.width;
          const scaleY = this.canvas.height / rect.height;
          const camXWorld = (ws.camera?.x ?? 0) * TILE_SIZE;
          const camYWorld = (ws.camera?.y ?? 0) * TILE_SIZE;
          const px = Math.round(tileX * TILE_SIZE - camXWorld);
          const py = Math.round(tileY * TILE_SIZE - camYWorld);
          return {
            x: rect.left + px / scaleX,
            y: rect.top + py / scaleY,
            tilePxW: TILE_SIZE / scaleX,
            tilePxH: TILE_SIZE / scaleY,
          };
        },
      };

      // ── worldEngineShim: envia ações escrevendo em player_actions ─────
      const worldEngineShim = {
        sendAction: async (action) => {
          if (!action?.payload?.playerId) {
            return { success: false, error: "playerId ausente" };
          }

          let payload = action.payload;

          // Tiles do mapa (map_compacto.json) ainda não existem no Firebase:
          // criamos um world_item temporário e removemos o tile do mapa local.
          // ID virtual: "map_{coord}_{layer}_{tileId}"  ex: "map_94,106,7_2_3349"
          if (
            (payload.itemAction === "pickUp" ||
              payload.itemAction === "moveWorld") &&
            payload.worldItemId?.startsWith("map_")
          ) {
            try {
              const MAP_SYNC_GRACE_MS = 120;
              const withoutPrefix = payload.worldItemId.slice(4); // "94,106,7_2_3349"
              const parts = withoutPrefix.split("_");
              const tileId = parseInt(parts.pop(), 10); // 3349
              const mapLayer = parts.pop(); // "2"
              const coord = parts.join("_"); // "94,106,7"
              const [tx, ty, tz] = coord.split(",").map(Number);

              const tempId = `maptile_${coord.replace(/,/g, "_")}_${tileId}_${Date.now()}`;
              await dbSet(`world_items/${tempId}`, {
                id: tempId,
                tileId,
                name: itemDataService.getItemName(tileId) ?? `Item #${tileId}`,
                x: tx,
                y: ty,
                z: tz,
                type: "item",
                quantity: 1,
                stackable: itemDataService.isStackable(tileId),
                fromMap: false,
                sourceCoord: coord,
                sourceLayer: Number(mapLayer),
                sourceTileId: Number(tileId),
                skipRangeCheck: true, // tile já está "no chão" do jogador
                expiresAt: Date.now() + 60_000,
              });

              // Não remove localmente aqui. A remoção precisa ser dirigida pelo
              // watcher de world_items para manter sincronia entre clientes.
              await new Promise((resolve) =>
                setTimeout(resolve, MAP_SYNC_GRACE_MS),
              );

              payload = { ...payload, worldItemId: tempId };
            } catch (err) {
              console.error("[InventoryUI] map tile spawn failed:", err);
              return { success: false, error: err?.message ?? "erro" };
            }
          }

          const actionId = `${payload.playerId}_${action.type}_${Date.now()}`;
          try {
            await dbSet(`${PATHS.actions}/${actionId}`, {
              ...payload,
              type: action.type,
              expiresAt: Date.now() + 10_000,
            });
            return { success: true };
          } catch (err) {
            console.error("[InventoryUI] sendAction failed:", err);
            return { success: false, error: err?.message ?? "erro" };
          }
        },
      };

      // ── Ghost sprite: apenas o sprite do item, sem borda ou fundo ──────
      const createGhostElement = (itemData) => {
        const tileId = itemData?.tileId ?? itemData?.id;
        const sprite =
          tileId != null ? ws.assetsMgr.getMapSprite(tileId) : null;
        if (sprite?.sheet) {
          const cvs = document.createElement("canvas");
          cvs.width = TILE_SIZE;
          cvs.height = TILE_SIZE;
          // canvas tem fundo transparente por padrão — sem borda/fundo
          const ctx2d = cvs.getContext("2d");
          ctx2d.imageSmoothingEnabled = false;
          // Escala proporcional (letterbox) para não distorcer sprites não-quadrados
          const scaleF = Math.min(TILE_SIZE / sprite.w, TILE_SIZE / sprite.h);
          const dw = Math.round(sprite.w * scaleF);
          const dh = Math.round(sprite.h * scaleF);
          const dx = Math.round((TILE_SIZE - dw) / 2);
          const dy = Math.round((TILE_SIZE - dh) / 2);
          ctx2d.drawImage(
            sprite.sheet,
            sprite.x,
            sprite.y,
            sprite.w,
            sprite.h,
            dx,
            dy,
            dw,
            dh,
          );
          return cvs;
        }
        // Fallback: canvas semi-transparente com "?" (sem fundo opaco)
        const cvs = document.createElement("canvas");
        cvs.width = TILE_SIZE;
        cvs.height = TILE_SIZE;
        const ctx2d = cvs.getContext("2d");
        ctx2d.fillStyle = "rgba(100,100,100,0.5)";
        ctx2d.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
        ctx2d.fillStyle = "#fff";
        ctx2d.font = `${TILE_SIZE * 0.5}px monospace`;
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText("?", TILE_SIZE / 2, TILE_SIZE / 2);
        return cvs;
      };

      const createItemIconElement = (itemData) => {
        const tileId = itemData?.tileId ?? itemData?.id;
        if (tileId == null) return null;

        const sprite = ws.assetsMgr.getMapSprite(tileId);
        if (!sprite?.sheet) return null;

        const cvs = document.createElement("canvas");
        cvs.className = "item-icon";
        cvs.width = TILE_SIZE - 6;
        cvs.height = TILE_SIZE - 6;
        const ctx = cvs.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        const iconSize = TILE_SIZE - 6;
        // Escala proporcional para não distorcer sprites não-quadrados
        const scaleI = Math.min(iconSize / sprite.w, iconSize / sprite.h);
        const diw = Math.round(sprite.w * scaleI);
        const dih = Math.round(sprite.h * scaleI);
        const dix = Math.round((iconSize - diw) / 2);
        const diy = Math.round((iconSize - dih) / 2);
        ctx.drawImage(
          sprite.sheet,
          sprite.x,
          sprite.y,
          sprite.w,
          sprite.h,
          dix,
          diy,
          diw,
          dih,
        );
        return cvs;
      };

      const getItemDescription = (itemData) => {
        const tileId = itemData?.tileId ?? itemData?.id;
        if (tileId == null) return null;
        const parts = [];
        if (itemDataService.canPickUp(tileId)) parts.push("Pegável");
        if (itemDataService.canMove(tileId)) parts.push("Movível");
        if (itemDataService.isUsable(tileId)) parts.push("Usável");
        if (itemDataService.isStackable(tileId)) parts.push("Empilhável");
        const equipSlot = itemDataService.getEquipmentSlotName(tileId);
        if (equipSlot) parts.push(`Equip: ${equipSlot}`);
        parts.push(`TileId: ${tileId}`);
        return parts.join(" • ");
      };

      // ── InventoryUI (cria e monta seu DragDropManager internamente) ───
      this.inventoryUI = new InventoryUI({
        container,
        worldEngine: worldEngineShim,
        playerId,
        canvas: this.canvas,
        worldRenderer: worldRendererAdapter,
        itemDataService,
        createGhostElement,
        createItemIconElement,
        getItemDescription,
      });

      // Sobrepõe getItemData para detectar world_items E tiles do mapa
      this.inventoryUI._dragDrop._getItemData = (source, key) => {
        if (source === "inventory")
          return this.inventoryUI._inventory[key] ?? null;
        if (source === "equipment")
          return this.inventoryUI._equipment[key] ?? null;
        if (source === "world") {
          // 1. Firebase world_items indexados por coordenada "x,y,z"
          if (_worldItemsByCoord[key]?.length) {
            const bucket = _worldItemsByCoord[key];
            return bucket[bucket.length - 1] ?? null;
          }

          // 2. Tiles do mapa (map_compacto.json) com is_pickupable=true
          //    ou is_movable=true
          //    Percorre layers do mais alto ao mais baixo — tile de cima tem prioridade
          const mapTile = ws.map?.[key];
          if (!mapTile) return null;
          const layers = Object.keys(mapTile)
            .map(Number)
            .sort((a, b) => b - a);
          for (const layer of layers) {
            const tiles = mapTile[layer];
            if (!Array.isArray(tiles)) continue;
            for (const tile of tiles) {
              const sourceKey = _buildMapSourceKey(key, layer, tile.id);
              if (
                _claimedMapSourceKeys.has(sourceKey) ||
                _removedMapSourceKeys.has(sourceKey)
              ) {
                continue;
              }

              if (
                itemDataService.canPickUp(tile.id) ||
                itemDataService.canMove(tile.id)
              ) {
                const [x, y, z] = key.split(",").map(Number);
                return {
                  // ID virtual codifica coord + layer + tileId para o shim decodificar
                  id: `map_${key}_${layer}_${tile.id}`,
                  tileId: tile.id,
                  name:
                    itemDataService.getItemName(tile.id) ?? `Item #${tile.id}`,
                  x,
                  y,
                  z,
                  type: "item",
                  quantity: tile.count ?? 1,
                  stackable: itemDataService.isStackable(tile.id),
                  fromMap: true,
                };
              }
            }
          }
          return null;
        }
        return null;
      };

      this.inventoryUI.mount();

      // ── Preview visual de drag/drop (consistente com RPG client) ──────
      const hintEl = document.getElementById("we-drag-preview-hint");
      const setHint = (text = "", state = "") => {
        if (!hintEl) return;
        hintEl.textContent = text;
        hintEl.classList.toggle("is-valid", state === "valid");
        hintEl.classList.toggle("is-invalid", state === "invalid");
      };

      setHint("");

      this._inventoryUnsubscribers.push(
        worldEvents.subscribe(EVENT_TYPES.ITEM_DRAG_START, () => {
          setHint(DRAG_PREVIEW_TEXT.start, "");
        }),
      );
      this._inventoryUnsubscribers.push(
        worldEvents.subscribe(EVENT_TYPES.ITEM_DROP_PREVIEW, (evt) => {
          if (evt?.cleared || !evt?.zone) {
            setHint("");
            return;
          }
          setHint(
            buildDropPreviewMessage(evt),
            evt.isValid === true ? "valid" : "invalid",
          );
        }),
      );
      this._inventoryUnsubscribers.push(
        worldEvents.subscribe(EVENT_TYPES.ITEM_DROP_VALID, () => {
          setHint(DRAG_PREVIEW_TEXT.sent, "valid");
        }),
      );
      this._inventoryUnsubscribers.push(
        worldEvents.subscribe(EVENT_TYPES.ITEM_DROP_INVALID, () => {
          setHint(DRAG_PREVIEW_TEXT.invalid, "invalid");
        }),
      );
      this._inventoryUnsubscribers.push(
        worldEvents.subscribe(EVENT_TYPES.ITEM_DRAG_END, () => {
          setTimeout(() => setHint(""), 350);
        }),
      );

      // ── Subscriptions Firebase ────────────────────────────────────────

      // 1. Inventário e equipamento do jogador
      const unsubPlayerData = watchPlayerData(playerId, (data) => {
        if (!data) return;
        this.inventoryUI.setInventory(data.inventory ?? {});
        this.inventoryUI.setEquipment(data.equipment ?? {});
      });
      if (typeof unsubPlayerData === "function") {
        this._inventoryUnsubscribers.push(unsubPlayerData);
      }

      // 2. Itens no chão (world_items) — popula caches por ID e por coordenada
      const unsubWorldItems = dbWatch("world_items", (items) => {
        _rebuildWorldItemsCache(items);
      });
      if (typeof unsubWorldItems === "function") {
        this._inventoryUnsubscribers.push(unsubWorldItems);
      }

      const unsubWorldMapClaims = dbWatch("world_map_claims", (claims) => {
        _applyMapClaimsSnapshot(claims);
      });
      if (typeof unsubWorldMapClaims === "function") {
        this._inventoryUnsubscribers.push(unsubWorldMapClaims);
      }

      // ── Tecla I → toggle inventário ───────────────────────────────────
      const _onKey = (e) => {
        if (
          e.key.toLowerCase() === "i" &&
          !e.repeat &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          e.preventDefault();
          this.inventoryUI.toggle();
        }
      };
      document.addEventListener("keydown", _onKey);
      this._inventoryUnsubscribers.push(() =>
        document.removeEventListener("keydown", _onKey),
      );

      this.logger.ok(
        `✓ InventoryUI inicializado para ${playerId} (tecla I para abrir)`,
      );
    } catch (error) {
      this.logger.warn(
        `⚠ Falha ao inicializar InventoryUI: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * Seleciona um jogador como contexto ativo do InventoryUI.
   * Chamado pelo GM panel ao clicar "Selecionar para Inventário".
   * Desmonta o UI anterior, troca o playerId e reinicializa.
   */
  selectInventoryPlayer(playerId) {
    if (!playerId) return;
    // Limpa instância anterior
    this.inventoryUI?.unmount();
    this.inventoryUI = null;
    // Remove subscriptions do inventoryUI (mantém worldTick, GC, etc.)
    this._clearInventorySubscriptions();
    window.currentPlayerId = playerId;
    this.initInventoryUI();
    this.inventoryUI?.show();
  }

  /** Limpeza completa — chamar ao fechar/recarregar a aba do world-engine. */
  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._clearInventorySubscriptions();
    for (const unsub of this._workerUnsubscribers) unsub?.();
    this._workerUnsubscribers = [];
    this.worldTick?.stop();
    this.transientGC?.stop();
    this.inventoryUI?.unmount();
    this.dragDropManager?.unmount();
    RuntimeConfig.destroy();
  }
}
