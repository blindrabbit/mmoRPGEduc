// ═══════════════════════════════════════════════════════════════
// wakeLock.js — Mantém a tela acesa usando a Wake Lock API
// ═══════════════════════════════════════════════════════════════
export class WakeLockService {
  constructor(logger) {
    this.logger = logger;
    this._lock = null;
    this._el = document.getElementById("hud-wake");
  }

  async init() {
    if (!navigator.wakeLock) {
      this._setStatus("N/A");
      return;
    }
    try {
      this._lock = await navigator.wakeLock.request("screen");
      this._setStatus("ON");

      this._lock.addEventListener("release", () => {
        this._lock = null;
        this._setStatus("OFF");
      });

      // Reaquire ao voltar para a aba
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && !this._lock) {
          this.init();
        }
      });
    } catch (e) {
      this._setStatus("ERR");
      this.logger?.warn?.(`[WakeLock] ${e.message}`);
    }
  }

  _setStatus(text) {
    if (this._el) this._el.innerText = text;
  }
}
