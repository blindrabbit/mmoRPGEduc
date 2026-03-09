// ═══════════════════════════════════════════════════════════════
// keyboardHandler.js — Controle de floor por teclado (PgUp/PgDn)
// WASD/setas já tratados por inputController.applyCameraMovement
// ═══════════════════════════════════════════════════════════════
import { setupFloorKeys } from "../../../gameplay/inputController.js";

export class KeyboardHandler {
  /**
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {number} floorRange  — pisos visíveis acima/abaixo (para as pills)
   * @param {import("../engine/bootLogger.js").BootLogger} logger
   * @param {function} onFloorChange  — callback chamado após mudar de floor
   */
  constructor(worldState, floorRange, logger, onFloorChange = () => {}) {
    this.worldState    = worldState;
    this.floorRange    = floorRange ?? 2;
    this.logger        = logger;
    this.onFloorChange = onFloorChange;

    setupFloorKeys(worldState, 0, 15, (z) => {
      this.onFloorChange(z);
    });
  }
}
