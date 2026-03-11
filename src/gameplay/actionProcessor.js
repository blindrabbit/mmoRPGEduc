// =============================================================================
// actionProcessor.js — mmoRPGEduc
// Processa a fila player_actions no worldEngine.
//
// Arquitetura:
//   Cliente escreve intenção → player_actions/{id}
//   worldEngine chama processAction() a cada tick
//   Valida com fontes canônicas (spellBook, combatLogic)
//   Aplica efeitos no Firebase e emite eventos via worldEvents
// =============================================================================

import {
  batchWrite,
  applyHpToPlayer,
  applyMpToPlayer,
  syncEffect,
  encodeUser,
  PATHS,
} from "../core/db.js";

import { getMonsters, getPlayers } from "../core/worldStore.js";
import { worldEvents, EVENT_TYPES } from "../core/events.js";

import {
  handleMonsterDeathLocal,
  mergeUpdate,
  applyToMob,
} from "./monsterManager.js";

import {
  getSpell,
  canCastSpell,
  calcSpellResult,
  SPELL_TYPE,
} from "./spellBook.js";

import {
  calculateCombatResult,
  calculateNewHp,
  calculateFinalDamage,
  isInAttackRange,
  COMBAT,
} from "./combatLogic.js";

import {
  resolveAttack,
  emitDamage,
  emitHeal,
  buildCombatEffectPayload,
} from "./combat/combatService.js";

import { createField } from "./magic/fieldSystem.js";
import { pushLog } from "./eventLog.js";

// ---------------------------------------------------------------------------
// COOLDOWNS — gerenciados aqui, não no cliente
// ---------------------------------------------------------------------------
const _cooldowns = new Map();
const _queuedActions = new Map();

function _isOnCooldown(playerId, key) {
  return Date.now() < (_cooldowns.get(`${playerId}:${key}`) ?? 0);
}
function _setCooldown(playerId, key, ms) {
  _cooldowns.set(`${playerId}:${key}`, Date.now() + ms);
}

// ---------------------------------------------------------------------------
// FILA DE AÇÕES — enqueue/flush
// ---------------------------------------------------------------------------
export function enqueueAction(actionId, action) {
  if (!actionId || !action) return;
  _queuedActions.set(actionId, { actionId, action });
}

export async function flushQueuedActions(now = Date.now()) {
  const pending = Array.from(_queuedActions.values());
  const processedActionIds = [];

  for (const item of pending) {
    if (!item?.actionId || !item?.action) continue;
    await processAction(item.actionId, item.action, now);
    _queuedActions.delete(item.actionId);
    processedActionIds.push(item.actionId);
  }

  return processedActionIds;
}

// ---------------------------------------------------------------------------
// processAction — chamado pelo watchPlayerActions ou flushQueuedActions
// ---------------------------------------------------------------------------
export async function processAction(actionId, action, now) {
  if (!action || !actionId) return;
  if (action.expiresAt && now > action.expiresAt) return;
  await _dispatch(actionId, action, now);
}

// ---------------------------------------------------------------------------
// DISPATCH
// ---------------------------------------------------------------------------
function resolvePlayerKey(players, playerIdRaw) {
  const raw = String(playerIdRaw ?? "");
  if (!raw) return null;
  if (players?.[raw]) return raw;
  if (raw.includes("@") || raw.includes(".")) {
    const encoded = encodeUser(raw);
    if (players?.[encoded]) return encoded;
  }
  return null;
}

async function _dispatch(actionId, action, now) {
  const { type, playerId } = action;
  if (!playerId) return;

  const players = getPlayers();
  const playerKey = resolvePlayerKey(players, playerId);
  if (!playerKey) return;

  const player = players[playerKey];
  if (!player) return;

  const normalizedAction =
    playerKey === playerId ? action : { ...action, playerId: playerKey };

  switch (type) {
    case "attack":
      return _processAttack(normalizedAction, player, now);
    case "spell":
      return _processSpell(normalizedAction, player, now);
    case "allocateStat":
      return _processAllocateStat(normalizedAction, player, now);
    default:
      console.warn("[actionProcessor] Tipo de ação desconhecido:", type);
  }
}

