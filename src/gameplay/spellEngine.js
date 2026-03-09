// =============================================================================
// spellEngine.js — mmoRPGGame
// Submete intenções de magia para o worldEngine via player_actions.
// O worldEngine (actionProcessor.js) valida e executa tudo server-side.
//
// Este módulo mantém:
//   - Cooldowns LOCAIS (UX: evita spam visual antes do worldEngine responder)
//   - Validação RÁPIDA de MP e classe (feedback imediato ao jogador)
//   - Submissão da ação via submitPlayerAction()
//   - CLIENT-SIDE PREDICTION: exibe dano/cura imediatamente (responsividade)
//
// Toda lógica de dano, cura e efeitos reais fica no actionProcessor.js.
// =============================================================================

import {
  getSpell,
  canCastSpell,
  calcSpellResult,
  SPELL_TYPE,
} from "./spellBook.js";
import { submitPlayerAction, applyMpToPlayer } from "../core/db.js";
import { emitHpDeltaText } from "./combatEngine.js";
import { calculateNewHp } from "./combatLogic.js";

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

  // Validação rápida local (feedback imediato — worldEngine re-valida também)
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
  if (needsTarget && !target) {
    return { ok: false, reason: "Selecione um alvo (botão direito)" };
  }
  if (needsTarget && target) {
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > (spell.range ?? 4) + 0.5) {
      return {
        ok: false,
        reason: `Alvo fora do alcance (${spell.range} tiles)`,
      };
    }
  }

  // Marca cooldown e desconta MP localmente (responsividade visual)
  _setCooldown(playerId, spellId, spell.cooldownMs);
  const newMp = Math.max(0, (player.stats?.mp ?? 0) - spell.mpCost);
  player.stats = { ...player.stats, mp: newMp };
  await applyMpToPlayer(playerId, newMp);

  // ✅ CLIENT-SIDE PREDICTION: exibe dano/cura imediato (antes da confirmação do servidor)
  if (spell.type === SPELL_TYPE.DIRECT && target) {
    const { damage } = calcSpellResult(spell, player.stats, target.stats);
    const newHp = calculateNewHp(target.stats.hp, -damage, target.stats.maxHp);
    const diff = newHp - (target.stats?.hp ?? 0);
    if (diff !== 0) {
      emitHpDeltaText("monsters", target.id, target, diff);
    }
  } else if (spell.type === SPELL_TYPE.SELF) {
    const { heal } = calcSpellResult(spell, player.stats);
    const currentHp = player.stats?.hp ?? 0;
    const newHp = Math.min(player.stats?.maxHp ?? 100, currentHp + heal);
    const diff = newHp - currentHp;
    if (diff !== 0) {
      emitHpDeltaText("players", playerId, player, diff);
    }
  }
  // AOE: não faz prediction para múltiplos alvos (complexo demais, deixa o servidor fazer)

  // Submete a intenção — worldEngine executa e valida tudo de forma autoritativa
  try {
    await submitPlayerAction(playerId, {
      type: "spell",
      spellId,
      targetId: target?.id ?? null,
    });
    return { ok: true, reason: null };
  } catch (err) {
    console.error("[spellEngine] Falha ao submeter ação:", err);
    return { ok: false, reason: "Erro ao enviar ação" };
  }
}
