// =============================================================================
// actionProcessor.js — mmoRPGGame
// Processa a fila player_actions no worldEngine.
//
// Arquitetura:
//   Cliente (rpg.html) escreve intenção → player_actions/{id}
//   worldEngine chama tickActions() a cada worldTick
//   actionProcessor valida tudo com as fontes canônicas (spellBook, combatLogic)
//   Aplica efeitos no Firebase e apaga a ação processada
//
// Tipos de ação suportados:
//   { type: 'attack',   targetId }
//   { type: 'spell',    spellId, targetId? }
//
// REGRA: toda lógica de dano/cura/custo vem deste módulo.
//        O cliente não escreve mais em world_entities diretamente.
// =============================================================================

import {
  batchWrite,
  applyHpToPlayer,
  syncEffect,
  spendMpAndSetCooldown,
  encodeUser,
  PATHS,
  setPlayerActionCooldown,
} from "../core/db.js";

import { getMonsters, getPlayers } from "../core/worldStore.js";

import {
  handleMonsterDeathLocal,
  mergeUpdate,
  applyToMob,
} from "./monsterManager.js";
import {
  buildFieldPayload,
  buildFieldEffectFallbackPayload,
} from "./fieldPayload.js";

import {
  getSpell,
  canCastSpell,
  calcSpellResult,
  SPELL_TYPE,
} from "./spellBook.js";
import { resolveFieldVisualIds } from "./abilityCore.js";

import {
  calculateCombatResult,
  calculateNewHp,
  calculateFinalDamage,
  isInAttackRange,
  COMBAT,
} from "./combatLogic.js";

import { buildCombatEffectPayload } from "./combatEngine.js";
import { worldEvents, EVENT_TYPES } from "../core/events.js";

import { pushLog } from "./eventLog.js";
import {
  getQueuedCombatActionKey,
  isCombatActionReady,
} from "./combatScheduler.js";
import {
  recordActionProcessed,
  recordActionRejected,
  recordQueueDepth,
} from "../core/metrics.js";

const _queuedActions = new Map();

export function enqueueAction(actionId, action) {
  if (!actionId || !action) return;
  const queueKey = getQueuedCombatActionKey(actionId, action);
  _queuedActions.set(queueKey, { actionId, action });
  recordQueueDepth(_queuedActions.size);
}

export async function flushQueuedActions(now = Date.now()) {
  const pending = Array.from(_queuedActions.values()).sort(
    (left, right) =>
      Number(left?.action?.ts ?? 0) - Number(right?.action?.ts ?? 0),
  );

  const processedActionIds = [];
  for (const item of pending) {
    if (!item?.actionId || !item?.action) continue;
    const result = await processAction(item.actionId, item.action, now);
    const queueKey = getQueuedCombatActionKey(item.actionId, item.action);
    if (result?.consumed) {
      _queuedActions.delete(queueKey);
      processedActionIds.push(item.actionId);
    }
  }
  recordQueueDepth(_queuedActions.size);
  return processedActionIds;
}

// ---------------------------------------------------------------------------
// processAction — chamado pelo watchPlayerActions assim que uma ação chega.
// Cada ação é processada individualmente e de forma imediata (event-driven).
// ---------------------------------------------------------------------------
export async function processAction(actionId, action, now) {
  if (!action || !actionId) return { consumed: true, reason: "invalid" };

  // Ação expirada (lag extremo, reconexão tardia, etc.)
  if (action.expiresAt && now > action.expiresAt) {
    recordActionRejected("expired");
    return { consumed: true, reason: "expired" };
  }

  const result = await _dispatch(actionId, action, now);

  if (result?.consumed) {
    // Latência = tempo desde que cliente escreveu a ação até ser processada
    const clientTs = Number(action.ts ?? 0);
    if (clientTs > 0) {
      recordActionProcessed(now - clientTs);
    } else {
      recordActionProcessed(0);
    }
  } else if (result?.reason) {
    recordActionRejected(result.reason);
  }

  return result;
}

// ---------------------------------------------------------------------------
// DISPATCH
// ---------------------------------------------------------------------------
function resolvePlayerKey(players, playerIdRaw) {
  const raw = String(playerIdRaw ?? "");
  if (!raw) return null;
  if (players?.[raw]) return raw;

  // IDs com '@' ou '.' são armazenados encodados via safePath/encodeUser.
  if (raw.includes("@") || raw.includes(".")) {
    const encoded = encodeUser(raw);
    if (players?.[encoded]) return encoded;
  }

  return null;
}