// ---------------------------------------------------------------------------
// ATAQUE FÍSICO
// ---------------------------------------------------------------------------
async function _processAttack(action, player, now) {
  const { playerId, targetId } = action;
  if (_isOnCooldown(playerId, "basicAttack")) return;

  const monsters = getMonsters();
  const target = monsters[targetId];
  if (!target || (target.stats?.hp ?? 0) <= 0 || target.dead) return;
  if (!isInAttackRange(player, target, 1.5)) return;

  _setCooldown(playerId, "basicAttack", COMBAT.ATTACK_COOLDOWN_MS);

  // Usar combatService para resolução autoritativa
  const result = resolveAttack(playerId, player, targetId, target, { now });

  const updates = {};
  if (result.fxPayload)
    updates[`world_effects/${result.fxId}`] = result.fxPayload;

  if (result.hit) {
    if (result.newHp <= 0 && !target.dead) {
      handleMonsterDeathLocal(
        targetId,
        { ...target, stats: { ...target.stats, hp: result.newHp } },
        updates,
        now,
      );
    } else {
      updates[`world_entities/${targetId}/stats/hp`] = result.newHp;
    }
    await batchWrite(updates);
    pushLog(
      "damage",
      `${player.name} atacou ${target.name ?? targetId}: ${result.damage} HP`,
    );
  } else {
    if (result.fxPayload) await syncEffect(result.fxId, result.fxPayload);
    pushLog("damage", `${player.name} errou ${target.name ?? targetId} [MISS]`);
  }
}

