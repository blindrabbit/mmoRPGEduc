// ═══════════════════════════════════════════════════════════════
// draggablePanels.js — Torna painéis do WorldEngine arrastáveis
// ═══════════════════════════════════════════════════════════════

const DEFAULT_PANEL_IDS = [
  "hud",
  "metrics-panel",
  "upload-panel",
  "gm-panel",
  "floor-hud",
  "tick-hud",
  "controls-hint",
  "tooltip",
];

const INTERACTIVE_SELECTOR =
  "button, input, select, textarea, a, [contenteditable='true'], [data-no-drag='true']";

let _zCounter = 30;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pinElementToCurrentPosition(el) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  el.style.position = "fixed";
  el.style.left = `${Math.round(rect.left)}px`;
  el.style.top = `${Math.round(rect.top)}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.transform = "none";
  el.style.pointerEvents = "auto";
  el.classList.add("we-draggable-panel");
}

function clampElementToViewport(el) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const maxX = Math.max(0, window.innerWidth - rect.width);
  const maxY = Math.max(0, window.innerHeight - rect.height);

  const x = clamp(Math.round(rect.left), 0, maxX);
  const y = clamp(Math.round(rect.top), 0, maxY);

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function makeElementDraggable(el) {
  if (!el || el.dataset.dragReady === "1") return () => {};
  el.dataset.dragReady = "1";

  pinElementToCurrentPosition(el);
  clampElementToViewport(el);

  let dragging = false;
  let dragPointerId = null;
  let offsetX = 0;
  let offsetY = 0;

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest(INTERACTIVE_SELECTOR)) return;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    dragging = true;
    dragPointerId = event.pointerId;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;

    _zCounter += 1;
    el.style.zIndex = String(_zCounter);
    el.classList.add("dragging");
    el.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragging || event.pointerId !== dragPointerId) return;

    const rect = el.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width);
    const maxY = Math.max(0, window.innerHeight - rect.height);

    const x = clamp(Math.round(event.clientX - offsetX), 0, maxX);
    const y = clamp(Math.round(event.clientY - offsetY), 0, maxY);

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  };

  const onPointerEnd = (event) => {
    if (!dragging || event.pointerId !== dragPointerId) return;

    dragging = false;
    dragPointerId = null;
    el.classList.remove("dragging");
    el.releasePointerCapture?.(event.pointerId);
    clampElementToViewport(el);
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerEnd);
  el.addEventListener("pointercancel", onPointerEnd);

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerEnd);
    el.removeEventListener("pointercancel", onPointerEnd);
  };
}

export function initDraggableHUDPanels(panelIds = DEFAULT_PANEL_IDS) {
  const cleanups = [];

  panelIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    cleanups.push(makeElementDraggable(el));
  });

  const onResize = () => {
    panelIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      clampElementToViewport(el);
    });
  };

  window.addEventListener("resize", onResize);

  return () => {
    cleanups.forEach((dispose) => dispose());
    window.removeEventListener("resize", onResize);
  };
}
