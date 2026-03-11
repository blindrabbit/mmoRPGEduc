// =============================================================================
// spellHUD.js — mmoRPGGame
// Camada UI: Renderiza a barra de magias (slots 1–9) e registra hotkeys.
// Depende de: spellBook.js (dados), spellEngine.js (execução)
// =============================================================================

import { getDefaultSpellSet, getSpell } from "./spellBook.js";
import { canCastSpell } from "./spellBook.js";
import { isInputBlocked } from "./inputController.js";
import { SPELL_TYPE } from "./spellBook.js";
import {
  getActionCooldownKey,
  getCooldownRemainingMs,
} from "./combatScheduler.js";

// ---------------------------------------------------------------------------
// ESTADO INTERNO
// ---------------------------------------------------------------------------
let _player = null; // ref mutável do rpg.html (myPos)
let _playerId = null;
let _getTargetLock = null; // () => targetLock  — getter do rpg.html
let _getMonsters = null; // () => monsters snapshot — getter do worldStore
let _getGameTime = null;
let _onCast = null;
let _sendAction = null;

/** Mapa slot (1–9) → spellId */
const _slotMap = {};

/**
 * Estado "aguardando clique no alvo" para magias que precisam de target
 * mas não há targetLock ativo.
 * null = modo normal | { spellId } = aguardando clique
 */
let _pendingSpell = null;

// ---------------------------------------------------------------------------
// INIT
// @param {function} opts.getTargetLock  — () => targetLock (o objeto lock)
// @param {function} opts.getMonsters    — () => snapshot de monstros do worldStore
// ---------------------------------------------------------------------------
export function initSpellHUD({
  player,
  playerId,
  getTargetLock,
  getMonsters,
  getGameTime,
  onCast,
  sendAction,
}) {
  _player = player;
  _playerId = playerId;
  _getTargetLock = getTargetLock;
  _getMonsters = getMonsters;
  _getGameTime = getGameTime;
  _onCast = onCast ?? (() => {});
  _sendAction = sendAction ?? null;

  _buildSlotMap();
  _renderHUD();
  _bindHotkeys();
  _startCooldownLoop();
}

export function updateSpellHUDPlayer(player) {
  _player = player;
}

// Mantido por compatibilidade — já não é necessário, o HUD resolve via getMonsters()
export function setSpellHUDTarget(_unused) {}

// ---------------------------------------------------------------------------
// RESOLUÇÃO DO ALVO
// Sempre lê o monstro atual do worldStore — nunca usa snapshot antigo.
// ---------------------------------------------------------------------------
function _resolveTarget() {
  const lock = _getTargetLock ? _getTargetLock() : null;
  if (!lock || lock.kind !== "monster") return null;
  const monsters = _getMonsters ? _getMonsters() : {};
  const mob = monsters[lock.id];
  if (!mob || (mob.stats?.hp ?? 0) <= 0 || mob.dead) return null;
  return { ...mob, id: mob.id ?? lock.id };
}

