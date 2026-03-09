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
import {
  emitHpDeltaText,
  emitMissText,
  emitStatusText,
  buildCombatEffectPayload,
} from "./combatEngine.js";
import {
  findTarget,
  decideMoveTo,
  decideMoveBFS,
  decideWander,
  isTileBlocked,
  hasSpellLOS,
  selectAttack,
  getLookAtDirection,
  parseShape,
} from "./monsterAI.js";
import {
  buildFieldPayload,
  buildFieldEffectFallbackPayload,
} from "./fieldPayload.js";
import { pushLog } from "./eventLog.js";
import {
  getMonsters,
  getPlayers,
  getFields,
  applyMonstersLocal,
} from "../core/worldStore.js";

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
export async function tickMonsters() {
  const now = Date.now();
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

    await processAI(id, mob, now, updates);
  }

  // 1 única escrita para todas as mudanças do tick
  if (Object.keys(updates).length > 0) await batchWrite(updates);
}

// ---------------------------------------------------------------------------
// MORTE DE MONSTRO (exportada para actionProcessor usar)
// ---------------------------------------------------------------------------
export function handleMonsterDeathLocal(id, mob, updates, now) {
  const template = MONSTER_TEMPLATES[mob.species];
  const removeDelay = Math.min(
    template?.corpseDuration ?? MAX_CORPSE_LINGER_MS,
    MAX_CORPSE_LINGER_MS,
  );

  // Marca monstro como morto — atualiza store E Firebase
  applyToMob(
    id,
    {
      dead: true,
      type: "corpse",
      stats: { ...mob.stats, hp: 0 },
    },
    updates,
  );

  // Cria corpse em world_effects (onde gameCore lê para renderizar)
  const corpseId = `corpse${id}`;
  mergeUpdate(updates, `${PATHS.effects}/${corpseId}`, {
    type: "corpse",
    x: mob.x,
    y: mob.y,
    z: mob.z ?? 7,
    startTime: now,
    expiry: now + removeDelay,
    outfitPack: template?.appearance?.outfitPack ?? "monstros_01",
    stages: {
      growth: template?.corpseFrames?.[0] ?? 496,
      sustain: template?.corpseFrames?.[1] ?? 497,
      decay: template?.corpseFrames?.[2] ?? template?.corpseFrames?.[1] ?? 497,
    },
  });

  pushLog(
    `death:monster`,
    `${mob.name ?? mob.species} foi eliminado`,
    mob.x,
    mob.y,
    `z${mob.z ?? 7}`,
  );

  // Remove nós após expirar o cadáver
  setTimeout(async () => {
    try {
      // ✅ batchWrite substitui o dbUpdate duplo
      await batchWrite({
        [`${PATHS.monsters}/${id}`]: null,
        [`${PATHS.effects}/${corpseId}`]: null,
      });
      pushLog("system", `Cadáver removido`, mob.name ?? id);
    } catch (e) {
      console.error("handleMonsterDeathLocal remove error", e);
    }
  }, removeDelay);
}

