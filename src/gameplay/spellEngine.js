// =============================================================================
// spellEngine.js — mmoRPGEduc
// Submete intenções de magia para o worldEngine via player_actions.
//
// REGRA: Este módulo NÃO faz lógica de dano/cura — apenas:
//   • Validação RÁPIDA local (UX: feedback imediato)
//   • Cooldowns LOCAIS (apenas para evitar spam visual)
//   • Submissão da ação via submitPlayerAction()
//
// Toda lógica autoritativa fica em actionProcessor.js
// =============================================================================

import { getSpell, canCastSpell, SPELL_TYPE } from "./spellBook.js";
import { submitPlayerAction, applyMpToPlayer } from "../core/db.js";
import { worldEvents, EVENT_TYPES } from "../core/events.js";

// ---------------------------------------------------------------------------
// COOLDOWNS LOCAIS (apenas para UX — não são fonte de verdade)
// ---------------------------------------------------------------------------
const _cooldowns = new Map();
function _cdKey(playerId, spellId) {
  return `${playerId}:${spellId}`;
}
export function isSpellOnCooldown(playerId, spellId) {
  return Date.now() < (_cooldowns.get(_cdKey(playerId, spellId)) ?? 0);
}
export function getSpellCooldownRemaining(playerId, spellId) {
  return Math.max(
    0,
    (_cooldowns.get(_cdKey(playerId, spellId)) ?? 0) - Date.now(),
  );
}
function _setCooldown(playerId, spellId, ms) {
  _cooldowns.set(_cdKey(playerId, spellId), Date.now() + ms);
}

// ---------------------------------------------------------------------------
// castSpell — valida localmente e submete ao worldEngine
// ---------------------------------------------------------------------------
export async function castSpell({
  player,
  playerId,
  spellId,
  target,
  getGameTime,
}) {
  const spell = getSpell(spellId);
  if (!spell) return { ok: false, reason: "Magia desconhecida" };

  // Validação rápida local (worldEngine re-valida)
  const perm = canCastSpell(spell, player);
  if (!perm.ok) return perm;
  if (isSpellOnCooldown(playerId, spellId)) {
    const rem = Math.ceil(getSpellCooldownRemaining(playerId, spellId) / 1000);
    return { ok: false, reason: `Cooldown: ${rem}s` };
  }

  // Verifica alvo para magias que precisam
  const needsTarget =
    (spell.type === SPELL_TYPE.DIRECT || spell.type === SPELL_TYPE.BUFF) &&
    spell.range;
  if (needsTarget && !target)
    return { ok: false, reason: "Selecione um alvo (botão direito)" };
  if (needsTarget && target) {
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > (spell.range ?? 4) + 0.5) {
      return {
        ok: false,
        reason: `Alvo fora do alcance (${spell.range} tiles)`,
      };
    }
  }

  // Marca cooldown local e desconta MP (responsividade visual)
  _setCooldown(playerId, spellId, spell.cooldownMs);
  const newMp = Math.max(0, (player.stats?.mp ?? 0) - spell.mpCost);
  player.stats = { ...player.stats, mp: newMp };
  await applyMpToPlayer(playerId, newMp);

  // ✅ Emitir evento de cast para UI mostrar efeito visual imediato (prediction)
  worldEvents.emit(EVENT_TYPES.SPELL_CAST, {
    casterId: playerId,
    spellId,
    spellName: spell.name,
    targetId: target?.id ?? null,
    targetX: target?.x ?? null,
    targetY: target?.y ?? null,
    targetZ: target?.z ?? player.z ?? 7,
    spellType: spell.type,
    predicted: true, // Flag para cliente saber que é prediction
    timestamp: Date.now(),
  });

  // Submete a intenção — worldEngine executa autoritativamente
  try {
    await submitPlayerAction(playerId, {
      type: "spell",
      spellId,
      targetId: target?.id ?? null,
      targetX: target?.x ?? null,
      targetY: target?.y ?? null,
      targetZ: target?.z ?? null,
    });
    return { ok: true, reason: null };
  } catch (err) {
    console.error("[spellEngine] Falha ao submeter ação:", err);
    return { ok: false, reason: "Erro ao enviar ação" };
  }
}
