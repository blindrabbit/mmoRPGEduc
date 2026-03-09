// ═══════════════════════════════════════════════════════════════
// zoomHandler.js — Zoom via scroll do mouse
// ═══════════════════════════════════════════════════════════════
import { setupZoom } from "../../../gameplay/inputController.js";

export class ZoomHandler {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../../../core/worldState.js").WorldState} worldState
   */
  constructor(canvas, worldState) {
    setupZoom(canvas, worldState);
  }
}
