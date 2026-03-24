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
  dbGet,
  applyHpToPlayer,
  applyMpToPlayer,
  syncEffect,
  encodeUser,
  PATHS,
  TILE_CHUNK_SIZE,
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
  processAttack,
  emitDamage,
  emitHeal,
  buildCombatEffectPayload,
} from "./combat/combatService.js";

import { createField } from "./magic/fieldSystem.js";
import { pushLog } from "./eventLog.js";
import { registerDamage, registerLastHit } from "./progression/xpManager.js";
import {
  getSpellPower,
  getHealPower,
} from "./progression/progressionSystem.js";

// ---------------------------------------------------------------------------
// COOLDOWNS — gerenciados aqui, não no cliente
// ---------------------------------------------------------------------------
const _cooldowns = new Map();
const _queuedActions = new Map();

// Rastreia buffs/debuffs ativos para expiração via tick (evita setTimeout perdido em crash)
const _activeBuffs = new Map();
// key: `${playerId}:${spellId}:${targetId}`, value: { expiresAt, stat, originalValue, targetType, targetId }

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

// IDs de atores privilegiados que podem executar item actions sem estar em online_players
const _PRIVILEGED_ACTOR_IDS = new Set([
  "worldengine",
  "gm",
  "gm_admin",
  "gmadmin",
  "game_master",
  "gamemaster",
]);

function _isPrivilegedActor(playerId) {
  const pid = String(playerId ?? "")
    .trim()
    .toLowerCase();
  return (
    _PRIVILEGED_ACTOR_IDS.has(pid) ||
    pid.startsWith("gm_") ||
    pid.includes("worldengine")
  );
}

