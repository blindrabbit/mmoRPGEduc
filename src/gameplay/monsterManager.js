// =============================================================================
// monsterManager.js — mmoRPGGame  [FASE IMEDIATA — refatorado]
// Orquestrador de IA: lê worldStore, decide via monsterAI/combatLogic,
// escreve no Firebase via db.js.
//
// MUDANÇAS DESTA FASE:
//   ❌ import { dbUpdate } from './firebaseClient.js'
//   ✅ import { batchWrite, applyHpToPlayer, respawnPlayer,
//               syncEffect, syncField, removeMonster, removeEffect,
//               PATHS } from './db.js'
//
//   ❌ await dbUpdate({ 'players_data/id/stats': {...}, 'online_players/id/stats': {...} })
//   ✅ await applyHpToPlayer(id, newHp)
//
//   ❌ await dbUpdate({ 'players_data/id': {...}, 'online_players/id': {...}, ... })
//   ✅ await respawnPlayer(id, { x, y, z, hp })
// =============================================================================

// ✅ FASE IMEDIATA: só db.js, zero firebaseClient direto
import {
  batchWrite,
  dbRemove,
  applyHpToPlayer,
  respawnPlayer,
  PATHS,
} from "../core/db.js";

import { MONSTER_TEMPLATES } from "./monsterData.js";
import {
  calculateCombatResult,
  calculateFinalDamage,
  calculateNewHp,
} from "./combatLogic.js";
import { buildCombatEffectPayload } from "./combatEngine.js";
import { worldEvents, EVENT_TYPES } from "../core/events.js";
import {
  findTarget,
  decideMoveTo,
  decideMoveBFS,
  decideWander,
  isTileBlocked,
  hasDangerousField,
  hasSpellLOS,
  selectAttack,
  getLookAtDirection,
  parseShape,
} from "./monsterAI.js";
import {
  buildFieldPayload,
  buildFieldEffectFallbackPayload,
} from "./fieldPayload.js";
import {
  resolveStatusEffectId,
  normalizeMonsterAttackAbility,
  ABILITY_KIND,
} from "./abilityCore.js";
import { buildStatusEffectVisualPayload } from "./abilityEngine.js";
import {
  getMonsterAttackCooldownKey,
  normalizeCombatCooldownMs,
} from "./combatScheduler.js";
import {
  calculateTotalStats,
  getDefense,
} from "./progression/progressionSystem.js";
import { pushLog } from "./eventLog.js";
import {
  getMonsters,
  getPlayers,
  getFields,
  applyMonstersLocal,
  removeMonsterLocal,
} from "../core/worldStore.js";

import { distributeXpOnDeath } from "./progression/xpManager.js";
import { getLastHitter } from "./progression/xpManager.js";
// ---------------------------------------------------------------------------
// ESTADO INTERNO
// ---------------------------------------------------------------------------
let map = {};
let nexoData = {};
const processingAttack = new Set();
const processingPlayerDeath = new Set();
const AI_INTERVAL = 300; // ms mínimo entre decisões por monstro
const PLAYER_CORPSE_DURATION = 1800;
const PLAYER_CORPSE_PACK = "monstros_01";
const PLAYER_CORPSE_FRAMES = ["497", "497", "497"];
const PLAYER_CORPSE_ITEM_IDS = [
  1112, 1113, 1114, 1116, 3699, 3700, 4515, 4516, 4517, 4518, 4519, 4520, 4521,
  4522, 4523, 4524, 4525, 4526, 4527, 4528, 4529, 4530, 4597, 4598, 4599, 4600,
  4601, 4602, 4609, 4610, 4611, 4612, 4613, 4614, 4633, 4634, 4635, 4636, 4637,
  4638, 4639, 4640, 4641, 4642, 4643, 4644, 7761, 9587, 25307, 25310, 26995,
];
const MAX_CORPSE_LINGER_MS = 2000;

