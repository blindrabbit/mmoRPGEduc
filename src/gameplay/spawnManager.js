// =============================================================================
// spawnManager.js — Sistema de spawn automático de monstros
//
// Regra principal: cada ponto de spawn mantém exatamente 1 monstro vivo.
// Um novo monstro só nasce depois que o anterior morreu E o tempo de respawn
// (spawntime em segundos, do monster_spawns.json) tiver passado.
//
// Uso:
//   initSpawnManager(spawnsData)  — chame 1x após carregar o JSON
//   tickSpawnManager({ now })     — chame a cada tick do mundo
// =============================================================================

import { makeMonster } from "../core/schema.js";
import { syncMonster } from "../core/db.js";
import { MONSTER_TEMPLATES } from "./monsterData.js";
import { MONSTER_SPAWN_DATA } from "./monsterData.generated.js";
import { getMonsters } from "../core/worldStore.js";
import { pushLog } from "./eventLog.js";

// ---------------------------------------------------------------------------
// Estado interno — um registro por ponto de spawn
// ---------------------------------------------------------------------------
// spawnState[spawnId] = {
//   spawnId    : string   — chave única (sp_<name>_<x>_<y>_<z>)
//   name       : string   — espécie do monstro (wolf, rotworm, …)
//   x, y, z   : number   — posição central do spawn
//   radius     : number   — raio de variação do ponto de nascimento
//   spawntimeMs: number   — delay de respawn em ms
//   monsterId  : string|null — ID do monstro vivo atual (ou null)
//   nextSpawnAt: number   — timestamp para o próximo spawn (0 = imediato)
// }
const spawnState = {};
let _ready = false;

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Busca o template da espécie: primeiro no catálogo manual, depois no gerado. */
function getTemplate(species) {
  return MONSTER_TEMPLATES[species] ?? MONSTER_SPAWN_DATA?.monsters?.[species] ?? null;
}