async function _dispatch(actionId, action, now) {
  const { type, playerId } = action;
  if (!playerId) return;

  // Atores privilegiados (WorldEngine, GM) não existem em online_players.
  // Para ações de item, passam direto com objeto player sintético;
  // itemActions.js trata o bypass de restrições internamente.
  if (type === "item" && _isPrivilegedActor(playerId)) {
    return _processItem(action, { id: playerId, name: "WorldEngine" }, now);
  }
  if (type === "map_tile_pickup" && _isPrivilegedActor(playerId)) {
    return _processMapTilePickup(
      action,
      { id: playerId, name: "WorldEngine", x: 0, y: 0, z: 7 },
      now,
    );
  }

  const players = getPlayers();
  const playerKey = resolvePlayerKey(players, playerId);
  if (!playerKey) {
    console.warn(
      `[actionProcessor] ação descartada sem player online: type=${type} playerId=${playerId}`,
    );
    return;
  }

  const player = players[playerKey];
  if (!player) return;

  const normalizedAction =
    playerKey === playerId ? action : { ...action, playerId: playerKey };

  switch (type) {
    case "attack":
      return _processAttack(normalizedAction, player, now);
    case "spell":
      return _processSpell(normalizedAction, player, now);
    case "move":
      return _processMove(normalizedAction, player, now);
    case "map_tile_pickup":
      return _processMapTilePickup(normalizedAction, player, now);
    case "toggle_door":
      return _processToggleDoor(normalizedAction, player, now);
    case "change_floor":
      return _processChangeFloor(normalizedAction, player, now);
    case "allocateStat":
      return _processAllocateStat(normalizedAction, player, now);
    case "item":
      return _processItem(normalizedAction, player, now);
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

  // Usa o serviço autoritativo com tipos explícitos.
  const result = await processAttack({
    attackerId: playerId,
    defenderId: targetId,
    attackerType: "player",
    defenderType: "monster",
    options: { now },
  });

  if (!result?.success) {
    pushLog(
      "error",
      `${player.name} falhou ao atacar ${target.name ?? targetId}: ${result?.error ?? "erro desconhecido"}`,
    );
    return;
  }

  const fxId = `atk_${playerId}_${targetId}_${now}`;
  const fxPayload = buildCombatEffectPayload({
    effectId: result.missed ? 3 : 1,
    x: target.x,
    y: target.y,
    z: target.z ?? 7,
    duration: 700,
    startTime: now,
  });
  if (fxPayload) {
    await syncEffect(fxId, fxPayload);
  }

  if (result.missed) {
    pushLog("damage", `${player.name} errou ${target.name ?? targetId} [MISS]`);
    return;
  }

  if (result.killed && !target.dead) {
    const updates = {};
    handleMonsterDeathLocal(
      targetId,
      { ...target, stats: { ...target.stats, hp: 0 } },
      updates,
      now,
    );
    if (Object.keys(updates).length > 0) {
      await batchWrite(updates);
    }
  }

  pushLog(
    "damage",
    `${player.name} atacou ${target.name ?? targetId}: ${result.damage} HP`,
  );
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

    const baseResult = calcSpellResult(spell, player.stats, target.stats);
    const spellPower = getSpellPower(player);
    const damage =
      spellPower > 0
        ? Math.floor(baseResult.damage * (1 + spellPower / 100))
        : baseResult.damage;
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
      // Registrar dano para XP
      if (damage > 0) {
        registerDamage(targetId, playerId, damage);
        registerLastHit(targetId, playerId);
      }
      handleMonsterDeathLocal(
        targetId,
        {
          ...target,
          lastHitBy: playerId,
          stats: { ...target.stats, hp: newHp },
        },
        updates,
        now,
      );
    } else {
      // Registrar dano para XP mesmo se não matou
      if (damage > 0) {
        registerDamage(targetId, playerId, damage);
      }
      updates[`world_entities/${targetId}/stats/hp`] = newHp;
      updates[`world_entities/${targetId}/lastHitBy`] = playerId;
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
    const baseHealResult = calcSpellResult(spell, player.stats);
    const healPower = getHealPower(player);
    const heal =
      healPower > 0
        ? Math.floor(baseHealResult.heal * (1 + healPower / 100))
        : baseHealResult.heal;
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
    const fxUpdates = {};
    const aoeSpellPower = getSpellPower(player);

    for (const [mid, mob] of Object.entries(monsters)) {
      if (!mob || (mob.stats?.hp ?? 0) <= 0 || mob.dead) continue;
      if ((mob.z ?? 7) !== z) continue;
      if (Math.hypot(mob.x - player.x, mob.y - player.y) > radius + 0.5)
        continue;

      const aoeBase = calcSpellResult(spell, player.stats, mob.stats);
      const damage =
        aoeSpellPower > 0
          ? Math.floor(aoeBase.damage * (1 + aoeSpellPower / 100))
          : aoeBase.damage;
      const newHp = calculateNewHp(mob.stats.hp, -damage, mob.stats.maxHp);

      emitDamage(mid, "monsters", damage, mob, {
        attackerId: playerId,
        spellId,
      });
      // Registrar dano para XP
      if (damage > 0) {
        registerDamage(mid, playerId, damage);
      }
      hits.push({ id: mid, mob, newHp, damage });
    }

    if (spell.effectId) {
      const radiusCeil = Math.ceil(radius);
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
    }

    const dmgUpdates = {};
    for (const { id, mob, newHp } of hits) {
      if (newHp <= 0 && !mob.dead) {
        // Registrar último hit para XP
        registerLastHit(id, playerId);
        handleMonsterDeathLocal(
          id,
          { ...mob, lastHitBy: playerId, stats: { ...mob.stats, hp: newHp } },
          dmgUpdates,
          now,
        );
      } else {
        dmgUpdates[`world_entities/${id}/stats/hp`] = newHp;
        dmgUpdates[`world_entities/${id}/lastHitBy`] = playerId;
      }
    }

    const combinedUpdates = { ...fxUpdates, ...dmgUpdates };
    if (Object.keys(combinedUpdates).length > 0) {
      await batchWrite(combinedUpdates);
    }
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
      // Registra buff para expiração no próximo tick que passar do prazo
      _activeBuffs.set(`${playerId}:${spellId}:self`, {
        expiresAt: (now ?? Date.now()) + (spell.duration ?? 5000),
        stat,
        originalValue: current,
        targetType: "player",
        targetId: playerId,
      });
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
      _activeBuffs.set(`${playerId}:${spellId}:${targetId}`, {
        expiresAt: (now ?? Date.now()) + (spell.duration ?? 5000),
        stat,
        originalValue: current,
        targetType: "monster",
        targetId,
      });
    }
    pushLog("system", `${player.name} usou ${spell.name}`);
  }
}