// ---------------------------------------------------------------------------
// SLOT MAP
// ---------------------------------------------------------------------------
function _buildSlotMap() {
  for (const k in _slotMap) delete _slotMap[k];
  const savedSpells = _player?.spells;
  if (savedSpells && typeof savedSpells === "object") {
    for (const [slot, spellId] of Object.entries(savedSpells)) {
      if (getSpell(spellId)) _slotMap[String(slot)] = spellId;
    }
    // Só usa slots salvos se ao menos um era válido (slot numérico → spellId)
    if (Object.keys(_slotMap).length > 0) return;
  }
  const defaults = getDefaultSpellSet(_player?.class ?? null);
  for (const { slot, spellId } of defaults) {
    _slotMap[String(slot)] = spellId;
  }
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
const HUD_CONTAINER_ID = "spell-hud";

function _renderHUD() {
  const old = document.getElementById(HUD_CONTAINER_ID);
  if (old) old.remove();

  const container = document.createElement("div");
  container.id = HUD_CONTAINER_ID;
  container.style.cssText = `
    display: flex;
    gap: 6px;
    padding: 8px 0;
    justify-content: center;
    width: 100%;
    user-select: none;
  `;

  for (let slot = 1; slot <= 9; slot++) {
    const spellId = _slotMap[String(slot)];
    const spell = spellId ? getSpell(spellId) : null;

    const cell = document.createElement("div");
    cell.id = `spell-slot-${slot}`;
    cell.dataset.slot = slot;
    cell.dataset.spell = spellId ?? "";
    cell.title = spell
      ? `[${slot}] ${spell.name}\nMP: ${spell.mpCost}  CD: ${spell.cooldownMs / 1000}s\n${spell.description}`
      : `Slot ${slot} vazio`;

    cell.style.cssText = `
      width: 48px; height: 48px;
      background: ${spell ? "#1a1a2e" : "#111"};
      border: 2px solid ${spell ? "#4a4a8a" : "#333"};
      border-radius: 6px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      cursor: ${spell ? "pointer" : "default"};
      position: relative;
      font-family: 'Courier New', monospace;
      transition: border-color 0.15s, box-shadow 0.15s;
    `;

    // Número do slot
    const label = document.createElement("span");
    label.style.cssText =
      "position:absolute;top:2px;left:4px;font-size:10px;color:#aaa;";
    label.textContent = slot;
    cell.appendChild(label);

    if (spell) {
      const name = document.createElement("span");
      name.style.cssText =
        "font-size:9px;color:#ddd;text-align:center;padding:0 2px;line-height:1.2;";
      name.textContent =
        spell.name.length > 10 ? spell.name.slice(0, 9) + "…" : spell.name;
      cell.appendChild(name);

      const mp = document.createElement("span");
      mp.style.cssText = "font-size:8px;color:#4fc3f7;margin-top:2px;";
      mp.textContent = `${spell.mpCost}mp`;
      cell.appendChild(mp);

      // Overlay de cooldown
      const cdOverlay = document.createElement("div");
      cdOverlay.id = `spell-cd-${slot}`;
      cdOverlay.style.cssText = `
        display: none; position: absolute; inset: 0;
        background: rgba(0,0,0,0.65); border-radius: 4px;
        align-items: center; justify-content: center;
        font-size: 13px; font-weight: bold; color: #fff;
        font-family: 'Courier New', monospace;
      `;
      cell.appendChild(cdOverlay);

      cell.addEventListener("click", () => _triggerSpell(spellId));
    }

    container.appendChild(cell);
  }

  const dock = document.getElementById("spell-dock") ?? document.body;
  dock.appendChild(container);
}

// ---------------------------------------------------------------------------
// HOTKEYS — teclas 1–9
// ---------------------------------------------------------------------------
function _bindHotkeys() {
  window.addEventListener("keydown", (e) => {
    if (isInputBlocked()) return;
    if (!/^[1-9]$/.test(e.key)) return;
    const spellId = _slotMap[e.key];
    if (!spellId) return;
    e.preventDefault();
    _triggerSpell(spellId);
  });
}

// ---------------------------------------------------------------------------
// TRIGGER — decide entre executar imediatamente ou entrar em modo "aguardando"
// ---------------------------------------------------------------------------
async function _triggerSpell(spellId) {
  if (!_player || !_playerId) return;

  const spell = getSpell(spellId);
  if (!spell) return;

  const needsTarget =
    (spell.type === SPELL_TYPE.DIRECT || spell.type === SPELL_TYPE.BUFF) &&
    spell.range;

  if (needsTarget) {
    const target = _resolveTarget();

    if (target) {
      // Tem alvo travado e válido → dispara imediatamente
      _clearPendingSpell();
      await _executeSpell(spellId, target);
    } else {
      // Sem alvo → entra em modo "aguardando clique"
      _enterPendingMode(spellId);
    }
  } else {
    // SELF ou AOE → não precisa de alvo, dispara direto
    _clearPendingSpell();
    await _executeSpell(spellId, null);
  }
}

// ---------------------------------------------------------------------------
// MODO AGUARDANDO ALVO
// Cursor muda para crosshair e o próximo clique esquerdo no canvas dispara a magia.
// ---------------------------------------------------------------------------
function _enterPendingMode(spellId) {
  // Se já estava esperando a mesma magia, cancela (toggle)
  if (_pendingSpell?.spellId === spellId) {
    _clearPendingSpell();
    return;
  }

  _pendingSpell = { spellId };

  // Destaca o slot ativo
  _highlightSlot(spellId, true);

  // Muda cursor do canvas para crosshair
  const canvasEl = document.getElementById("gameCanvas");
  if (canvasEl) canvasEl.style.cursor = "crosshair";

  // Listener de clique esquerdo no canvas — dispara na entidade sob o cursor
  const onClick = async (e) => {
    e.preventDefault();

    const canvas = document.getElementById("gameCanvas");
    const rect = canvas.getBoundingClientRect();
    // Importa cam e getMonsters do escopo externo via closure não é possível
    // aqui — usamos o evento customizado para delegar ao rpg.html
    const event = new CustomEvent("spellTargetClick", {
      detail: {
        spellId,
        clientX: e.clientX,
        clientY: e.clientY,
        rect,
      },
    });
    window.dispatchEvent(event);
    _clearPendingSpell();
    canvas.removeEventListener("click", onClick);
  };

  _pendingSpell.listener = onClick;

  if (canvasEl) canvasEl.addEventListener("click", onClick, { once: true });

  // ESC cancela
  const onEsc = (e) => {
    if (e.key === "Escape") {
      _clearPendingSpell();
      window.removeEventListener("keydown", onEsc);
    }
  };
  _pendingSpell.escListener = onEsc;
  window.addEventListener("keydown", onEsc);
}

function _clearPendingSpell() {
  if (!_pendingSpell) return;

  _highlightSlot(_pendingSpell.spellId, false);

  const canvas = document.getElementById("gameCanvas");
  if (canvas) {
    canvas.style.cursor = "default";
    if (_pendingSpell.listener) {
      canvas.removeEventListener("click", _pendingSpell.listener);
    }
  }
  if (_pendingSpell.escListener) {
    window.removeEventListener("keydown", _pendingSpell.escListener);
  }
  _pendingSpell = null;
}

function _highlightSlot(spellId, active) {
  for (let slot = 1; slot <= 9; slot++) {
    if (_slotMap[String(slot)] === spellId) {
      const cell = document.getElementById(`spell-slot-${slot}`);
      if (cell) {
        cell.style.borderColor = active ? "#f1c40f" : "#4a4a8a";
        cell.style.boxShadow = active ? "0 0 8px #f1c40f" : "none";
      }
    }
  }
}

/**
 * Chamado pelo rpg.html ao receber o evento 'spellTargetClick'.
 * Passa o monstro clicado (já resolvido) para executar a magia.
 */
export async function resolveSpellTargetClick(spellId, mob) {
  if (!mob) return;
  await _executeSpell(spellId, mob);
}

// ---------------------------------------------------------------------------
// EXECUÇÃO FINAL
// ---------------------------------------------------------------------------
async function _executeSpell(spellId, target) {
  const spell = getSpell(spellId);
  if (!spell) {
    _onCast?.({ spellId, ok: false, reason: "Magia não encontrada" });
    return;
  }

  const permission = canCastSpell(spell, _player);
  if (!permission.ok) {
    _onCast?.({ spellId, ok: false, reason: permission.reason });
    return;
  }

  if (spell.type === SPELL_TYPE.DIRECT && !target?.id) {
    _onCast?.({ spellId, ok: false, reason: "Alvo inválido" });
    return;
  }

  if (typeof _sendAction !== "function") {
    _onCast?.({ spellId, ok: false, reason: "Canal de ação indisponível" });
    return;
  }

  const result = await _sendAction({
    type: "spell",
    spellId,
    targetId: target?.id ?? null,
  });

  if (result?.ok !== false && result?.success !== false) {
    const now =
      typeof _getGameTime === "function" ? _getGameTime() : Date.now();
    const cooldownKey = getActionCooldownKey(spellId);
    if (_player && cooldownKey) {
      _player.lastAttack = now;
      _player[cooldownKey] = now;
    }
  }
  if (_onCast) _onCast({ spellId, ...result });
}

// ---------------------------------------------------------------------------
// LOOP DE COOLDOWN
// ---------------------------------------------------------------------------
function _startCooldownLoop() {
  setInterval(() => {
    if (!_playerId) return;
    for (let slot = 1; slot <= 9; slot++) {
      const spellId = _slotMap[String(slot)];
      if (!spellId) continue;
      const overlay = document.getElementById(`spell-cd-${slot}`);
      const cell = document.getElementById(`spell-slot-${slot}`);
      if (!overlay || !cell) continue;
      const spell = getSpell(spellId);
      if (!spell) continue;

      const remMs = getCooldownRemainingMs(_player, spellId, spell.cooldownMs);
      const onCD = remMs > 0;
      const isPending = _pendingSpell?.spellId === spellId;

      if (onCD) {
        const rem = Math.ceil(remMs / 1000);
        overlay.style.display = "flex";
        overlay.textContent = `${rem}s`;
        if (!isPending) cell.style.borderColor = "#333";
      } else {
        overlay.style.display = "none";
        if (!isPending) cell.style.borderColor = "#4a4a8a";
      }
    }
  }, 100);
}

export function refreshSpellHUD(player) {
  _player = player;
  _buildSlotMap();
  _renderHUD();
}
