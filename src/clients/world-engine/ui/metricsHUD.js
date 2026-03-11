// ═══════════════════════════════════════════════════════════════
// metricsHUD.js — Painel de métricas de desempenho (TPS, latência, fila)
//
// Atualiza um elemento DOM fixo a cada segundo com os dados do módulo
// metrics.js para medir TPS real e latência em testes de carga.
//
// Uso:
//   const hud = new MetricsHUD('metrics-panel');
//   hud.init();
// ═══════════════════════════════════════════════════════════════
import { getMetricsSummary, resetMetrics } from "../../../core/metrics.js";

export class MetricsHUD {
  /**
   * @param {string} [containerId='metrics-panel'] — id do elemento container
   * @param {number} [intervalMs=1000]             — frequência de atualização
   */
  constructor(containerId = "metrics-panel", intervalMs = 1000) {
    this._containerId = containerId;
    this._intervalMs = intervalMs;
    this._timer = null;
    this._el = null;
  }

  init() {
    this._el = document.getElementById(this._containerId);
    if (!this._el) return;

    this._render(getMetricsSummary());
    this._timer = setInterval(
      () => this._render(getMetricsSummary()),
      this._intervalMs,
    );

    // Botão reset — criado dinamicamente dentro do painel
    this._el
      .querySelector(".metrics-reset-btn")
      ?.addEventListener("click", () => {
        resetMetrics();
        this._render(getMetricsSummary());
      });
  }

  destroy() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  // ── Renderização interna ──────────────────────────────────────────────

  _render(m) {
    if (!this._el) return;

    const total =
      m.cooldownRejects + m.rangeRejects + m.totalExpired + m.otherRejects;
    const rejectPct =
      m.totalReceived > 0
        ? ((total / m.totalReceived) * 100).toFixed(1)
        : "0.0";

    const buckets = m.latencyBuckets;

    this._el.innerHTML = `
<div class="mhud-title">⚡ METRICS</div>

<div class="mhud-section">
  <span class="mhud-label">TPS</span>
  <span class="mhud-value ${_tpsColor(m.tps)}">${m.tps.toFixed(1)} act/s</span>
</div>

<div class="mhud-section">
  <span class="mhud-label">FILA</span>
  <span class="mhud-value">${m.queueDepth} <span class="mhud-dim">(peak ${m.peakQueueDepth})</span></span>
</div>

<div class="mhud-section">
  <span class="mhud-label">LAT avg</span>
  <span class="mhud-value ${_latColor(Number(m.avgLatencyMs))}">${m.avgLatencyMs} ms</span>
</div>
<div class="mhud-section">
  <span class="mhud-label">LAT max</span>
  <span class="mhud-value ${_latColor(m.maxLatencyMs)}">${m.maxLatencyMs} ms</span>
</div>

<div class="mhud-section mhud-buckets">
  <span class="mhud-label">BUCKETS</span>
  <span class="mhud-dim">&lt;10: ${buckets.lt10} | &lt;50: ${buckets.lt50} | &lt;100: ${buckets.lt100}</span>
  <span class="mhud-dim">&lt;250: ${buckets.lt250} | &lt;500: ${buckets.lt500} | slow: ${buckets.slow}</span>
</div>

<div class="mhud-sep"></div>

<div class="mhud-section">
  <span class="mhud-label">RECV</span>
  <span class="mhud-value">${m.totalReceived}</span>
</div>
<div class="mhud-section">
  <span class="mhud-label">PROC</span>
  <span class="mhud-value">${m.totalProcessed}</span>
</div>
<div class="mhud-section">
  <span class="mhud-label">REJECT</span>
  <span class="mhud-value ${total > 0 ? "mhud-warn" : ""}">${total} <span class="mhud-dim">(${rejectPct}%)</span></span>
</div>
<div class="mhud-section mhud-sub">
  <span class="mhud-dim">cd: ${m.cooldownRejects} | rng: ${m.rangeRejects} | exp: ${m.totalExpired}</span>
</div>

<button class="metrics-reset-btn">Reset</button>
    `.trim();

    // Re-attach click handler após innerHTML
    this._el
      .querySelector(".metrics-reset-btn")
      ?.addEventListener("click", () => {
        resetMetrics();
        this._render(getMetricsSummary());
      });
  }
}

// ---------------------------------------------------------------------------
// helpers de cor inline
// ---------------------------------------------------------------------------
function _tpsColor(tps) {
  if (tps >= 5) return "mhud-ok";
  if (tps >= 1) return "mhud-mid";
  return "";
}

function _latColor(ms) {
  if (!ms || ms === 0) return "";
  if (ms < 100) return "mhud-ok";
  if (ms < 300) return "mhud-mid";
  return "mhud-warn";
}