// =============================================================================
// ADICIONAR NOVA FUNÇÃO (após _processSpell)
// =============================================================================

// ---------------------------------------------------------------------------
// EXPIRAÇÃO DE BUFFS
// ---------------------------------------------------------------------------
export async function tickExpiredBuffs(now = Date.now()) {
  if (_activeBuffs.size === 0) return;

  for (const [key, buff] of _activeBuffs.entries()) {
    if (now < buff.expiresAt) continue;
    _activeBuffs.delete(key);

    const updates = {};
    if (buff.targetType === "player") {
      updates[`${PATHS.playerDataStats(buff.targetId)}/${buff.stat}`] =
        buff.originalValue;
      updates[`${PATHS.playerStats(buff.targetId)}/${buff.stat}`] =
        buff.originalValue;
    } else {
      updates[`world_entities/${buff.targetId}/stats/${buff.stat}`] =
        buff.originalValue;
    }

    if (Object.keys(updates).length > 0) {
      await batchWrite(updates).catch((e) =>
        console.error("[tickExpiredBuffs] Erro ao reverter buff:", e),
      );
    }
  }
}

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
// VALIDAÇÃO DE ITENS — ItemMoveValidator (instância lazy, import dinâmico)
// ---------------------------------------------------------------------------
let _itemMoveValidator = null;

/**
 * Converte o formato legado de ação de item para o formato do ItemMoveValidator.
 * @param {Object} src - payload da ação legada
 * @param {string} playerId
 * @returns {{ from: Object, to: Object, count?: number } | null}
 */
function _buildMovePayload(src, playerId) {
  const { itemAction, slotIndex, toSlot, worldItemId, equipSlot, quantity } =
    src;

  switch (itemAction) {
    case "drop":
      return {
        from: { type: "inventory", slotIndex },
        to: { type: "map", position: { x: src.toX, y: src.toY, z: src.toZ } },
        count: quantity ?? null,
      };
    case "moveWorld":
      return {
        from: { type: "world", itemId: worldItemId },
        to: { type: "map", position: { x: src.toX, y: src.toY, z: src.toZ } },
        count: quantity ?? null,
      };
    case "pickUp":
      return {
        from: { type: "world", itemId: worldItemId },
        to: { type: "inventory" },
        count: null,
      };
    case "equip":
      return {
        from: { type: "inventory", slotIndex },
        to: { type: "equipment", slotId: equipSlot },
        count: null,
      };
    case "unequip":
      return {
        from: { type: "equipment", slotId: equipSlot },
        to: { type: "inventory", slotIndex: slotIndex ?? undefined },
        count: null,
      };
    case "move":
      return {
        from: { type: "inventory", slotIndex },
        to: { type: "inventory", slotIndex: toSlot },
        count: null,
      };
    default:
      return null; // use, splitWorld, etc. — não passam pelo validator por enquanto
  }
}

