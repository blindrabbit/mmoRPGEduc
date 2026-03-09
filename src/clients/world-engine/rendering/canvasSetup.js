// ═══════════════════════════════════════════════════════════════
// canvasSetup.js — Configuração e dimensionamento do canvas
// ═══════════════════════════════════════════════════════════════
import { TILE_SIZE } from "../../../core/config.js";

export class CanvasSetup {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} cols  — SQMs visíveis na largura
   * @param {number} rows  — SQMs visíveis na altura
   */
  constructor(canvas, cols, rows) {
    this.canvas = canvas;
    this.cols = cols;
    this.rows = rows;

    canvas.width  = cols * TILE_SIZE;
    canvas.height = rows * TILE_SIZE;

    this.canvasW = canvas.width;
    this.canvasH = canvas.height;
  }

  /** Redimensiona o canvas (ex: ao mudar cols/rows dinamicamente) */
  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.canvas.width  = cols * TILE_SIZE;
    this.canvas.height = rows * TILE_SIZE;
    this.canvasW = this.canvas.width;
    this.canvasH = this.canvas.height;
  }
}
