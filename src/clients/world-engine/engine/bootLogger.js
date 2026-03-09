// ═══════════════════════════════════════════════════════════════
// bootLogger.js — Sistema de log do boot
// ═══════════════════════════════════════════════════════════════
export class BootLogger {
  constructor(elementId) {
    this.element = document.getElementById(elementId);
  }

  log(msg, type = "info") {
    const line = document.createElement("div");
    line.className = `log-${type}`;
    const ts = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    line.innerText = `${ts}  ${msg}`;
    this.element.appendChild(line);
    this.element.scrollTop = this.element.scrollHeight;
  }

  info(msg) {
    this.log(msg, "info");
  }
  ok(msg) {
    this.log(msg, "ok");
  }
  warn(msg) {
    this.log(msg, "warn");
  }
  error(msg, err) {
    this.log(msg, "err");
    if (err?.message) this.log(err.message, "err");
    if (err?.stack) console.error(err.stack);
  }
}