// ---------------------------------------------------------------------------
// INTELIGÊNCIA ARTIFICIAL
// ---------------------------------------------------------------------------
async function processAI(id, mob, now, updates) {
  const template = MONSTER_TEMPLATES[mob.species];
  if (!template) return;

  const behavior = { range: 7, loseAggro: 10, ...template.behavior };
  const players = getPlayers();
  const monsters = getMonsters();

  const target = findTarget(mob, players, behavior.range);

  if (target) {
    const dist = Math.hypot(target.x - mob.x, target.y - mob.y);

    // Look-at: rotaciona para o alvo
    const newDir = getLookAtDirection(mob, target);
    if (newDir !== mob.direcao) {
      applyToMob(id, { direcao: newDir }, updates);
    }

    // Seleção e execução de ataque
    const atk = selectAttack(mob, template.attacks ?? [], dist, now);
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
          const k = "cd" + a.name.replace(/[^a-zA-Z0-9]/g, "");
          return now - (mob[k] ?? 0) >= (a.cooldown ?? 1500);
        });
        console.log(
          `${tag} atk=null | totalAtaques=${attacks.length} noAlcance=${byRange.length} semCooldown=${byCd.length}`,
        );
        byRange.forEach((a) => {
          const k = "cd" + a.name.replace(/[^a-zA-Z0-9]/g, "");
          const elapsed = now - (mob[k] ?? 0);
          const ready = elapsed >= (a.cooldown ?? 1500);
          console.log(
            `${tag}   └─ "${a.name}" range=${a.range} cd=${a.cooldown}ms decorrido=${elapsed}ms pronto=${ready}`,
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
        )
      ) {
        // Caminho direto livre
        applyToMob(
          id,
          { x: move.nx, y: move.ny, direcao: move.direcao, lastMoveTime: now },
          updates,
        );
      } else {
        // Caminho bloqueado — tenta BFS para contornar paredes
        const bfs = decideMoveBFS(
          mob,
          Math.round(target.x),
          Math.round(target.y),
          z,
          map,
          nexoData,
        );
        if (
          bfs &&
          !isTileBlocked(
            bfs.nx,
            bfs.ny,
            z,
            map,
            monsters,
            players,
            id,
            nexoData,
          )
        ) {
          applyToMob(
            id,
            { x: bfs.nx, y: bfs.ny, direcao: bfs.direcao, lastMoveTime: now },
            updates,
          );
        } else {
          // Sem caminho — wander para não ficar parado
          const w = decideWander(mob);
          if (
            w &&
            !isTileBlocked(
              w.nx,
              w.ny,
              z,
              map,
              getMonsters(),
              players,
              id,
              nexoData,
            )
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
        )
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
  const cdKey = "cd" + attack.name.replace(/[^a-zA-Z0-9]/g, "");

  // Registra cooldown no store E no Firebase imediatamente
  applyToMob(id, { lastAttack: now, [cdKey]: now }, updates);

  // Ataque de área
  if (attack.type === "area" && attack.shape) {
    const coords = parseShape(attack.shape, mob.direcao);
    const mz = mob.z ?? 7;
    const mx = Math.round(mob.x);
    const my = Math.round(mob.y);
    const players = getPlayers();

    if (window.DEBUG_AI) {
      const tag = `[AI:${mob.name ?? id}]`;
      console.log(
        `${tag} executeAttack AREA "${attack.name}" | dir=${mob.direcao} tiles=${coords.length} isPersistent=${!!attack.isPersistent}`,
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
      const effectId = attack.isPersistent ? baseId : `${baseId}wave`;

      // Filtro LOS: não atravessa paredes
      if (!hasSpellLOS(mx, my, tx, ty, tz, map, nexoData)) continue;

      if (attack.isPersistent) {
        mergeUpdate(
          updates,
          `${PATHS.fields}/${baseId}`,
          buildFieldPayload({
            id: baseId,
            x: tx,
            y: ty,
            z: tz,
            now,
            damage: attack.damage,
            fieldId: attack.fieldId ?? attack.effectId,
            effectId: attack.effectId,
            fieldDuration: attack.fieldDuration ?? 5000,
            tickRate: attack.tickRate ?? 1000,
            statusType: attack.statusType ?? null,
          }),
        );
      }

      if (!attack.isField || !attack.isPersistent) {
        mergeUpdate(
          updates,
          `${PATHS.effects}/${effectId}`,
          buildFieldEffectFallbackPayload({
            x: tx,
            y: ty,
            z: tz,
            now,
            isPersistent: attack.isPersistent,
            isField: false,
            fieldDuration: attack.fieldDuration ?? 5000,
            effectDuration: attack.effectDuration ?? 1200,
            effectId: Number(attack.effectId ?? (attack.isPersistent ? 2 : 1)),
          }),
        );
      }

      // Dano direto: ataques de área não-persistentes causam dano imediato
      // (ex: Onda de Fogo — efeito visual + dano instantâneo, sem campo residual)
      if (!attack.isPersistent && (attack.damage ?? 0) > 0) {
        for (const pid in players) {
          const p = players[pid];
          if (!p?.stats?.hp || !p.id) continue;
          if (
            Math.round(p.x) === tx &&
            Math.round(p.y) === ty &&
            (p.z ?? 7) === tz
          ) {
            const newHp = Math.max(0, p.stats.hp - attack.damage);
            emitHpDeltaText("players", pid, p, -Math.abs(attack.damage));
            await applyHpToPlayer(pid, newHp);
            pushLog(
              "damage",
              `${mob.name} causou ${attack.damage} em ${p.name ?? pid} [${attack.name}] HP ${newHp}/${p.stats.maxHp ?? "?"}`,
            );
            if (newHp <= 0) await handlePlayerDeath(p, mob);
          }
        }
      }
    }

    pushLog(
      "field",
      `${mob.name} usou ${attack.name}`,
      mob.x,
      mob.y,
      `z${mob.z ?? 7}`,
    );
    return;
  }

  // Ataque físico direto
  if (window.DEBUG_AI) {
    console.log(
      `[AI:${mob.name ?? id}] executeAttack MELEE "${attack.name}" | alvo=${target?.id} hp=${target?.stats?.hp}`,
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

  const combatResult = calculateCombatResult(
    MONSTER_TEMPLATES[mob.species]?.stats,
    target.stats,
  );

  if (combatResult.hit) {
    const dmg = calculateFinalDamage(attack.damage ?? 0, combatResult);
    const newHp = calculateNewHp(target.stats.hp, -dmg, target.stats.maxHp);
    emitHpDeltaText("players", target.id, target, -Math.abs(dmg));
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
      `${mob.name} atacou ${target.name ?? target.id}: ${dmg} HP [${attack.name}] HP ${newHp}/${target.stats.maxHp ?? "?"}`,
    );

    if (newHp <= 0) await handlePlayerDeath(target, mob);
  } else {
    emitMissText(target);
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
      `${mob.name} errou ${target.name ?? target.id} [${attack.name}] MISS`,
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
        emitHpDeltaText("players", pid, p, -Math.abs(dmg), {
          color: "#ff7a2f",
        });
        if (field.statusType) {
          emitStatusText(p, field.statusType);
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

    // Atualiza lastTick
    updates[`${PATHS.fields}/${fieldId}/lastTick`] = now;
  }

  if (Object.keys(updates).length > 0) await batchWrite(updates);
}