async function _dispatch(actionId, action, now) {
  const { type, playerId } = action;
  if (!playerId) return { consumed: true, reason: "missing-player" };

  const players = getPlayers();
  const playerKey = resolvePlayerKey(players, playerId);
  if (!playerKey) return { consumed: false, reason: "player-not-ready" };

  const player = players[playerKey];
  if (!player) return { consumed: false, reason: "player-not-ready" };

  // Normaliza action.playerId para o formato real usado no worldStore/Firebase
  // (evita ignorar ações quando o ID no banco está encodado).
  const normalizedAction =
    playerKey === playerId ? action : { ...action, playerId: playerKey };

  switch (type) {
    case "attack":
      return _processAttack(normalizedAction, player, now);
    case "spell":
      return _processSpell(normalizedAction, player, now);
    default:
      console.warn("[actionProcessor] Tipo de ação desconhecido:", type);
      return { consumed: true, reason: "unknown-type" };
  }
}

// ---------------------------------------------------------------------------
// ATAQUE FÍSICO
// ---------------------------------------------------------------------------
async function _processAttack(action, player, now) {
  const { playerId, targetId } = action;

  if (
    !isCombatActionReady(player, "basicAttack", COMBAT.ATTACK_COOLDOWN_MS, now)
  ) {
    return { consumed: false, reason: "cooldown" };
  }

  const monsters = getMonsters();
  const target = monsters[targetId];

  if (!target || (target.stats?.hp ?? 0) <= 0 || target.dead) {
    return { consumed: true, reason: "target-invalid" };
  }
  if (!isInAttackRange(player, target, 1.5)) {
    return { consumed: false, reason: "out-of-range" };
  }

  player.lastAttack = now;
  await setPlayerActionCooldown(playerId, "basicAttack", now);
  const updates = {};
  const result = calculateCombatResult(player.stats, target.stats);

  if (result.hit) {
    const dmg = result.damage;
    const newHp = calculateNewHp(target.stats.hp, -dmg, target.stats.maxHp);

    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      defenderId: targetId,
      defenderType: "monsters",
      damage: dmg,
      defenderX: target.x,
      defenderY: target.y,
      defenderZ: target.z ?? 7,
    });

    const fxId = `hit_player_${playerId}_${targetId}_${now}`;
    const hitFx = buildCombatEffectPayload("attackHit", {
      id: fxId,
      x: target.x,
      y: target.y,
      z: target.z ?? 7,
      now,
    });

    // Usa o mesmo mapa de updates (não sombrear) para manter dano + efeitos no mesmo batch.
    // Isso garante que o HP realmente seja aplicado quando não houver morte.
    if (hitFx) updates[`world_effects/${fxId}`] = hitFx;

    // ✅ Morte instantânea: chama handleMonsterDeathLocal se HP zerou
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
      `${player.name} atacou ${target.name ?? targetId}: ${dmg} HP`,
    );
    return { consumed: true, reason: "hit" };
  } else {
    worldEvents.emit(EVENT_TYPES.COMBAT_MISS, {
      defenderX: target.x,
      defenderY: target.y,
      defenderZ: target.z ?? 7,
    });
    const fxId = `miss_player_${playerId}_${targetId}_${now}`;
    const missFx = buildCombatEffectPayload("attackMiss", {
      id: fxId,
      x: target.x,
      y: target.y,
      z: target.z ?? 7,
      now,
    });
    if (missFx) await syncEffect(fxId, missFx);
    pushLog("damage", `${player.name} errou ${target.name ?? targetId} [MISS]`);
    return { consumed: true, reason: "miss" };
  }
}

