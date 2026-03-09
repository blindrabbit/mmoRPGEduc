// ═══════════════════════════════════════════════════════════════
// inputController.js — Controles compartilhados de input
// Usado por: worldEngine.html, rpg.html, gm.html
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// ESTADO DE FOCO — bloqueia movimento quando UI está ativa
// ═══════════════════════════════════════════════════════════════

let _inputBlocked = false;

/**
 * Ativa ou desativa o bloqueio de movimento.
 * Chamar com true ao focar o chat, false ao sair.
 *
 * @param {boolean} blocked
 */
export function setInputBlocked(blocked) {
  _inputBlocked = blocked;
}

export function isInputBlocked() {
  return _inputBlocked;
}

/**
 * Conecta automaticamente um <input> ou <textarea> ao bloqueio.
 * Ao focar → bloqueia. Ao perder foco → desbloqueia.
 *
 * @param {HTMLElement} element — campo de texto do chat
 */
export function bindChatInput(element) {
  element.addEventListener("focus", () => setInputBlocked(true));
  element.addEventListener("blur", () => setInputBlocked(false));
}

// ── Mapa de teclas pressionadas ──────────────────────────────
const _keys = {};

window.addEventListener("keydown", (e) => {
  _keys[e.key] = true;
});
window.addEventListener("keyup", (e) => {
  _keys[e.key] = false;
});

export function isKeyDown(key) {
  return !!_keys[key];
}

// ═══════════════════════════════════════════════════════════════
// CÂMERA — movimento livre (worldEngine / gm)
// ═══════════════════════════════════════════════════════════════

/**
 * Aplica movimento de câmera livre com base nas teclas pressionadas.
 * Chamado a cada frame no game loop.
 *
 * @param {{ x, y }} camera   — modificado in-place
 * @param {number}   speed    — SQMs por frame (ex: 1.0)
 */
export function applyCameraMovement(camera, speed = 1.0) {
  if (_inputBlocked) return; // ← chat aberto: ignora

  if (isKeyDown("ArrowLeft") || isKeyDown("a") || isKeyDown("A"))
    camera.x -= speed;
  if (isKeyDown("ArrowRight") || isKeyDown("d") || isKeyDown("D"))
    camera.x += speed;
  if (isKeyDown("ArrowUp") || isKeyDown("w") || isKeyDown("W"))
    camera.y -= speed;
  if (isKeyDown("ArrowDown") || isKeyDown("s") || isKeyDown("S"))
    camera.y += speed;
}

// ═══════════════════════════════════════════════════════════════
// PERSONAGEM — movimento por tile (rpg / jogador)
// ═══════════════════════════════════════════════════════════════

const _MOVE_KEYS = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
  W: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  A: { dx: -1, dy: 0 },
  D: { dx: 1, dy: 0 },
};

let _lastMoveTime = 0;

/**
 * Tenta mover o personagem um tile por frame com cooldown.
 * Retorna o novo { x, y } se moveu, ou null se bloqueado/cooldown.
 *
 * @param {{ x, y, z }} pos         — posição atual
 * @param {number}       stepMs     — intervalo mínimo entre passos (ms)
 * @param {function}     canMove    — (nx, ny, z) → boolean
 * @returns {{ x, y } | null}
 */
export function applyCharacterMovement(
  pos,
  stepMs = 250,
  canMove = () => true,
) {
  if (_inputBlocked) return null; // ← chat aberto: ignora

  const now = Date.now();
  if (now - _lastMoveTime < stepMs) return null;

  for (const key of Object.keys(_MOVE_KEYS)) {
    if (!isKeyDown(key)) continue;

    const { dx, dy } = _MOVE_KEYS[key];
    const nx = pos.x + dx;
    const ny = pos.y + dy;

    _lastMoveTime = now;
    return canMove(nx, ny, pos.z ?? 0) ? { x: nx, y: ny } : null;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// FLOOR — mudança de andar (PageUp / PageDown)
// ═══════════════════════════════════════════════════════════════

/**
 * PageUp/PageDown nunca são bloqueados pelo chat
 * (usuário não digita PageUp no campo de texto).
 */
export function setupFloorKeys(
  state,
  minZ = 0,
  maxZ = 15,
  onChange = () => {},
) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "PageUp") {
      state.activeZ = Math.max(minZ, state.activeZ - 1);
      onChange(state.activeZ);
    }
    if (e.key === "PageDown") {
      state.activeZ = Math.min(maxZ, state.activeZ + 1);
      onChange(state.activeZ);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// ZOOM — scroll do mouse
// ═══════════════════════════════════════════════════════════════

export function setupZoom(canvas, state, min = 0.5, max = 3, step = 0.001) {
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.zoom = Math.min(max, Math.max(min, state.zoom - e.deltaY * step));
      canvas.style.transform = `scale(${state.zoom})`;
    },
    { passive: false },
  );
}
