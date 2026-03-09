// ═══════════════════════════════════════════════════════════════
// gameLoop.js — Game loop principal
// ═══════════════════════════════════════════════════════════════
import { renderWorld } from "../../../render/worldRenderer.js";
import { applyCameraMovement } from "../../../gameplay/inputController.js";
import { getMonsters, getPlayers } from "../../../core/worldStore.js";

export class GameLoop {
  constructor({
    canvas,
    ctx,
    worldState,
    canvasSetup,
    config,
    logger,
    onUpdate,
  }) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.worldState = worldState;
    this.canvasSetup = canvasSetup;
    this.config = config;
    this.logger = logger;
    this.onUpdate = onUpdate;

    this._lastRealTs = null;
    this._lastFrameTs = 0;
    this.RENDER_INTERVAL_MS = 1000 / 30; // 30fps cap
    this._running = false;
    this._rafId = null;
    this._focusedPlayerOnce = false;
  }

  start() {
    this._running = true;
    this._loop = this._loop.bind(this);
    this._rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  _loop(timestamp) {
    if (!this._running) return;

    this._rafId = requestAnimationFrame(this._loop);

    if (!this.worldState.ready) return;

    // Cap 30fps
    const realNow = Date.now();
    if (realNow - this._lastFrameTs < this.RENDER_INTERVAL_MS) return;
    this._lastFrameTs = realNow;

    // Anim clock
    if (this._lastRealTs === null) this._lastRealTs = realNow;
    const delta = Math.min(realNow - this._lastRealTs, 200);
    this.worldState.animClock += delta;
    this._lastRealTs = realNow;
    this.worldState.lastTs = timestamp;

    // Camera movement
    applyCameraMovement(
      this.worldState.camera,
      this.config.WORLDENGINE.camSpeed,
    );

    // Primeira focalização automática em player online
    if (!this._focusedPlayerOnce) {
      const players = getPlayers();
      const firstPlayer = Object.values(players).find(
        (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
      );
      if (firstPlayer) {
        this.worldState.camera.x = Number(firstPlayer.x) - this.canvasSetup.cols / 2;
        this.worldState.camera.y = Number(firstPlayer.y) - this.canvasSetup.rows / 2;
        const pz = Number(firstPlayer.z);
        if (Number.isFinite(pz)) this.worldState.activeZ = pz;
        this._focusedPlayerOnce = true;
      }
    }

    document.getElementById("hud-cam").innerText =
      `${Math.floor(this.worldState.camera.x)},${Math.floor(this.worldState.camera.y)}`;

    // Render
    const camX = this.worldState.camera.x * this.config.TILE_SIZE;
    const camY = this.worldState.camera.y * this.config.TILE_SIZE;

    renderWorld({
      ctx: this.ctx,
      camX,
      camY,
      activeZ: this.worldState.activeZ,
      animClock: this.worldState.animClock,
      ts: timestamp,
      canvasW: this.canvasSetup.canvasW,
      canvasH: this.canvasSetup.canvasH,
      cols: this.canvasSetup.cols,
      rows: this.canvasSetup.rows,
      map: this.worldState.map,
      assets: this.worldState.assetsMgr,
      anim: this.worldState.anim,
      floorIndex: this.worldState.floorIndex,
      roofFadeRadius: this.config.WORLDENGINE.roofFadeRadius,
      renderOptions: {
        showHP: true,
        showName: true,
        renderMode: "high",
        entitiesOnTop: true,
        mapTallBeforeEntities: false,
        upperFloorsBeforeEntities: true,
        topDecorBeforeEntities: false,
      },
    });

    // Update entity count
    const allEntities = { ...getMonsters(), ...getPlayers() };
    document.getElementById("hud-ent").innerText =
      Object.keys(allEntities).length;

    // Callback
    this.onUpdate?.();
  }
}