function stableHash(str) {
  const text = String(str ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

function pickPlayerCorpseItemId(target) {
  if (Number.isFinite(Number(target?.corpseItemId))) {
    return Number(target.corpseItemId);
  }

  const custom = Array.isArray(target?.corpseItemIds)
    ? target.corpseItemIds.map(Number).filter(Number.isFinite)
    : [];
  const pool = custom.length ? custom : PLAYER_CORPSE_ITEM_IDS;
  if (!pool.length) return null;

  const outfit = target?.appearance?.outfitId;
  const playerClass = target?.class;
  const key =
    outfit != null
      ? `outfit:${outfit}`
      : playerClass
        ? `class:${playerClass}`
        : `player:${target?.id ?? "unknown"}`;

  return pool[stableHash(key) % pool.length];
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
export function initMonsterManager(worldMap, worldNexoData) {
  map = worldMap;
  nexoData = worldNexoData ?? {};
  const nexoCount = Object.keys(nexoData).length;
  const mapCount = Object.keys(map).length;
  const blocked =
    nexoCount > 0
      ? Object.values(nexoData).filter(
          (d) => d?.flags?.bank?.waypoints === 0 || d?.flags?.unreadable,
        ).length
      : 0;
  console.log(
    `[MonsterManager] init  mapa=${mapCount} tiles  nexoData=${nexoCount} sprites  bloqueáveis=${blocked}`,
  );
}

// ---------------------------------------------------------------------------
// HELPERS DE UPDATE (exportados para actionProcessor)
// ---------------------------------------------------------------------------
export function mergeUpdate(updates, path, obj) {
  for (const [key, val] of Object.entries(obj)) {
    updates[`${path}/${key}`] = val;
  }
}

// Atualiza estado local no store E agenda escrita no Firebase
export function applyToMob(id, obj, updates) {
  applyMonstersLocal(id, obj); // store central
  mergeUpdate(updates, `${PATHS.monsters}/${id}`, obj); // Firebase batch
}

// ---------------------------------------------------------------------------
// TICK PRINCIPAL — IA em batch com throttling
// ---------------------------------------------------------------------------
export async function tickMonsters({
  now = Date.now(),
  allowCombat = false,
} = {}) {
  const updates = {};
  const monsters = getMonsters(); // snapshot do store

  for (const id in monsters) {
    const mob = monsters[id];
    if (!mob || mob.type !== "monster") continue;

    // Throttling de IA por monstro — lê estado local atualizado
    if (now - (mob.lastAiTick ?? 0) < AI_INTERVAL) continue;
    applyToMob(id, { lastAiTick: now }, updates);

    // Morte: HP zerado e ainda não processado
    if ((mob.stats?.hp ?? 1) <= 0 && !mob.dead) {
      handleMonsterDeathLocal(id, mob, updates, now);
      continue;
    }
    if (mob.dead) continue;

    // Garante corpseFrames/respawnDelay no nó do monstro apenas uma vez
    const template = MONSTER_TEMPLATES[mob.species];
    if (template && !mob.corpseFrames) {
      mergeUpdate(updates, `${PATHS.monsters}/${id}`, {
        corpseFrames: template.corpseFrames ?? [496, 497],
        corpseDuration: template.corpseDuration ?? 6000,
        respawnDelay: template.respawnDelay ?? 30000,
      });
    }

    await processAI(id, mob, now, updates, { allowCombat });
  }

  // 1 única escrita para todas as mudanças do tick
  if (Object.keys(updates).length > 0) await batchWrite(updates);
}

// ---------------------------------------------------------------------------
// MORTE DE MONSTRO (exportada para actionProcessor usar)
// ---------------------------------------------------------------------------
// SUBSTITUIR a função handleMonsterDeathLocal existente por:
export async function handleMonsterDeathLocal(
  monsterId,
  monster,
  updates,
  now,
) {
  // Reflete morte no cache local imediatamente para IA/render não bloquearem o SQM.
  applyMonstersLocal(monsterId, {
    dead: true,
    stats: { ...(monster?.stats ?? {}), hp: 0 },
    diedAt: now,
  });

  // Marcar como morto
  updates[`${PATHS.monster(monsterId)}/dead`] = true;
  updates[`${PATHS.monster(monsterId)}/stats/hp`] = 0;

  // Registrar tempo de morte para respawn
  updates[`${PATHS.monster(monsterId)}/diedAt`] = now;

  // Remove o nó morto em janela curta para não manter colisão/fantasma por muito tempo.
  setTimeout(async () => {
    const monsters = getMonsters();
    const latest = monsters?.[monsterId];
    if (latest && !latest.dead) return;

    try {
      await dbRemove(PATHS.monster(monsterId));
    } catch (error) {
      console.error("[monsterManager] Erro ao remover monstro morto:", error);
    } finally {
      removeMonsterLocal(monsterId);
    }
  }, MAX_CORPSE_LINGER_MS);

  // ✅ DISTRIBUIR XP PARA JOGADORES (INTEGRAÇÃO REAL)
  // Obtém killer ID dos dados de dano registrados em xpManager.
  const killerId = getLastHitter(monsterId) ?? monster?.lastHitBy ?? null;
  // Não bloqueia distribuição só porque o killerId não foi resolvido no primeiro lookup.
  setTimeout(async () => {
    try {
      const latestMonster = getMonsters()?.[monsterId] ?? monster;
      const resolvedKillerId =
        getLastHitter(monsterId) ??
        latestMonster?.lastHitBy ??
        monster?.lastHitBy ??
        killerId ??
        null;
      await distributeXpOnDeath(monsterId, latestMonster, resolvedKillerId);
    } catch (error) {
      console.error("[monsterManager] Erro ao distribuir XP:", error);
    }
  }, 60);

  // Emitir evento de morte para clientes
  worldEvents.emit(EVENT_TYPES.COMBAT_KILL, {
    defenderId: monsterId,
    defenderType: "monster",
    killerId,
    xpValue: monster.stats?.xpValue ?? 10,
    timestamp: now,
  });

  pushLog("kill", `${monster.name ?? monsterId} foi derrotado`);
}

// ---------------------------------------------------------------------------
// INTELIGÊNCIA ARTIFICIAL
// ---------------------------------------------------------------------------
async function processAI(id, mob, now, updates, { allowCombat = false } = {}) {
  const template = MONSTER_TEMPLATES[mob.species];
  if (!template) return;

  const behavior = { range: 7, loseAggro: 10, ...template.behavior };
  const players = getPlayers();
  const monsters = getMonsters();
  const fields = getFields();
  const mobImmunities = template?.immunities ?? [];

  const target = findTarget(mob, players, behavior.range);

  if (target) {
    const dist = Math.hypot(target.x - mob.x, target.y - mob.y);

    // Look-at: rotaciona para o alvo
    const newDir = getLookAtDirection(mob, target);
    if (newDir !== mob.direcao) {
      applyToMob(id, { direcao: newDir }, updates);
    }

    // Seleção e execução de ataque
    const atk = allowCombat
      ? selectAttack(mob, template.attacks ?? [], dist, now)
      : null;
    if (window.DEBUG_AI) {
      const tag = `[AI:${mob.name ?? id}]`;
      console.log(
        `${tag} alvo=${target.id} dist=${dist.toFixed(2)} dir=${mob.direcao}`,
      );
      if (!atk) {
        // Diagnóstico: por que nenhum ataque foi selecionado?
        const attacks = template.attacks ?? [];
        const byRange = attacks.filter((a) => dist <= (a.range ?? 1) + 0.5);
        const byCd = byRange.filter((a) => {
          const k = getMonsterAttackCooldownKey(a.name);
          return (
            now - (mob[k] ?? 0) >= normalizeCombatCooldownMs(a.cooldown ?? 0)
          );
        });
        console.log(
          `${tag} atk=null | totalAtaques=${attacks.length} noAlcance=${byRange.length} semCooldown=${byCd.length}`,
        );
        byRange.forEach((a) => {
          const k = getMonsterAttackCooldownKey(a.name);
          const elapsed = now - (mob[k] ?? 0);
          const cooldownMs = normalizeCombatCooldownMs(a.cooldown ?? 0);
          const ready = elapsed >= cooldownMs;
          console.log(
            `${tag}   └─ "${a.name}" range=${a.range} cd=${cooldownMs}ms decorrido=${elapsed}ms pronto=${ready}`,
          );
        });
      } else {
        console.log(
          `${tag} ataque selecionado="${atk.name}" type=${atk.type} range=${atk.range}`,
        );
      }
      if (processingAttack.has(id)) {
        console.warn(
          `${tag} BLOQUEADO por processingAttack (ataque ainda em execução)`,
        );
      }
    }
    if (atk && !processingAttack.has(id)) {
      processingAttack.add(id);
      await executeAttack(id, mob, target, atk, updates, now);
      processingAttack.delete(id);
    }

    // Perseguição
    const stepDuration = calcStep(
      mob.speed ?? template.appearance?.speed ?? 80,
    );
    if (now - (mob.lastMoveTime ?? 0) > stepDuration && dist > 1) {
      const move = decideMoveTo(
        mob,
        Math.round(target.x),
        Math.round(target.y),
      );
      const z = mob.z ?? 7;

      if (
        !isTileBlocked(
          move.nx,
          move.ny,
          z,
          map,
          monsters,
          players,
          id,
          nexoData,
        ) &&
        !hasDangerousField(move.nx, move.ny, z, fields, mobImmunities)
      ) {
        // Caminho direto livre
        applyToMob(
          id,
          { x: move.nx, y: move.ny, direcao: move.direcao, lastMoveTime: now },
          updates,
        );
      } else {
        // Caminho direto bloqueado — usa BFS ciente de entidades e campos
        const bfs = decideMoveBFS(
          mob,
          Math.round(target.x),
          Math.round(target.y),
          z,
          map,
          nexoData,
          monsters,
          players,
          fields,
          mobImmunities,
        );
        if (bfs) {
          applyToMob(
            id,
            { x: bfs.nx, y: bfs.ny, direcao: bfs.direcao, lastMoveTime: now },
            updates,
          );
        }
        // Se BFS não encontrou caminho, o monstro simplesmente aguarda o próximo tick
      }
    }
  } else {
    // Wander aleatório
    const stepDuration = calcStep(
      mob.speed ?? template.appearance?.speed ?? 80,
    );
    if (now - (mob.lastMoveTime ?? 0) > stepDuration) {
      const w = decideWander(mob);
      if (
        w &&
        !isTileBlocked(
          w.nx,
          w.ny,
          mob.z ?? 7,
          map,
          getMonsters(),
          players,
          id,
          nexoData,
        ) &&
        !hasDangerousField(w.nx, w.ny, mob.z ?? 7, fields, mobImmunities)
      ) {
        applyToMob(
          id,
          { x: w.nx, y: w.ny, direcao: w.direcao, lastMoveTime: now },
          updates,
        );
      }
    }
  }
}

function calcStep(speed) {
  return Math.round(32000 / Math.max(1, Number(speed)));
}

// ---------------------------------------------------------------------------
// EXECUÇÃO DE ATAQUE
// ---------------------------------------------------------------------------
async function executeAttack(id, mob, target, attack, updates, now) {
  const ability = normalizeMonsterAttackAbility(attack, {
    monsterSpecies: mob.species,
  });
  if (!ability) return;

  const cdKey = getMonsterAttackCooldownKey(ability.name);

  // Registra cooldown no store E no Firebase imediatamente
  applyToMob(id, { lastAttack: now, [cdKey]: now }, updates);

  // Ataque de área
  if (ability.kind === ABILITY_KIND.AREA && ability.shape) {
    const coords = parseShape(ability.shape, mob.direcao);
    const mz = mob.z ?? 7;
    const mx = Math.round(mob.x);
    const my = Math.round(mob.y);
    const players = getPlayers();

    if (window.DEBUG_AI) {
      const tag = `[AI:${mob.name ?? id}]`;
      console.log(
        `${tag} executeAttack AREA "${ability.name}" | dir=${mob.direcao} tiles=${coords.length} isPersistent=${!!ability.visuals.isPersistent}`,
      );
      console.log(
        `${tag}   coordenadas:`,
        coords.map(([x, y]) => `(${mx + x},${my + y})`).join(" "),
      );
    }

    for (const [relX, relY] of coords) {
      const tx = mx + relX;
      const ty = my + relY;
      const tz = mz;
      const baseId = `f${tx}${ty}${tz}`;
      const effectId = ability.visuals.isPersistent ? baseId : `${baseId}wave`;

      // Filtro LOS: não atravessa paredes
      if (!hasSpellLOS(mx, my, tx, ty, tz, map, nexoData)) continue;

      if (ability.visuals.isPersistent) {
        mergeUpdate(
          updates,
          `${PATHS.fields}/${baseId}`,
          buildFieldPayload({
            id: baseId,
            x: tx,
            y: ty,
            z: tz,
            now,
            damage: ability.damage,
            fieldId: ability.visuals.fieldId,
            effectId: ability.visuals.effectId,
            fieldDuration: ability.visuals.fieldDuration ?? 5000,
            tickRate: ability.raw?.tickRate ?? 1000,
            statusType: ability.statusType ?? null,
          }),
        );

        // Espelha em world_effects para compatibilidade entre clientes.
        mergeUpdate(
          updates,
          `${PATHS.effects}/${baseId}`,
          buildFieldEffectFallbackPayload({
            x: tx,
            y: ty,
            z: tz,
            now,
            isPersistent: true,
            isField: true,
            fieldDuration: ability.visuals.fieldDuration ?? 5000,
            effectDuration: ability.visuals.effectDuration ?? 1200,
            effectId: resolveStatusEffectId(
              ability.statusType,
              ability.visuals.effectId,
            ),
          }),
        );
      }

      if (!ability.visuals.isField || !ability.visuals.isPersistent) {
        mergeUpdate(
          updates,
          `${PATHS.effects}/${effectId}`,
          buildFieldEffectFallbackPayload({
            x: tx,
            y: ty,
            z: tz,
            now,
            isPersistent: ability.visuals.isPersistent,
            isField: false,
            fieldDuration: ability.visuals.fieldDuration ?? 5000,
            effectDuration: ability.visuals.effectDuration ?? 1200,
            effectId: Number(
              ability.visuals.effectId ??
                (ability.visuals.isPersistent ? 2 : 1),
            ),
          }),
        );
      }

      // Dano direto: ataques de área não-persistentes causam dano imediato
      // (ex: Onda de Fogo — efeito visual + dano instantâneo, sem campo residual)
      if (!ability.visuals.isPersistent && (ability.damage ?? 0) > 0) {
        for (const pid in players) {
          const p = players[pid];
          if (!p?.stats?.hp || !p.id) continue;
          if (
            Math.round(p.x) === tx &&
            Math.round(p.y) === ty &&
            (p.z ?? 7) === tz
          ) {
            const newHp = Math.max(0, p.stats.hp - ability.damage);
            worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
              defenderId: pid,
              defenderType: "players",
              damage: Math.abs(ability.damage),
              defenderX: p.x,
              defenderY: p.y,
              defenderZ: p.z ?? 7,
            });
            await applyHpToPlayer(pid, newHp);
            pushLog(
              "damage",
              `${mob.name} causou ${ability.damage} em ${p.name ?? pid} [${ability.name}] HP ${newHp}/${p.stats.maxHp ?? "?"}`,
            );
            if (newHp <= 0) await handlePlayerDeath(p, mob);
          }
        }
      }
    }

    pushLog(
      "field",
      `${mob.name} usou ${ability.name}`,
      mob.x,
      mob.y,
      `z${mob.z ?? 7}`,
    );
    return;
  }

  // Ataque físico direto
  if (window.DEBUG_AI) {
    console.log(
      `[AI:${mob.name ?? id}] executeAttack MELEE "${ability.name}" | alvo=${target?.id} hp=${target?.stats?.hp}`,
    );
    if (!target?.stats?.hp || !target?.id) {
      console.warn(
        `[AI:${mob.name ?? id}] ABORTADO — target sem stats (race condition Firebase)`,
        target,
      );
    }
  }
  // Guard: alvo sem stats ainda sincronizados (race condition Firebase)
  if (!target?.stats?.hp || !target?.id) return;

  const targetTotals = calculateTotalStats(target);
  const combatResult = calculateCombatResult(
    {
      atk: mob.stats?.atk ?? MONSTER_TEMPLATES[mob.species]?.stats?.atk ?? 10,
      attackPower:
        mob.stats?.atk ?? MONSTER_TEMPLATES[mob.species]?.stats?.atk ?? 10,
      agi: mob.stats?.agi ?? mob.stats?.AGI ?? 5,
      agility: mob.stats?.AGI ?? mob.stats?.agi ?? 5,
      level: mob.stats?.level ?? 1,
    },
    {
      def: target.stats?.def ?? 0,
      defense: getDefense(target, target.stats?.def ?? 0),
      agi: targetTotals.totalStats.AGI,
      agility: targetTotals.totalStats.AGI,
      level: target.stats?.level ?? 1,
    },
  );

  if (combatResult.hit) {
    const dmg = calculateFinalDamage(ability.damage ?? 0, combatResult);
    const newHp = calculateNewHp(target.stats.hp, -dmg, target.stats.maxHp);
    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      defenderId: target.id,
      defenderType: "players",
      damage: Math.abs(dmg),
      defenderX: target.x,
      defenderY: target.y,
      defenderZ: target.z ?? 7,
    });
    const hitFxId = `hit_${id}_${target.id}_${now}`;
    const hitFx = buildCombatEffectPayload("attackHit", {
      id: hitFxId,
      x: target.x,
      y: target.y,
      z: target.z ?? 7,
      now,
    });
    if (hitFx) {
      mergeUpdate(updates, `${PATHS.effects}/${hitFxId}`, hitFx);
    }

    // ✅ applyHpToPlayer substitui o dbUpdate duplo (players_data + online_players)
    await applyHpToPlayer(target.id, newHp);

    pushLog(
      "damage",
      `${mob.name} atacou ${target.name ?? target.id}: ${dmg} HP [${ability.name}] HP ${newHp}/${target.stats.maxHp ?? "?"}`,
    );

    if (newHp <= 0) await handlePlayerDeath(target, mob);
  } else {
    worldEvents.emit(EVENT_TYPES.COMBAT_MISS, {
      defenderX: target.x,
      defenderY: target.y,
      defenderZ: target.z ?? 7,
    });
    const missFxId = `miss_${id}_${target.id}_${now}`;
    const missFx = buildCombatEffectPayload("attackMiss", {
      id: missFxId,
      x: target.x,
      y: target.y,
      z: target.z ?? 7,
      now,
    });
    if (missFx) {
      mergeUpdate(updates, `${PATHS.effects}/${missFxId}`, missFx);
    }
    pushLog(
      "damage",
      `${mob.name} errou ${target.name ?? target.id} [${ability.name}] MISS`,
    );
  }
}

