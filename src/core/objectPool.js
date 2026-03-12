// =============================================================================
// objectPool.js — pool genérico para reduzir alocações em loops quentes
// =============================================================================

export class ObjectPool {
  constructor(createFn, resetFn = null) {
    this._create = typeof createFn === "function" ? createFn : () => ({});
    this._reset = typeof resetFn === "function" ? resetFn : null;
    this._free = [];
  }

  acquire() {
    return this._free.pop() ?? this._create();
  }

  release(obj) {
    if (!obj) return;
    if (this._reset) this._reset(obj);
    this._free.push(obj);
  }

  releaseMany(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) this.release(item);
  }

  clear() {
    this._free.length = 0;
  }

  get size() {
    return this._free.length;
  }
}
