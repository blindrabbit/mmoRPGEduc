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
  applyMpToPlayer,
  syncEffect,
  encodeUser,
  PATHS,
} from "../core/db.js";

import { getMonsters, getPlayers } from "../core/worldStore.js";

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
  emitHpDeltaText,
  emitMissText,
  buildCombatEffectPayload,
} from "./combatEngine.js";

import { pushLog } from "./eventLog.js";

// ---------------------------------------------------------------------------
// COOLDOWNS — gerenciados aqui, não no cliente
// Chave: `${playerId}:${actionKey}` → timestamp de liberação
// ---------------------------------------------------------------------------
const _cooldowns = new Map();

function _isOnCooldown(playerId, key) {
  return Date.now() < (_cooldowns.get(`${playerId}:${key}`) ?? 0);
}
function _setCooldown(playerId, key, ms) {
  _cooldowns.set(`${playerId}:${key}`, Date.now() + ms);
}

// ---------------------------------------------------------------------------
// processAction — chamado pelo watchPlayerActions assim que uma ação chega.
// Cada ação é processada individualmente e de forma imediata (event-driven).
// ---------------------------------------------------------------------------
export async function processAction(actionId, action, now) {
  if (!action || !actionId) return;

  // Ação expirada (lag extremo, reconexão tardia, etc.)
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

  // IDs com '@' ou '.' são armazenados encodados via safePath/encodeUser.
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
  if (!playerKey) return; // player offline/não sincronizado ou ID não casou

  const player = players[playerKey];
  if (!player) return; // player offline ou não sincronizado

  // Normaliza action.playerId para o formato real usado no worldStore/Firebase
  // (evita ignorar ações quando o ID no banco está encodado).
  const normalizedAction = playerKey === playerId ? action : { ...action, playerId: playerKey };

  switch (type) {
    case "attack":
      return _processAttack(normalizedAction, player, now);
    case "spell":
      return _processSpell(normalizedAction, player, now);
    default:
      console.warn("[actionProcessor] Tipo de ação desconhecido:", type);
  }
}

// ---------------------------------------------------------------------------
// ATAQUE FÍSICO
// ---------------------------------------------------------------------------
async function _processAttack(action, player, now) {
  const { playerId, targetId } = action;

  // Cooldown do ataque básico (server-side, não editável pelo cliente)
  if (_isOnCooldown(playerId, "basicAttack")) return;

  const monsters = getMonsters();
  const target = monsters[targetId];

  if (!target || (target.stats?.hp ?? 0) <= 0 || target.dead) return;
  if (!isInAttackRange(player, target, 1.5)) return;

  _setCooldown(playerId, "basicAttack", COMBAT.ATTACK_COOLDOWN_MS);
  const updates = {};
  const result = calculateCombatResult(player.stats, target.stats);

  if (result.hit) {
    const dmg = result.damage;
    const newHp = calculateNewHp(target.stats.hp, -dmg, target.stats.maxHp);

    emitHpDeltaText("monsters", targetId, target, -dmg);

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
  } else {
    emitMissText(target);
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
  }
}

// ---------------------------------------------------------------------------
// MAGIAS
// ---------------------------------------------------------------------------
async function _processSpell(action, player, now) {
  const { playerId, spellId, targetId } = action;

  const spell = getSpell(spellId);
  if (!spell) return;

  // ── Validações canônicas (cliente não pode burlar) ────────────────────
  const perm = canCastSpell(spell, player);
  if (!perm.ok) {
    pushLog("system", `[${player.name}] magia negada: ${perm.reason}`);
    return;
  }

  if (_isOnCooldown(playerId, spellId)) return;

  // ── Custo de MP ───────────────────────────────────────────────────────
  _setCooldown(playerId, spellId, spell.cooldownMs);
  const newMp = Math.max(0, (player.stats?.mp ?? 0) - spell.mpCost);
  await applyMpToPlayer(playerId, newMp);

  const z = player.z ?? 7;

  // ── DIRECT ───────────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.DIRECT) {
    const monsters = getMonsters();
    const target = monsters[targetId];
    if (!target || (target.stats?.hp ?? 0) <= 0 || target.dead) return;

    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > (spell.range ?? 4) + 0.5) return;

    const { damage } = calcSpellResult(spell, player.stats, target.stats);
    const newHp = calculateNewHp(target.stats.hp, -damage, target.stats.maxHp);

    emitHpDeltaText("monsters", targetId, target, -damage);

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
    return;
  }

  // ── SELF ─────────────────────────────────────────────────────────────
  if (spell.type === SPELL_TYPE.SELF) {
    const { heal } = calcSpellResult(spell, player.stats);
    const newHp = Math.min(
      player.stats?.maxHp ?? 100,
      (player.stats?.hp ?? 100) + heal,
    );

    emitHpDeltaText("players", playerId, player, +heal);
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
    return;
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
      emitHpDeltaText("monsters", mid, mob, -damage);
      hits.push({ id: mid, mob, newHp, damage });
    }

    // Todos os tiles do AOE em um único batchWrite — sem wave delay
    if (spell.effectId != null) {
      const radiusCeil = Math.ceil(radius);
      const fxUpdates = {};
      const tileNow = Date.now();
      // Magias com isField: true vão para world_fields (renderizado no chão).
      // Magias sem isField vão para world_effects (renderizado na camada top).
      const fxBasePath = spell.isField ? "world_fields" : "world_effects";
      for (let dx = -radiusCeil; dx <= radiusCeil; dx++) {
        for (let dy = -radiusCeil; dy <= radiusCeil; dy++) {
          if (Math.hypot(dx, dy) > radius + 0.5) continue;
          const fxId = `spell_${spellId}_${playerId}_${now}_${dx}_${dy}`;
          fxUpdates[`${fxBasePath}/${fxId}`] = _spellFx({
            id: fxId,
            effectId: spell.effectId,
            x: Math.round(player.x) + dx,
            y: Math.round(player.y) + dy,
            z,
            duration: spell.isField ? (spell.fieldDuration ?? spell.effectDuration) : spell.effectDuration,
            startTime: tileNow,
            isField: spell.isField ?? false,
            fieldDuration: spell.fieldDuration ?? 0,
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

  // ── BUFF / DEBUFF ─────────────────────────────────────────────────────
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
      if (!target || (target.stats?.hp ?? 0) <= 0) return;
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
  }
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