// ---------------------------------------------------------------------------
// MAGIAS
// ---------------------------------------------------------------------------
async function _processSpell(action, player, now) {
  const { playerId, spellId, targetId } = action;

  const spell = getSpell(spellId);
  if (!spell) return { consumed: true, reason: "spell-missing" };

  // ── Validações canônicas (cliente não pode burlar) ────────────────────
  const perm = canCastSpell(spell, player);
  if (!perm.ok) {
    pushLog("system", `[${player.name}] magia negada: ${perm.reason}`);
    return { consumed: true, reason: "permission-denied" };
  }

  if (!isCombatActionReady(player, spellId, spell.cooldownMs, now)) {
    return { consumed: false, reason: "cooldown" };
  }

  // ── Custo de MP ───────────────────────────────────────────────────────
  player.lastAttack = now;
  const newMp = Math.max(0, (player.stats?.mp ?? 0) - spell.mpCost);
  await spendMpAndSetCooldown(playerId, spellId, newMp, now);

  const z = player.z ?? 7;

  // ── DIRECT ───────────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.DIRECT) {
    const monsters = getMonsters();
    const target = monsters[targetId];
    if (!target || (target.stats?.hp ?? 0) <= 0 || target.dead) {
      return { consumed: true, reason: "target-invalid" };
    }

    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > (spell.range ?? 4) + 0.5) {
      return { consumed: false, reason: "out-of-range" };
    }

    const { damage } = calcSpellResult(spell, player.stats, target.stats);
    const newHp = calculateNewHp(target.stats.hp, -damage, target.stats.maxHp);

    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      defenderId: targetId,
      defenderType: "monsters",
      damage,
      defenderX: target.x,
      defenderY: target.y,
      defenderZ: target.z ?? 7,
    });

    const updates = {};

    if (spell.effectId != null) {
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

    // ✅ Morte instantânea: chama handleMonsterDeathLocal se HP zerou
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
    return { consumed: true, reason: "direct-cast" };
  }

  // ── SELF ─────────────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.SELF) {
    const { heal } = calcSpellResult(spell, player.stats);
    const newHp = Math.min(
      player.stats?.maxHp ?? 100,
      (player.stats?.hp ?? 100) + heal,
    );

    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      defenderId: playerId,
      defenderType: "players",
      damage: -heal,
      isHeal: true,
      defenderX: player.x,
      defenderY: player.y,
      defenderZ: player.z ?? 7,
    });
    await applyHpToPlayer(playerId, newHp);

    if (spell.selfEffectId != null) {
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
    return { consumed: true, reason: "self-cast" };
  }

  // ── AOE ───────────────────────────────────────────────────────────────
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
      worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
        defenderId: mid,
        defenderType: "monsters",
        damage,
        defenderX: mob.x,
        defenderY: mob.y,
        defenderZ: mob.z ?? 7,
      });
      hits.push({ id: mid, mob, newHp, damage });
    }

    // Todos os tiles do AOE em um único batchWrite — sem wave delay
    if (spell.effectId != null) {
      const radiusCeil = Math.ceil(radius);
      const fxUpdates = {};
      const tileNow = Date.now();
      const visuals = resolveFieldVisualIds({
        fieldId: spell.fieldId,
        effectId: spell.effectId,
        statusType: spell.statusType,
      });
      for (let dx = -radiusCeil; dx <= radiusCeil; dx++) {
        for (let dy = -radiusCeil; dy <= radiusCeil; dy++) {
          if (Math.hypot(dx, dy) > radius + 0.5) continue;
          const fxId = `spell_${spellId}_${playerId}_${now}_${dx}_${dy}`;
          const targetX = Math.round(player.x) + dx;
          const targetY = Math.round(player.y) + dy;

          if (spell.isField) {
            fxUpdates[`world_fields/${fxId}`] = buildFieldPayload({
              id: fxId,
              x: targetX,
              y: targetY,
              z,
              now: tileNow,
              damage,
              fieldId: visuals.fieldId,
              effectId: visuals.effectId,
              fieldDuration: spell.fieldDuration ?? spell.effectDuration,
              tickRate: spell.tickRate ?? 1000,
              statusType: spell.statusType ?? null,
            });
            fxUpdates[`world_effects/${fxId}`] =
              buildFieldEffectFallbackPayload({
                x: targetX,
                y: targetY,
                z,
                now: tileNow,
                isPersistent: true,
                isField: true,
                fieldDuration: spell.fieldDuration ?? spell.effectDuration,
                effectDuration: spell.effectDuration,
                effectId: visuals.effectId,
              });
            continue;
          }

          fxUpdates[`world_effects/${fxId}`] = _spellFx({
            id: fxId,
            effectId: spell.effectId,
            x: targetX,
            y: targetY,
            z,
            duration: spell.effectDuration,
            startTime: tileNow,
            isField: false,
            fieldDuration: 0,
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
    return { consumed: true, reason: "aoe-cast" };
  }

  // ── BUFF / DEBUFF ─────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.BUFF) {
    const isSelf = !targetId || !spell.range;
    const { stat, delta } = spell.statMod ?? {};
    if (!stat || delta === undefined) {
      return { consumed: true, reason: "buff-invalid" };
    }

    if (isSelf) {
      const current = player.stats?.[stat] ?? 0;
      const newVal = current + delta;
      await batchWrite({
        [`${PATHS.playerDataStats(playerId)}/${stat}`]: newVal,
        [`${PATHS.playerStats(playerId)}/${stat}`]: newVal,
      });
      if (spell.selfEffectId != null) {
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
      // Reverte o buff após duration
      setTimeout(async () => {
        await batchWrite({
          [`${PATHS.playerDataStats(playerId)}/${stat}`]: current,
          [`${PATHS.playerStats(playerId)}/${stat}`]: current,
        });
      }, spell.duration ?? 5000);
    } else {
      const monsters = getMonsters();
      const target = monsters[targetId];
      if (!target || (target.stats?.hp ?? 0) <= 0) {
        return { consumed: true, reason: "target-invalid" };
      }
      const current = target.stats?.[stat] ?? 0;
      await batchWrite({
        [`world_entities/${targetId}/stats/${stat}`]: current + delta,
      });
      if (spell.effectId != null) {
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
    return { consumed: true, reason: "buff-cast" };
  }

  return { consumed: true, reason: "processed" };
}

// ---------------------------------------------------------------------------
// HELPER — monta payload de efeito visual
// ---------------------------------------------------------------------------
function _spellFx({
  id,
  effectId,
  x,
  y,
  z,
  duration,
  startTime,
  isField,
  fieldDuration,
}) {
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
    isField: Boolean(isField),
    fieldDuration: Number(fieldDuration ?? 0),
  };
}