/** Chave única para o ponto de spawn, baseada em posição. */
function makeSpawnId(name, x, y, z) {
  return `sp_${name}_${x}_${y}_${z}`;
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------

/**
 * Inicializa o gerenciador de spawns a partir dos dados do monster_spawns.json.
 *
 * Ao iniciar, tenta "adotar" monstros já vivos no Firebase que estejam
 * próximos ao ponto de spawn correspondente, evitando spawns duplicados
 * após reinicialização do servidor.
 *
 * @param {{ spawns: Array }} spawnsData  — JSON parseado do monster_spawns.json
 */
export function initSpawnManager(spawnsData) {
  if (!spawnsData?.spawns?.length) {
    console.warn("[SpawnManager] Nenhum dado de spawn encontrado.");
    return;
  }

  const now = Date.now();
  const monsters = getMonsters() ?? {};

  // Indexa monstros vivos por espécie para adoção eficiente
  const existingBySpecies = {};
  for (const [mid, mob] of Object.entries(monsters)) {
    if (!mob || mob.dead || (mob.stats?.hp ?? 0) <= 0) continue;
    const sp = mob.species;
    if (!existingBySpecies[sp]) existingBySpecies[sp] = [];
    existingBySpecies[sp].push({ x: mob.x, y: mob.y, z: mob.z ?? 7, id: mid });
  }

  const adopted = new Set();
  let idx = 0;

  for (const spawn of spawnsData.spawns) {
    // Valida coordenadas (filtra entradas com null ou valores inválidos como "227-1")
    if (spawn.x == null || spawn.y == null || spawn.z == null) continue;
    const x = Number(spawn.x);
    const y = Number(spawn.y);
    const z = Number(spawn.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    const name = (spawn.name ?? "").toLowerCase().trim();
    if (!name) continue;

    const spawnId = makeSpawnId(name, x, y, z);
    // Evita duplicatas (mesmo ponto de spawn listado duas vezes no JSON)
    if (spawnState[spawnId]) continue;

    const spawntimeMs = Math.max(5000, (Number(spawn.spawntime) || 60) * 1000);
    const radius = Number(spawn.radius) || 1;

    // Tenta adotar monstro existente próximo ao ponto
    let monsterId = null;
    const nearby = existingBySpecies[name] ?? [];
    for (let i = 0; i < nearby.length; i++) {
      const m = nearby[i];
      if (adopted.has(m.id)) continue;
      const dist = Math.hypot(m.x - x, m.y - y);
      if (m.z === z && dist <= Math.max(radius + 2, 3)) {
        monsterId = m.id;
        adopted.add(m.id);
        nearby.splice(i, 1);
        break;
      }
    }

    spawnState[spawnId] = {
      spawnId,
      name,
      x,
      y,
      z,
      radius,
      spawntimeMs,
      monsterId,
      // Se não adotou nenhum monstro, escaloneia o spawn inicial
      // para não criar centenas de writes simultâneos no boot.
      nextSpawnAt: monsterId ? 0 : now + 5000 + idx * 150,
    };
    idx++;
  }

  _ready = true;
  const total = Object.keys(spawnState).length;
  const adoptedCount = Object.values(spawnState).filter((s) => s.monsterId).length;
  const toSpawn = total - adoptedCount;
  console.log(
    `[SpawnManager] ${total} pontos de spawn | ${adoptedCount} adotados | ${toSpawn} a nascer`,
  );
}

// ---------------------------------------------------------------------------
// TICK
// ---------------------------------------------------------------------------

/**
 * Deve ser chamado a cada tick do mundo.
 * Verifica monstros mortos e realiza novos spawns quando o timer expirou.
 *
 * @param {{ now: number }} options
 */
export async function tickSpawnManager({ now = Date.now() } = {}) {
  if (!_ready) return;

  const monsters = getMonsters() ?? {};

  for (const sp of Object.values(spawnState)) {
    // ── 1. Monstro vinculado: verificar se ainda está vivo ──────────────────
    if (sp.monsterId) {
      const mob = monsters[sp.monsterId];
      const alive = mob && !mob.dead && (mob.stats?.hp ?? 0) > 0;

      if (alive) continue; // tudo certo, nada a fazer

      // Monstro morreu ou foi removido — inicia timer de respawn
      const delaySec = (sp.spawntimeMs / 1000).toFixed(0);
      console.log(
        `[SpawnManager] ${sp.name} (${sp.x},${sp.y} z${sp.z}) morreu. Respawn em ${delaySec}s.`,
      );
      sp.monsterId = null;
      sp.nextSpawnAt = now + sp.spawntimeMs;
      continue;
    }

    // ── 2. Aguardando timer ─────────────────────────────────────────────────
    if (sp.nextSpawnAt > 0 && now < sp.nextSpawnAt) continue;

    // ── 3. Hora de spawnar ──────────────────────────────────────────────────
    const template = getTemplate(sp.name);
    if (!template) {
      console.warn(`[SpawnManager] Template nao encontrado para: "${sp.name}"`);
      sp.nextSpawnAt = now + 30_000; // tenta novamente em 30s
      continue;
    }

    try {
      // Posição com variação dentro do radius
      const angle = Math.random() * Math.PI * 2;
      const d = Math.random() * sp.radius;
      const spawnX = Math.round(sp.x + Math.cos(angle) * d);
      const spawnY = Math.round(sp.y + Math.sin(angle) * d);

      // ID único: encoda a origem do spawn + timestamp
      const monsterId = `mob_${sp.name}_${sp.x}_${sp.y}_${sp.z}_${now}`;

      const mob = makeMonster({
        id: monsterId,
        species: sp.name,
        name: template.name ?? sp.name,
        x: spawnX,
        y: spawnY,
        z: sp.z,
        spawnX: sp.x,
        spawnY: sp.y,
        spawnZ: sp.z,
        appearance: template.appearance ?? {},
        stats: template.stats ?? {},
      });

      await syncMonster(monsterId, mob);

      sp.monsterId = monsterId;
      sp.nextSpawnAt = 0;

      pushLog(
        "spawn",
        `${template.name ?? sp.name} nasceu em (${spawnX},${spawnY}) z${sp.z}`,
        spawnX,
        spawnY,
        `z${sp.z}`,
      );
    } catch (err) {
      console.error(`[SpawnManager] Erro ao spawnar ${sp.name}:`, err);
      sp.nextSpawnAt = now + 10_000; // retry em 10s
    }
  }
}

// ---------------------------------------------------------------------------
// UTILITÁRIOS (para diagnóstico/admin)
// ---------------------------------------------------------------------------

/** Retorna um resumo do estado atual de todos os pontos de spawn. */
export function getSpawnStatus() {
  return Object.values(spawnState).map((sp) => ({
    spawnId: sp.spawnId,
    name: sp.name,
    x: sp.x,
    y: sp.y,
    z: sp.z,
    monsterId: sp.monsterId ?? null,
    alive: sp.monsterId != null,
    nextSpawnAt: sp.nextSpawnAt > 0 ? new Date(sp.nextSpawnAt).toISOString() : null,
  }));
}
