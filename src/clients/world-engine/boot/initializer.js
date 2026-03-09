// ═══════════════════════════════════════════════════════════════
// initializer.js — Orquestração da inicialização
// ═══════════════════════════════════════════════════════════════
import { NEW_ASSETS } from "../../../core/config.js";
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
import { GameLoop } from "../engine/gameLoop.js";

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
    this.tooltip = null;
    this.hudRenderer = null;

    // Loop
    this.gameLoop = null;
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

    // 5. Inicializar game loop
    this.initGameLoop();

    // 6. Marcar como ready
    this.worldState.ready = true;

    // 7. Iniciar Firebase sync buttons
    this.firebaseSync?.setupButtons();
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
    this.tooltip = new Tooltip(this.canvas, this.worldState, this.config);
    this.hudRenderer = new HUDRenderer(this.worldState);

    this.floorHUD.update();
    this.worldStateHUD.init();
  }

  initGameLoop() {
    const { WORLDENGINE, TILE_SIZE } = this.config;
    this.gameLoop = new GameLoop({
      canvas: this.canvas,
      ctx: this.canvas.getContext("2d"),
      worldState: this.worldState,
      canvasSetup: this.canvasSetup,
      config: { WORLDENGINE, TILE_SIZE },
      logger: this.logger,
      onUpdate: () => this.hudRenderer.update(),
    });
    this.gameLoop.start();
  }
}