// ---------------------------------------------------------------------------
// MORTE DE PLAYER
// ---------------------------------------------------------------------------
async function handlePlayerDeath(target, killer) {
  if (!target?.id) return; // segurança: target inválido
  if (processingPlayerDeath.has(target.id)) return;
  processingPlayerDeath.add(target.id);

  try {
    pushLog(
      "death:player",
      `${target.name ?? target.id} foi morto por ${killer.name} em ${killer.x},${killer.y} z${killer.z ?? 7}`,
    );

    const now = Date.now();
    const corpseId = `corpse_player_${target.id}_${now}`;
    const corpseFramesRaw = Array.isArray(target.corpseFrames)
      ? target.corpseFrames
      : PLAYER_CORPSE_FRAMES;
    const corpseFrames = corpseFramesRaw.map((frame) =>
      Number.isFinite(Number(frame)) ? Number(frame) : frame,
    );
    const corpseItemId = pickPlayerCorpseItemId(target);

    await batchWrite({
      [`${PATHS.effects}/${corpseId}`]: {
        type: "corpse",
        x: Number(target.x ?? killer.x ?? 0),
        y: Number(target.y ?? killer.y ?? 0),
        z: Number(target.z ?? killer.z ?? 7),
        startTime: now,
        expiry: now + PLAYER_CORPSE_DURATION,
        corpseItemId,
        corpseItemIds: corpseItemId != null ? [corpseItemId] : null,
        outfitPack: target?.corpsePack ?? PLAYER_CORPSE_PACK,
        stages: {
          growth: corpseItemId ?? corpseFrames?.[0] ?? PLAYER_CORPSE_FRAMES[0],
          sustain:
            corpseItemId ??
            corpseFrames?.[1] ??
            corpseFrames?.[0] ??
            PLAYER_CORPSE_FRAMES[1],
          decay:
            corpseItemId ??
            corpseFrames?.[2] ??
            corpseFrames?.[1] ??
            corpseFrames?.[0] ??
            PLAYER_CORPSE_FRAMES[2],
        },
      },
    });

    const spawnX = target.spawnX ?? 100;
    const spawnY = target.spawnY ?? 100;
    const spawnZ = target.spawnZ ?? 7;
    const fullHp = target.stats?.maxHp ?? 100;

    setTimeout(async () => {
      try {
        await respawnPlayer(target.id, {
          x: spawnX,
          y: spawnY,
          z: spawnZ,
          hp: fullHp,
        });

        await batchWrite({
          [`${PATHS.effects}/${corpseId}`]: null,
        });

        pushLog(
          "system",
          `${target.name ?? target.id} respawnado`,
          spawnX,
          spawnY,
          `z${spawnZ}`,
        );
      } catch (e) {
        console.error("handlePlayerDeath respawn error", e);
      } finally {
        processingPlayerDeath.delete(target.id);
      }
    }, PLAYER_CORPSE_DURATION);
  } catch (e) {
    processingPlayerDeath.delete(target.id);
    console.error("handlePlayerDeath error", e);
  }
}

