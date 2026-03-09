// ═══════════════════════════════════════════════════════════════
// worldState.js — Estado global do mundo
// ═══════════════════════════════════════════════════════════════
import { AssetManager } from "../render/assetManager.js";
import { AnimationController } from "../render/animationController.js";

export class WorldState {
  constructor() {
    // Dados do mapa
    this.map = {};
    this.floorIndex = null;
    this.mapData = {}; // ← NOVO: metadata dos tiles (map_data.json)

    // Assets
    this.assetsMgr = new AssetManager();
    this.anim = new AnimationController();

    // Câmera
    this.camera = { x: 100, y: 100 };
    this.activeZ = 7;
    this.zoom = 1;

    // Render
    this.animClock = 0;
    this.lastTs = undefined;
    this.ready = false;

    // Tick
    this.tickCount = 0;
    this.gcCount = 0;
    this.gcLastSummary = "-";
  }

  clear() {
    this.map = {};
    this.floorIndex = null;
    this.mapData = {};
    this.assetsMgr.clearMapAssets?.();
    this.camera = { x: 100, y: 100 };
    this.ready = false;
  }

  isReady() {
    return this.ready && this.map && Object.keys(this.map).length > 0;
  }
}
