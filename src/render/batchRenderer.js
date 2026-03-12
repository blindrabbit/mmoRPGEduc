// =============================================================================
// batchRenderer.js — render em lote por atlas (otimização de trocas de textura)
// =============================================================================

import { ObjectPool } from "../core/objectPool.js";

function _resetCmd(cmd) {
  cmd.atlasImage = null;
  cmd.sx = 0;
  cmd.sy = 0;
  cmd.sw = 0;
  cmd.sh = 0;
  cmd.dx = 0;
  cmd.dy = 0;
  cmd.dw = 0;
  cmd.dh = 0;
  cmd.alpha = 1;
}

export class AtlasBatchRenderer {
  constructor(ctx) {
    this.ctx = ctx;
    this._pool = new ObjectPool(
      () => ({
        atlasImage: null,
        sx: 0,
        sy: 0,
        sw: 0,
        sh: 0,
        dx: 0,
        dy: 0,
        dw: 0,
        dh: 0,
        alpha: 1,
      }),
      _resetCmd,
    );
    this._queues = new Map();
    this._queued = [];
  }

  clear() {
    this._pool.releaseMany(this._queued);
    this._queued.length = 0;
    this._queues.clear();
  }

  queue({ atlasImage, sx, sy, sw, sh, dx, dy, dw, dh, alpha = 1 }) {
    if (!atlasImage) return;

    const cmd = this._pool.acquire();
    cmd.atlasImage = atlasImage;
    cmd.sx = sx;
    cmd.sy = sy;
    cmd.sw = sw;
    cmd.sh = sh;
    cmd.dx = dx;
    cmd.dy = dy;
    cmd.dw = dw;
    cmd.dh = dh;
    cmd.alpha = alpha;

    let list = this._queues.get(atlasImage);
    if (!list) {
      list = [];
      this._queues.set(atlasImage, list);
    }
    list.push(cmd);
    this._queued.push(cmd);
  }

  flush() {
    const ctx = this.ctx;
    if (!ctx || this._queues.size === 0) return;

    for (const [, draws] of this._queues) {
      for (const cmd of draws) {
        if (cmd.alpha < 1) {
          ctx.save();
          ctx.globalAlpha = cmd.alpha;
        }
        ctx.drawImage(
          cmd.atlasImage,
          cmd.sx,
          cmd.sy,
          cmd.sw,
          cmd.sh,
          cmd.dx,
          cmd.dy,
          cmd.dw,
          cmd.dh,
        );
        if (cmd.alpha < 1) {
          ctx.restore();
        }
      }
    }

    this.clear();
  }
}