// ---------------------------------------------------------------------------
// TICK DE FIELDS — aplica dano periódico e remove campos expirados
// ---------------------------------------------------------------------------
export async function tickFields() {
  const now = Date.now();
  const fields = getFields();
  const players = getPlayers();
  const updates = {};

  for (const fieldId in fields) {
    const field = fields[fieldId];
    if (!field) continue;

    // Remove campo expirado
    if (field.expiry && now > field.expiry) {
      updates[`${PATHS.fields}/${fieldId}`] = null;
      updates[`${PATHS.effects}/${fieldId}`] = null;
      continue;
    }

    // Aguarda o tickRate
    if (now - (field.lastTick ?? 0) < (field.tickRate ?? 1000)) continue;

    // Aplica dano a jogadores na mesma posição
    for (const pid in players) {
      const p = players[pid];
      if (!p?.stats?.hp || !p.id) continue;
      if (
        Math.round(p.x) === field.x &&
        Math.round(p.y) === field.y &&
        (p.z ?? 7) === (field.z ?? 7)
      ) {
        const dmg = field.damage ?? 0;
        const newHp = Math.max(0, p.stats.hp - dmg);
        worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
          defenderId: pid,
          defenderType: "players",
          damage: Math.abs(dmg),
          defenderX: p.x,
          defenderY: p.y,
          defenderZ: p.z ?? 7,
          isFieldDamage: true,
        });
        if (field.statusType) {
          worldEvents.emit(EVENT_TYPES.ENTITY_UPDATE, {
            entityId: pid,
            statusLabel: field.statusType,
            entityX: p.x,
            entityY: p.y,
            entityZ: p.z ?? 7,
          });

          // Persistir um efeito curto no alvo para todos os clientes (RPG/worldEngine).
          const statusEffectId = resolveStatusEffectId(
            field.statusType,
            field.effectId,
          );
          const statusFx = buildStatusEffectVisualPayload({
            statusType: field.statusType,
            targetId: pid,
            x: Number(p.x ?? field.x ?? 0),
            y: Number(p.y ?? field.y ?? 0),
            z: Number(p.z ?? field.z ?? 7),
            now,
            fallbackEffectId: statusEffectId,
            duration: 1200,
          });
          updates[`${PATHS.effects}/${statusFx.id}`] = statusFx.payload;
        }
        await applyHpToPlayer(pid, newHp);
        pushLog(
          "damage",
          `Campo causou ${dmg} de dano em ${p.name ?? pid} HP ${newHp}/${p.stats.maxHp ?? "?"}`,
        );
        if (newHp <= 0)
          await handlePlayerDeath(p, {
            name: "Campo de batalha",
            x: field.x,
            y: field.y,
            z: field.z ?? 7,
          });
      }
    }

    // Aplica dano a monstros na mesma posição
    const monsters = getMonsters();
    for (const mid in monsters) {
      const mob = monsters[mid];
      if (!mob || mob.dead || !(mob.stats?.hp > 0)) continue;
      if (
        Math.round(mob.x) !== field.x ||
        Math.round(mob.y) !== field.y ||
        (mob.z ?? 7) !== (field.z ?? 7)
      )
        continue;

      // Verifica imunidade do monstro ao tipo/elemento do campo
      const tmpl = MONSTER_TEMPLATES[mob.species];
      const immunities = tmpl?.immunities ?? [];
      const fieldElement = field.statusType ?? field.element ?? null;
      if (fieldElement && immunities.includes(fieldElement)) continue;

      const dmg = field.damage ?? 0;
      if (dmg <= 0) continue;

      const newHp = Math.max(0, mob.stats.hp - dmg);
      worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
        defenderId: mid,
        defenderType: "monsters",
        damage: dmg,
        defenderX: mob.x,
        defenderY: mob.y,
        defenderZ: mob.z ?? 7,
        isFieldDamage: true,
      });
      // Persiste HP no Firebase (via batch) e atualiza store local
      updates[`${PATHS.monsters}/${mid}/stats/hp`] = newHp;
      applyMonstersLocal(mid, { stats: { ...mob.stats, hp: newHp } });
      pushLog(
        "damage",
        `Campo causou ${dmg} de dano em ${mob.name ?? mid} HP ${newHp}/${mob.stats.maxHp ?? "?"}`,
      );
      if (newHp <= 0) {
        handleMonsterDeathLocal(mid, mob, updates, now);
      }
    }

    // Atualiza lastTick
    updates[`${PATHS.fields}/${fieldId}/lastTick`] = now;
  }

  if (Object.keys(updates).length > 0) await batchWrite(updates);
}
