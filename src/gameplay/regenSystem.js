// =============================================================================
// regenSystem.js — mmoRPGGame
// Regeneração periódica de HP e MP do jogador.
//
// Design:
//   - Tick base de REGEN_TICK_MS (2s), sobrescrito por buffs/itens via setRegenMod()
//   - Taxas por classe definidas em config.js (REGEN_RATES)
//   - Aplica apenas se HP/MP não estiver cheio e o player não estiver morto
//   - Persiste HP e MP no Firebase via db.js
//   - Emite texto flutuante de cura (opcional, só se ganhar >= 1 ponto)
//
// Extensibilidade:
//   - setRegenMod({ hpBonus, mpBonus, tickMs }) → aplica buff/item temporário
//   - clearRegenMod()                           → remove o modificador
//   - A magia "shield", itens de regeneração ou eventos educacionais podem
//     chamar setRegenMod() para alterar a taxa dinamicamente.
// =============================================================================

import { REGEN_RATES, REGEN_TICK_MS } from "../core/config.js";
import { RuntimeConfig } from "../core/runtimeConfig.js";
import {
  applyHpToPlayer,
  applyMpToPlayer,
  batchWrite,
  PATHS,
} from "../core/db.js";
import { worldEvents, EVENT_TYPES } from "../core/events.js";

// ---------------------------------------------------------------------------
// ESTADO INTERNO
// ---------------------------------------------------------------------------
let _player = null; // ref mutável do rpg.html (myPos)
let _playerId = null;
let _timerId = null; // handle do setInterval
let _onRegen = null; // callback opcional pós-tick

/** Modificador ativo (buff/item). null = sem modificador */
let _mod = null;
// Estrutura de _mod:
// {
//   hpBonus : number,   // HP extra por tick
//   mpBonus : number,   // MP extra por tick
//   tickMs  : number,   // substitui o intervalo base
//   expiresAt: number,  // timestamp de expiração (0 = permanente até clearRegenMod)
// }

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------

/**
 * Inicia o sistema de regeneração.
 * Deve ser chamado uma vez no loadGame(), após myPos estar disponível.
 *
 * @param {object}   opts.player     — referência mutável a myPos
 * @param {string}   opts.playerId   — charId
 * @param {function} opts.onRegen    — callback opcional ({ hp, mp }) chamado a cada tick
 */
export function startRegen({ player, playerId, onRegen = null }) {
  if (_timerId) stopRegen(); // limpa timer anterior se houver

  _player = player;
  _playerId = playerId;
  _onRegen = onRegen;

  _scheduleNextTick();
}

/**
 * Para a regeneração (ex: ao sair do jogo ou morte).
 */
export function stopRegen() {
  if (_timerId) {
    clearTimeout(_timerId);
    _timerId = null;
  }
}

/**
 * Atualiza a referência do player (necessário se myPos for reatribuído).
 */
export function updateRegenPlayer(player) {
  _player = player;
}

/**
 * Aplica um modificador temporário de regeneração.
 * Use para buffs de magia, itens, eventos educacionais, etc.
 *
 * @param {object} mod
 * @param {number} [mod.hpBonus=0]    — HP adicional por tick
 * @param {number} [mod.mpBonus=0]    — MP adicional por tick
 * @param {number} [mod.tickMs]       — novo intervalo (substitui REGEN_TICK_MS)
 * @param {number} [mod.durationMs=0] — 0 = permanente até clearRegenMod()
 */
export function setRegenMod({
  hpBonus = 0,
  mpBonus = 0,
  tickMs,
  durationMs = 0,
}) {
  _mod = {
    hpBonus,
    mpBonus,
    tickMs: tickMs ?? null,
    expiresAt: durationMs > 0 ? Date.now() + durationMs : 0,
  };
  // Reinicia o timer com o novo intervalo
  stopRegen();
  _scheduleNextTick();
}

/**
 * Remove o modificador ativo e volta à taxa base.
 */
export function clearRegenMod() {
  _mod = null;
  stopRegen();
  _scheduleNextTick();
}

/**
 * Retorna as taxas de regen atuais (base + mod).
 * Útil para a HUD exibir "Regen: +15 HP / +5 MP por tick".
 */
export function getCurrentRegenRates() {
  const base = _getBaseRates();
  return {
    hp: base.hp + (_mod?.hpBonus ?? 0),
    mp: base.mp + (_mod?.mpBonus ?? 0),
    tickMs:
      _mod?.tickMs ?? RuntimeConfig.get("tick.regenTickMs", REGEN_TICK_MS),
  };
}

// ---------------------------------------------------------------------------
// LÓGICA INTERNA
// ---------------------------------------------------------------------------

function _getBaseRates() {
  const cls = _player?.class ?? "default";
  // Hot-reload: lê taxas do Firebase (RuntimeConfig) com fallback para config.js
  const liveRates = RuntimeConfig.get(`regen.rates.${cls}`);
  return liveRates ?? REGEN_RATES[cls] ?? REGEN_RATES.default;
}

function _getTickMs() {
  if (_mod?.tickMs) return _mod.tickMs;
  return RuntimeConfig.get("tick.regenTickMs", REGEN_TICK_MS);
}

function _scheduleNextTick() {
  _timerId = setTimeout(_tick, _getTickMs());
}

async function _tick() {
  // Agenda próximo tick antes de qualquer await (evita drift de timer)
  _scheduleNextTick();

  if (!_player || !_playerId) return;

  // Não regen se morto
  if ((_player.stats?.hp ?? 1) <= 0 || _player.dead) return;

  // Expira o mod se necessário
  if (_mod?.expiresAt && Date.now() > _mod.expiresAt) {
    _mod = null;
  }

  const base = _getBaseRates();
  const hpGain = base.hp + (_mod?.hpBonus ?? 0);
  const mpGain = base.mp + (_mod?.mpBonus ?? 0);

  const stats = _player.stats ?? {};
  const hp = stats.hp ?? 0;
  const maxHp = stats.maxHp ?? 100;
  const mp = stats.mp ?? 0;
  const maxMp = stats.maxMp ?? 50;

  // Calcula ganhos reais (sem ultrapassar o máximo)
  const actualHp = Math.min(hpGain, maxHp - hp);
  const actualMp = Math.min(mpGain, maxMp - mp);

  if (actualHp <= 0 && actualMp <= 0) return; // já cheio

  // Atualiza referência local imediatamente (responsividade)
  _player.stats = {
    ...stats,
    hp: hp + actualHp,
    mp: mp + actualMp,
  };

  // Texto flutuante de cura de HP (apenas se ganhar >= 1)
  if (actualHp >= 1) {
    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      defenderId: _playerId,
      defenderType: "players",
      damage: -actualHp,
      isHeal: true,
      defenderX: _player.x,
      defenderY: _player.y,
      defenderZ: _player.z ?? 7,
    });
  }

  // Persiste no Firebase em batch (uma única escrita)
  const updates = {};
  if (actualHp > 0) {
    updates[`${PATHS.playerDataStats(_playerId)}/hp`] = _player.stats.hp;
    updates[`${PATHS.playerStats(_playerId)}/hp`] = _player.stats.hp;
  }
  if (actualMp > 0) {
    updates[`${PATHS.playerDataStats(_playerId)}/mp`] = _player.stats.mp;
    updates[`${PATHS.playerStats(_playerId)}/mp`] = _player.stats.mp;
  }

  try {
    await batchWrite(updates);
  } catch (err) {
    console.warn("[regenSystem] Falha ao persistir regen:", err);
  }

  if (_onRegen) _onRegen({ hp: actualHp, mp: actualMp });
}