// ---------------------------------------------------------------------------
// MAGIAS
// ---------------------------------------------------------------------------
async function _processSpell(action, player, now) {
  const { playerId, spellId, targetId } = action;
  const spell = getSpell(spellId);
  if (!spell) return;

  const perm = canCastSpell(spell, player);
  if (!perm.ok) {
    pushLog("system", `[${player.name}] magia negada: ${perm.reason}`);
    return;
  }
  if (_isOnCooldown(playerId, spellId)) return;

  _setCooldown(playerId, spellId, spell.cooldownMs);
  const newMp = Math.max(0, (player.stats?.mp ?? 0) - spell.mpCost);
  await applyMpToPlayer(playerId, newMp);

  const z = player.z ?? 7;

  // ── FIELD (CAMPO PERSISTENTE) ───────────────────────────────────────────
  if (spell.type === SPELL_TYPE.FIELD || spell.isField) {
    const targetX =
      action.targetX ??
      Math.round(
        player.x + Math.cos(player.direction || 0) * (spell.range ?? 3),
      );
    const targetY =
      action.targetY ??
      Math.round(
        player.y + Math.sin(player.direction || 0) * (spell.range ?? 3),
      );
    const targetZ = action.targetZ ?? z;

    const dist = Math.hypot(targetX - player.x, targetY - player.y);
    if (dist > (spell.range ?? 3) + 0.5) {
      pushLog("system", `${player.name} tentou colocar campo fora de alcance`);
      return;
    }

    const result = await createField({
      casterId: playerId,
      casterType: "player",
      spellData: spell,
      x: targetX,
      y: targetY,
      z: targetZ,
    });

    if (result.success) {
      pushLog(
        "system",
        `${player.name} criou campo ${spell.name} em (${targetX},${targetY})`,
      );
      // Emitir evento visual do lançamento
      if (spell.effectId) {
        worldEvents.emit(EVENT_TYPES.SPELL_EFFECT, {
          effectId: spell.effectId,
          x: targetX,
          y: targetY,
          z: targetZ,
          duration: spell.effectDuration || 800,
          isField: true,
          fieldId: result.fieldId,
          timestamp: now,
        });
      }
    } else {
      pushLog("error", `Falha ao criar campo: ${result.error}`);
    }
    return;
  }

  // ── DIRECT ─────────────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.DIRECT) {
    const monsters = getMonsters();
    const target = monsters[targetId];
    if (!target || (target.stats?.hp ?? 0) <= 0 || target.dead) return;

    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > (spell.range ?? 4) + 0.5) return;

    const { damage } = calcSpellResult(spell, player.stats, target.stats);
    const newHp = calculateNewHp(target.stats.hp, -damage, target.stats.maxHp);

    // Emitir evento via combatService (não UI direta)
    emitDamage(targetId, "monsters", damage, target, {
      attackerId: playerId,
      spellId,
      element: spell.damageType,
    });

    const updates = {};
    if (spell.effectId) {
      const fxId = `spell_${spellId}_${playerId}_${now}`;
      updates[`world_effects/${fxId}`] = _spellFx({
        id: fxId,
        effectId: spell.effectId,
        x: target.x,
        y: target.y,
        z: target.z ?? z,
        duration: spell.effectDuration,
      });
    }

    if (newHp <= 0 && !target.dead) {
      handleMonsterDeathLocal(
        targetId,
        { ...target, stats: { ...target.stats, hp: newHp } },
        updates,
        now,
      );
    } else {
      updates[`world_entities/${targetId}/stats/hp`] = newHp;
    }
    await batchWrite(updates);
    pushLog(
      "damage",
      `${player.name} usou ${spell.name}: ${damage} HP em ${target.name ?? targetId}`,
    );
    return;
  }

  // ── SELF ───────────────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.SELF) {
    const { heal } = calcSpellResult(spell, player.stats);
    const newHp = Math.min(
      player.stats?.maxHp ?? 100,
      (player.stats?.hp ?? 100) + heal,
    );

    emitHeal(playerId, "players", heal, player);
    await applyHpToPlayer(playerId, newHp);

    if (spell.selfEffectId) {
      const fxId = `spell_${spellId}_${playerId}_${now}`;
      await syncEffect(
        fxId,
        _spellFx({
          id: fxId,
          effectId: spell.selfEffectId,
          x: player.x,
          y: player.y,
          z,
          duration: spell.effectDuration,
        }),
      );
    }
    pushLog("heal", `${player.name} se curou: +${heal} HP`);
    return;
  }

  // ── AOE (sem campo persistente) ────────────────────────────────────────
  if (spell.type === SPELL_TYPE.AOE) {
    const monsters = getMonsters();
    const radius = spell.aoeRadius ?? 2;
    const hits = [];

    for (const [mid, mob] of Object.entries(monsters)) {
      if (!mob || (mob.stats?.hp ?? 0) <= 0 || mob.dead) continue;
      if ((mob.z ?? 7) !== z) continue;
      if (Math.hypot(mob.x - player.x, mob.y - player.y) > radius + 0.5)
        continue;

      const { damage } = calcSpellResult(spell, player.stats, mob.stats);
      const newHp = calculateNewHp(mob.stats.hp, -damage, mob.stats.maxHp);

      emitDamage(mid, "monsters", damage, mob, {
        attackerId: playerId,
        spellId,
      });
      hits.push({ id: mid, mob, newHp, damage });
    }

    if (spell.effectId) {
      const radiusCeil = Math.ceil(radius);
      const fxUpdates = {};
      for (let dx = -radiusCeil; dx <= radiusCeil; dx++) {
        for (let dy = -radiusCeil; dy <= radiusCeil; dy++) {
          if (Math.hypot(dx, dy) > radius + 0.5) continue;
          const fxId = `spell_${spellId}_${playerId}_${now}_${dx}_${dy}`;
          fxUpdates[`world_effects/${fxId}`] = _spellFx({
            id: fxId,
            effectId: spell.effectId,
            x: Math.round(player.x) + dx,
            y: Math.round(player.y) + dy,
            z,
            duration: spell.effectDuration,
          });
        }
      }
      await batchWrite(fxUpdates);
    }

    const dmgUpdates = {};
    for (const { id, mob, newHp } of hits) {
      if (newHp <= 0 && !mob.dead) {
        handleMonsterDeathLocal(
          id,
          { ...mob, stats: { ...mob.stats, hp: newHp } },
          dmgUpdates,
          now,
        );
      } else {
        dmgUpdates[`world_entities/${id}/stats/hp`] = newHp;
      }
    }
    if (Object.keys(dmgUpdates).length > 0) await batchWrite(dmgUpdates);
    pushLog(
      "damage",
      `${player.name} usou ${spell.name}: atingiu ${hits.length} alvos`,
    );
    return;
  }

  // ── BUFF / DEBUFF ──────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.BUFF) {
    const isSelf = !targetId || !spell.range;
    const { stat, delta } = spell.statMod ?? {};
    if (!stat || delta === undefined) return;

    if (isSelf) {
      const current = player.stats?.[stat] ?? 0;
      const newVal = current + delta;
      await batchWrite({
        [`${PATHS.playerDataStats(playerId)}/${stat}`]: newVal,
        [`${PATHS.playerStats(playerId)}/${stat}`]: newVal,
      });
      if (spell.selfEffectId) {
        const fxId = `spell_${spellId}_${playerId}_${now}`;
        await syncEffect(
          fxId,
          _spellFx({
            id: fxId,
            effectId: spell.selfEffectId,
            x: player.x,
            y: player.y,
            z,
            duration: spell.effectDuration,
          }),
        );
      }
      setTimeout(async () => {
        await batchWrite({
          [`${PATHS.playerDataStats(playerId)}/${stat}`]: current,
          [`${PATHS.playerStats(playerId)}/${stat}`]: current,
        });
      }, spell.duration ?? 5000);
    } else {
      const monsters = getMonsters();
      const target = monsters[targetId];
      if (!target || (target.stats?.hp ?? 0) <= 0) return;
      const current = target.stats?.[stat] ?? 0;
      await batchWrite({
        [`world_entities/${targetId}/stats/${stat}`]: current + delta,
      });
      if (spell.effectId) {
        const fxId = `spell_${spellId}_${playerId}_${now}`;
        await syncEffect(
          fxId,
          _spellFx({
            id: fxId,
            effectId: spell.effectId,
            x: target.x,
            y: target.y,
            z: target.z ?? z,
            duration: spell.effectDuration,
          }),
        );
      }
      setTimeout(async () => {
        await batchWrite({
          [`world_entities/${targetId}/stats/${stat}`]: current,
        });
      }, spell.duration ?? 5000);
    }
    pushLog("system", `${player.name} usou ${spell.name}`);
  }
}

// =============================================================================
// ADICIONAR NOVA FUNÇÃO (após _processSpell)
// =============================================================================

// ---------------------------------------------------------------------------
// DISTRIBUIÇÃO DE ATRIBUTOS
// ---------------------------------------------------------------------------
async function _processAllocateStat(action, player, now) {
  const { playerId, statName, amount = 1 } = action;

  // Importar progressionSystem
  const { allocateStatPoint } =
    await import("./progression/progressionSystem.js");

  const result = await allocateStatPoint(playerId, statName, amount);

  if (result.success) {
    pushLog(
      "system",
      `${player.name} distribuiu ${amount} ponto(s) em ${statName}`,
    );
  } else {
    pushLog(
      "error",
      `${player.name} falhou ao distribuir atributo: ${result.error}`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// HELPER — payload de efeito visual
// ---------------------------------------------------------------------------
function _spellFx({ id, effectId, x, y, z, duration, startTime }) {
  const t = startTime ?? Date.now();
  const d = Number(duration ?? 800);
  return {
    id: String(id),
    type: "effect",
    effectId: Number(effectId),
    x: Number(x),
    y: Number(y),
    z: Number(z ?? 7),
    startTime: t,
    effectDuration: d,
    expiry: t + d,
    isField: false,
  };
}
