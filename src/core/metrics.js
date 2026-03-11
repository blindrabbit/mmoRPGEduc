// =============================================================================
// metrics.js — Instrumentação de métricas de desempenho do worldEngine
//
// Métricas coletadas:
//   • TPS (ações processadas/s) — janela deslizante de 5 s
//   • Latência por ação (ms): avg, max, histograma de buckets
//   • Profundidade da fila + pico
//   • Contadores: recebidas, processadas, expiradas, cooldown, range
//
// Uso:
//   import { recordActionReceived, recordActionProcessed,
//            recordActionRejected, recordQueueDepth,
//            getMetricsSummary, resetMetrics } from '../core/metrics.js';
// =============================================================================

// ---------------------------------------------------------------------------
// JANELA DESLIZANTE DE TPS
// ---------------------------------------------------------------------------
const TPS_WINDOW_MS = 5_000; // janela para cálculo de TPS
/** @type {number[]} */
const _processedTs = []; // timestamps das ações consumidas

// ---------------------------------------------------------------------------
// CONTADORES TOTAIS
// ---------------------------------------------------------------------------
let _totalReceived = 0;
let _totalProcessed = 0;
let _totalExpired = 0;
let _totalCooldown = 0;
let _totalRange = 0;
let _totalOtherReject = 0;

// ---------------------------------------------------------------------------
// LATÊNCIA
// ---------------------------------------------------------------------------
let _latencySum = 0;
let _latencyCount = 0;
let _latencyMax = 0;
// ms desde que a ação foi escrita pelo cliente até ser consumida
// Buckets: <10ms, <50ms, <100ms, <250ms, <500ms, ≥500ms
const _latencyBuckets = {
  lt10: 0,
  lt50: 0,
  lt100: 0,
  lt250: 0,
  lt500: 0,
  slow: 0,
};

// ---------------------------------------------------------------------------
// FILA
// ---------------------------------------------------------------------------
let _queueDepth = 0;
let _peakQueueDepth = 0;

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------

/** Chamado quando uma ação de player chega ao worldEngine (child_added). */
export function recordActionReceived() {
  _totalReceived++;
}

/**
 * Chamado quando uma ação é efetivamente executada (consumed: true, não expirou).
 * @param {number} latencyMs  — agora − action.ts (latência cliente→servidor)
 */
export function recordActionProcessed(latencyMs) {
  const now = Date.now();
  _processedTs.push(now);
  _totalProcessed++;

  const ms = Number(latencyMs);
  if (Number.isFinite(ms) && ms >= 0) {
    _latencySum += ms;
    _latencyCount++;
    if (ms > _latencyMax) _latencyMax = ms;

    if (ms < 10) _latencyBuckets.lt10++;
    else if (ms < 50) _latencyBuckets.lt50++;
    else if (ms < 100) _latencyBuckets.lt100++;
    else if (ms < 250) _latencyBuckets.lt250++;
    else if (ms < 500) _latencyBuckets.lt500++;
    else _latencyBuckets.slow++;
  }
}

/**
 * Chamado quando uma ação foi rejeitada sem ser consumida (voltará para fila
 * ou foi descartada) para fins de monitoramento de rejeição.
 * @param {string} reason — 'cooldown' | 'out-of-range' | 'expired' | outro
 */
export function recordActionRejected(reason) {
  switch (reason) {
    case "cooldown":
      _totalCooldown++;
      break;
    case "out-of-range":
      _totalRange++;
      break;
    case "expired":
      _totalExpired++;
      break;
    default:
      _totalOtherReject++;
      break;
  }
}

/**
 * Atualiza a profundidade atual da fila de ações pendentes.
 * @param {number} size
 */
export function recordQueueDepth(size) {
  _queueDepth = size;
  if (size > _peakQueueDepth) _peakQueueDepth = size;
}

/**
 * Retorna snapshot atual das métricas.
 * @returns {{
 *   tps: number,
 *   totalReceived: number,
 *   totalProcessed: number,
 *   totalExpired: number,
 *   cooldownRejects: number,
 *   rangeRejects: number,
 *   otherRejects: number,
 *   avgLatencyMs: string,
 *   maxLatencyMs: number,
 *   latencyBuckets: object,
 *   queueDepth: number,
 *   peakQueueDepth: number,
 * }}
 */
export function getMetricsSummary() {
  const now = Date.now();

  // Prune old TPS timestamps
  const cutoff = now - TPS_WINDOW_MS;
  while (_processedTs.length && _processedTs[0] < cutoff) {
    _processedTs.shift();
  }

  return {
    tps: parseFloat((_processedTs.length / (TPS_WINDOW_MS / 1000)).toFixed(2)),
    totalReceived: _totalReceived,
    totalProcessed: _totalProcessed,
    totalExpired: _totalExpired,
    cooldownRejects: _totalCooldown,
    rangeRejects: _totalRange,
    otherRejects: _totalOtherReject,
    avgLatencyMs:
      _latencyCount > 0 ? (_latencySum / _latencyCount).toFixed(1) : "—",
    maxLatencyMs: _latencyMax,
    latencyBuckets: { ..._latencyBuckets },
    queueDepth: _queueDepth,
    peakQueueDepth: _peakQueueDepth,
  };
}

/** Zera todos os contadores (útil para comparação entre runs de carga). */
export function resetMetrics() {
  _processedTs.length = 0;
  _totalReceived = 0;
  _totalProcessed = 0;
  _totalExpired = 0;
  _totalCooldown = 0;
  _totalRange = 0;
  _totalOtherReject = 0;
  _latencySum = 0;
  _latencyCount = 0;
  _latencyMax = 0;
  Object.keys(_latencyBuckets).forEach((k) => (_latencyBuckets[k] = 0));
  _queueDepth = 0;
  _peakQueueDepth = 0;
}