// ---------------------------------------------------------------------------
// AÇÕES DE ITEM
// ---------------------------------------------------------------------------
async function _processItem(action, player, now) {
  // payload pode vir aninhado (via WorldEngineInterface: { type, payload:{...} })
  // ou na raiz (código legado / chamadas internas diretas).
  const src =
    action.payload && typeof action.payload === "object"
      ? action.payload
      : action;

  const playerId = action.playerId ?? src.playerId;
  const itemAction = src.itemAction;
  const slotIndex = src.slotIndex;
  const toSlot = src.toSlot;
  const worldItemId = src.worldItemId;
  const equipSlot = src.equipSlot;
  const quantity = src.quantity;
  // ID gerado pelo DragDropManager — permite emitir ACTION_CONFIRMED/REJECTED
  const clientActionId = src.actionId ?? null;

  const {
    pickUpItem,
    dropItem,
    moveWorldItem,
    splitWorldItem,
    equipItem,
    unequipItem,
    moveItem,
    useItem,
  } = await import("./items/itemActions.js");

  // ── Validação via ItemMoveValidator (server-authoritative) ────────────────
  // Ações que têm payload mapeável passam pelo validator antes de executar.
  // Ações sem mapeamento (use, splitWorld) seguem pelo caminho legado.
  const movePayload = _buildMovePayload(src, playerId);
  if (movePayload) {
    const { ItemMoveValidator } =
      await import("../server/worldEngine/validators/ItemMoveValidator.js");
    if (!_itemMoveValidator) _itemMoveValidator = new ItemMoveValidator();

    const validationResult = await _itemMoveValidator.validate({
      playerId,
      type: "MOVE_ITEM",
      payload: movePayload,
    });

    if (!validationResult.ok) {
      pushLog(
        "error",
        `[${player.name ?? playerId}] ${itemAction} negado: ${validationResult.userMessage}`,
      );
      if (clientActionId) {
        worldEvents.emit(EVENT_TYPES.ACTION_REJECTED, {
          actionId: clientActionId,
          playerId,
          itemAction,
          reason: validationResult.code,
          userMessage: validationResult.userMessage,
        });
      }
      return { success: false, error: validationResult.code };
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  let result;
  switch (itemAction) {
    case "pickUp":
      result = await pickUpItem(playerId, worldItemId);
      break;
    case "drop":
      result = await dropItem(
        playerId,
        slotIndex,
        quantity ?? null,
        src.toX,
        src.toY,
        src.toZ,
      );
      break;
    case "moveWorld":
      result = await moveWorldItem(
        playerId,
        worldItemId,
        src.toX,
        src.toY,
        src.toZ,
      );
      break;
    case "splitWorld":
      result = await splitWorldItem(
        playerId,
        worldItemId,
        src.splitQty ?? 1,
        src.toX,
        src.toY,
        src.toZ,
      );
      break;
    case "equip":
      result = await equipItem(playerId, slotIndex);
      break;
    case "unequip":
      result = await unequipItem(playerId, equipSlot, slotIndex ?? null);
      break;
    case "move":
      result = await moveItem(playerId, slotIndex, toSlot);
      break;
    case "use":
      result = await useItem(playerId, slotIndex);
      break;
    default:
      result = {
        success: false,
        error: `itemAction desconhecido: ${itemAction}`,
      };
  }

  if (!result?.success) {
    pushLog(
      "error",
      `[${player.name}] item/${itemAction} falhou: ${result?.error ?? "erro"}`,
    );
  }

  // Notifica o DragDropManager sobre confirmação ou rejeição da ação.
  if (clientActionId) {
    if (result?.success) {
      worldEvents.emit(EVENT_TYPES.ACTION_CONFIRMED, {
        actionId: clientActionId,
        playerId,
        itemAction,
      });
    } else {
      worldEvents.emit(EVENT_TYPES.ACTION_REJECTED, {
        actionId: clientActionId,
        playerId,
        itemAction,
        reason: result?.error ?? "erro desconhecido",
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// MOVIMENTO — validado server-side
// ---------------------------------------------------------------------------
async function _processMove(action, player, now) {
  const { playerId, x, y, z, direcao } = action;

  const speedMs = Math.max(100, Math.floor(40000 / (player.speed ?? 120)));
  if (_isOnCooldown(playerId, "move")) return;
  _setCooldown(playerId, "move", speedMs);

  const dx = Math.abs(x - (player.x ?? 0));
  const dy = Math.abs(y - (player.y ?? 0));
  if (dx > 1 || dy > 1) {
    pushLog(
      "error",
      `[${player.name}] movimento inválido: delta (${dx},${dy})`,
    );
    return;
  }

  if (z !== undefined && Math.abs(z - (player.z ?? 7)) > 1) {
    pushLog("error", `[${player.name}] mudança de andar inválida`);
    return;
  }

  await batchWrite({
    [`${PATHS.playerData(playerId)}/x`]: x,
    [`${PATHS.playerData(playerId)}/y`]: y,
    [`${PATHS.playerData(playerId)}/z`]: z ?? player.z ?? 7,
    [`${PATHS.playerData(playerId)}/direcao`]: direcao ?? "frente",
    [`${PATHS.playerData(playerId)}/lastMoveTime`]: now,
    [`${PATHS.player(playerId)}/x`]: x,
    [`${PATHS.player(playerId)}/y`]: y,
    [`${PATHS.player(playerId)}/z`]: z ?? player.z ?? 7,
    [`${PATHS.player(playerId)}/direcao`]: direcao ?? "frente",
    [`${PATHS.player(playerId)}/lastMoveTime`]: now,
  });
}

// ---------------------------------------------------------------------------
// MAP TILE PICKUP — converte tile do mapa em item via worldEngine
// ---------------------------------------------------------------------------
async function _processMapTilePickup(action, player, now) {
  const { playerId, coord, tileId, mapLayer } = action;
  if (!coord || !tileId || mapLayer == null) return;

  const [tx, ty, tz] = String(coord).split(",").map(Number);
  if (isNaN(tx) || isNaN(ty) || isNaN(tz)) return;

  const bypassRangeCheck =
    _isPrivilegedActor(playerId) || _isPrivilegedActor(player?.id);
  const dist = Math.max(
    Math.abs(tx - Number(player?.x ?? tx)),
    Math.abs(ty - Number(player?.y ?? ty)),
  );
  if (!bypassRangeCheck && (dist > 1 || tz !== Number(player?.z ?? tz))) {
    pushLog("error", `[${player.name}] tentou pegar tile fora de alcance`);
    return;
  }

  const tileCountRaw = Number(
    action.tileCount ?? action.quantity ?? action.count ?? 1,
  );
  const tileCount =
    Number.isFinite(tileCountRaw) && tileCountRaw > 0
      ? Math.max(1, Math.floor(tileCountRaw))
      : 1;
  const stackable = Boolean(action.stackable);
  const normalizedQty = stackable ? tileCount : 1;
  const normalizedMaxStackRaw = Number(action.maxStack);
  const normalizedMaxStack =
    Number.isFinite(normalizedMaxStackRaw) && normalizedMaxStackRaw > 0
      ? Math.max(1, Math.floor(normalizedMaxStackRaw))
      : stackable
        ? 99
        : 1;
  const contentType = action.content_type ?? action.contentType ?? null;

  const tempId =
    action.clientTempId ??
    `maptile_${String(coord).replace(/,/g, "_")}_${tileId}_${now}`;
  await batchWrite({
    [`world_items/${tempId}`]: {
      id: tempId,
      tileId: Number(tileId),
      x: tx,
      y: ty,
      z: tz,
      type: "material",
      quantity: normalizedQty,
      count: normalizedQty,
      stackable,
      maxStack: normalizedMaxStack,
      ...(contentType != null ? { content_type: contentType } : {}),
      fromMap: true,
      sourceCoord: coord,
      sourceLayer: Number(mapLayer),
      sourceTileId: Number(tileId),
      sourceTileCount: tileCount,
      skipRangeCheck: false,
      expiresAt: now + 60_000,
    },
  });
}

// ---------------------------------------------------------------------------
// TOGGLE DOOR — persiste troca de tile via evento
// ---------------------------------------------------------------------------
async function _processToggleDoor(action, player, now) {
  const { playerId, target, fromId, toId } = action;
  if (!target || fromId == null || toId == null) return;

  const x = Number(target.x);
  const y = Number(target.y);
  const z = Number(target.z);
  const fromIdNum = Number(fromId);
  const toIdNum = Number(toId);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(fromIdNum) ||
    !Number.isFinite(toIdNum)
  ) {
    return;
  }

  const dist = Math.max(
    Math.abs(x - Number(player.x ?? x)),
    Math.abs(y - Number(player.y ?? y)),
  );
  if (dist > 1 || z !== Number(player.z ?? z)) {
    pushLog("error", `[${player.name}] porta fora de alcance`);
    return;
  }

  if (_isOnCooldown(playerId, "toggle_door")) return;
  _setCooldown(playerId, "toggle_door", 500);

  const chunkX = Math.floor(x / TILE_CHUNK_SIZE);
  const chunkY = Math.floor(y / TILE_CHUNK_SIZE);
  const tileXY = `${x},${y}`;
  const chunkPath = `${PATHS.tiles}/${z}/${chunkX},${chunkY}`;

  const chunkData = await dbGet(chunkPath);
  if (!chunkData || typeof chunkData !== "object") {
    pushLog("error", `[${player.name}] chunk da porta nao encontrado`);
    return;
  }

  const tileData = chunkData[tileXY];
  if (!tileData || typeof tileData !== "object") {
    pushLog("error", `[${player.name}] tile da porta nao encontrado`);
    return;
  }

  const tileClone = { ...tileData };
  let replaced = false;

  for (const [layerKey, layer] of Object.entries(tileClone)) {
    if (!Array.isArray(layer)) continue;

    tileClone[layerKey] = layer.map((entry) => {
      if (typeof entry === "object" && entry !== null) {
        const currentEntryId = Number(
          entry.id ?? entry.itemid ?? entry.itemId ?? entry.tileId,
        );
        if (currentEntryId === fromIdNum) {
          replaced = true;
          if (entry.id != null) return { ...entry, id: toIdNum };
          if (entry.itemid != null) return { ...entry, itemid: toIdNum };
          if (entry.itemId != null) return { ...entry, itemId: toIdNum };
          if (entry.tileId != null) return { ...entry, tileId: toIdNum };
          return { ...entry, id: toIdNum };
        }
        return entry;
      }

      const value = Number(entry);
      if (value === fromIdNum) {
        replaced = true;
        return toIdNum;
      }
      return entry;
    });
  }

  if (!replaced) {
    pushLog(
      "error",
      `[${player.name}] porta ${fromIdNum} nao encontrada no tile ${x},${y},${z}`,
    );
    return;
  }

  await batchWrite({
    [`${chunkPath}/${tileXY}`]: tileClone,
  });

  worldEvents.emit(EVENT_TYPES.DOOR_TOGGLED, {
    x,
    y,
    z,
    fromId: fromIdNum,
    toId: toIdNum,
    playerId,
    timestamp: now,
  });

  pushLog(
    "system",
    `[${player.name}] alternou porta ${fromIdNum}->${toIdNum} em ${x},${y}`,
  );
}

// ---------------------------------------------------------------------------
// CHANGE FLOOR — valida e persiste mudança de andar
// ---------------------------------------------------------------------------
async function _processChangeFloor(action, player, now) {
  const { playerId, fromZ, toZ } = action;
  if (fromZ == null || toZ == null) return;

  if (Math.abs(toZ - fromZ) !== 1) {
    pushLog(
      "error",
      `[${player.name}] mudança de andar inválida: ${fromZ} → ${toZ}`,
    );
    return;
  }

  if (_isOnCooldown(playerId, "change_floor")) return;
  _setCooldown(playerId, "change_floor", 600);

  await batchWrite({
    [`${PATHS.playerData(playerId)}/z`]: toZ,
    [`${PATHS.playerData(playerId)}/lastMoveTime`]: now,
    [`${PATHS.player(playerId)}/z`]: toZ,
    [`${PATHS.player(playerId)}/lastMoveTime`]: now,
  });

  pushLog("system", `[${player.name}] mudou de andar: Z${fromZ} → Z${toZ}`);
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
