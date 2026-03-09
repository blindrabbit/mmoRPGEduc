// =============================================================================
// tickWorker.js — Web Worker do clock do worldTick
//
// Por que Worker?
//   setInterval na thread principal é throttlado pelo browser para ≥1000ms
//   quando a aba está em background ou oculta. Web Workers rodam em thread
//   separada e NÃO sofrem esse throttling — o clock permanece preciso
//   mesmo com a aba do worldEngine minimizada ou em segundo plano.
//
// Protocolo de mensagens:
//   Recebe: { type: 'start', intervalMs: number }
//           { type: 'stop' }
//           { type: 'setInterval', intervalMs: number }   ← muda intervalo em runtime
//   Envia:  { type: 'tick', ts: number }                 ← timestamp real do disparo
// =============================================================================

let _timerId  = null;
let _interval = 250;

function startTick(intervalMs) {
  stopTick();
  _interval = intervalMs ?? _interval;
  _timerId  = setInterval(() => {
    postMessage({ type: 'tick', ts: Date.now() });
  }, _interval);
}

function stopTick() {
  if (_timerId !== null) {
    clearInterval(_timerId);
    _timerId = null;
  }
}

self.onmessage = (e) => {
  const { type, intervalMs } = e.data ?? {};
  switch (type) {
    case 'start':
      startTick(intervalMs);
      break;
    case 'stop':
      stopTick();
      break;
    case 'setInterval':
      startTick(intervalMs); // reinicia com novo intervalo
      break;
  }
};
