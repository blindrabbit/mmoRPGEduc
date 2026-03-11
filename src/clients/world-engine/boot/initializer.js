// ═══════════════════════════════════════════════════════════════
// initializer.js — Orquestração da inicialização
// ═══════════════════════════════════════════════════════════════
import { NEW_ASSETS } from "../../../core/config.js";
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
import {
  initGameLoop as initWorkerLoop,
  startLoop,
  syncGameEntities,
} from "../engine/gameLoop.js";
import { createProgressionUI } from "../../shared/ui/ProgressionUI.js";
import { watchMonsters, watchPlayers, watchFields } from "../../../core/db.js";

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

    // Loop
    this.gameLoop = null;
    this._rafId = null;

    // Worker sync — armazena unsubscribers para limpeza posterior
    this._workerUnsubscribers = [];
  }

  async init() {
    // 1. Carregar mapa e assets
    await this.loadMapAssets();

    // 2. Inicializar serviços
    this.initServices();

    // 3. Inicializar input
    this.initInput();

    // 4. Inicializar UI
    this.initUI();

    // 5. Inicializar loop de rendering (rAF) + worker tick
    this.initGameLoop();
    await this.initWorkerSync();

    // 6. Marcar como ready
    this.worldState.ready = true;

    // 7. Iniciar Firebase sync buttons
    this.firebaseSync?.setupButtons();

    // 8. Inicializar Progression UI (FASE 4)
    this.initProgressionUI();
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

    this.logger.info("[2/4] map_data.json");
    const dataRes = await fetch(NEW_ASSETS.dataFile);
    if (!dataRes.ok)
      throw new Error(`HTTP ${dataRes.status} — ${NEW_ASSETS.dataFile}`);
    this.worldState.mapData = await dataRes.json();
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
    // Import dinâmico para evitar circular dependency
    const { buildFloorIndex } = await import("../../../render/mapRenderer.js");
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
    const tick = () => {
      this.hudRenderer.update();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
    this.logger.ok("[GameLoop] Loop de rendering iniciado (rAF).");
  }

  /**
   * Inicializa o worker de tick e configura sync contínuo Firebase → Worker.
   * Os watchers fornecem o snapshot inicial na primeira chamada (sem necessidade
   * de busca separada).
   */
  async initWorkerSync() {
    const { WORLDENGINE } = this.config;

    const ok = await initWorkerLoop({
      tickInterval: WORLDENGINE.worldTickMs ?? 100,
      // onTick vazio: WorldTick na main thread já cuida da lógica como fallback
      onTick: () => {},
    });

    if (!ok) {
      this.logger.warn(
        "[Worker] Falha ao iniciar worker — usando só main thread.",
      );
      return;
    }

    // Firebase → Worker: a primeira chamada de cada watcher já envia o snapshot
    // inicial, as chamadas seguintes enviam deltas em tempo real.
    this._workerUnsubscribers = [
      watchMonsters((monsters) => syncGameEntities({ monsters })),
      watchPlayers((players) => syncGameEntities({ players })),
      watchFields((fields) => syncGameEntities({ fields })),
    ];

    startLoop();
    this.logger.ok("[Worker] Game loop worker iniciado e Firebase sync ativo.");
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

  /** Limpeza completa — chamar ao fechar/recarregar a aba do world-engine. */
  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    for (const unsub of this._workerUnsubscribers) unsub?.();
    this._workerUnsubscribers = [];
    this.worldTick?.stop();
    this.transientGC?.stop();
  }
}
