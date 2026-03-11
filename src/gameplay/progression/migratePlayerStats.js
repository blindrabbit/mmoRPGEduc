// =============================================================================
// migratePlayerStats.js — mmoRPGEduc
//
// Migração única: aplica nova curva de XP (100 × n^1.75) em todos os jogadores.
//
// O que faz por jogador:
//   1. Lê totalXp acumulado de players_data (fonte de verdade)
//   2. Recalcula nível com a nova fórmula
//   3. Reseta allocatedStats → { FOR:0, INT:0, AGI:0, VIT:0 }
//   4. Devolve TODOS os pontos ganhos até o novo nível como disponíveis
//   5. Recalcula maxHp / maxMp com auto-growth da classe
//   6. Restaura HP/MP ao máximo (equivale a um level-up completo)
//   7. Persiste em AMBOS os caminhos: online_players e players_data
//
// Como executar: importar e chamar runMigration() uma única vez (painel admin,
// script de setup ou console do Firebase). Salvo para não re-executar.
// =============================================================================

import { dbGet, batchWrite, PATHS } from "../../core/db.js";
import {
  getLevelFromXp,
  getXpToNextLevel,
  calculateTotalStats,
  PROGRESSION_CONFIG,
} from "./progressionSystem.js";

const CHUNK_SIZE = 200; // pares path/value por batchWrite (segurança Firebase)
const EMPTY_STATS = Object.freeze({ FOR: 0, INT: 0, AGI: 0, VIT: 0 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _chunk(obj) {
  const entries = Object.entries(obj);
  const chunks = [];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    chunks.push(Object.fromEntries(entries.slice(i, i + CHUNK_SIZE)));
  }
  return chunks;
}

function _migrateOne(playerId, playerData) {
  const stats = playerData?.stats ?? {};
  const playerClass = playerData?.class ?? "cavaleiro";
  const totalXp = stats.totalXp ?? 0;

  // Novo nível pela fórmula 100 × n^1.75
  const levelData = getLevelFromXp(totalXp);
  const newLevel = levelData.level;

  // Pontos totais ganhos = (nível - 1) × 5, todos devolvidos como disponíveis
  const totalPointsEarned =
    (newLevel - 1) * PROGRESSION_CONFIG.statPointsPerLevel;

  // Recalcular HP/MP com auto-growth da classe + stats zerados
  const tempPlayer = {
    class: playerClass,
    stats: {
      ...stats,
      level: newLevel,
      allocatedStats: { ...EMPTY_STATS },
    },
  };
  const computed = calculateTotalStats(tempPlayer);

  return {
    // campos migrados
    level: newLevel,
    xp: levelData.currentXp,
    xpToNext: getXpToNextLevel(newLevel),
    totalXp,
    allocatedStats: { ...EMPTY_STATS },
    availableStatPoints: totalPointsEarned,
    maxHp: computed.maxHp,
    maxMp: computed.maxMp,
    hp: computed.maxHp, // cura total na migração
    mp: computed.maxMp,
    // meta para log
    _meta: {
      playerId,
      class: playerClass,
      totalXp,
      oldLevel: stats.level ?? 1,
      newLevel,
      pointsRestored: totalPointsEarned,
    },
  };
}

// ---------------------------------------------------------------------------
// runMigration — chamada única
// ---------------------------------------------------------------------------

/**
 * Migra todos os jogadores para a nova curva de XP.
 * @param {{ dryRun?: boolean }} options
 *   dryRun=true  → apenas calcula e retorna o relatório, sem escrever no Firebase
 *   dryRun=false → escreve no Firebase (padrão)
 * @returns {Promise<MigrationResult>}
 */
export async function runMigration({ dryRun = false } = {}) {
  console.log(`[migratePlayerStats] Iniciando migração (dryRun=${dryRun})...`);

  // 1. Lê todos os jogadores de players_data (fonte de verdade)
  const allPlayersData = await dbGet(PATHS.playersData);
  if (!allPlayersData || typeof allPlayersData !== "object") {
    return {
      success: false,
      error: "players_data não encontrado ou vazio",
      migrated: 0,
      results: [],
    };
  }

  const playerIds = Object.keys(allPlayersData);
  console.log(`[migratePlayerStats] ${playerIds.length} jogador(es) encontrado(s).`);

  const updates = {};
  const results = [];
  const errors = [];

  // 2. Calcula migração para cada jogador
  for (const playerId of playerIds) {
    const playerData = allPlayersData[playerId];
    if (!playerData || typeof playerData !== "object") continue;

    try {
      const { _meta, ...newFields } = _migrateOne(playerId, playerData);
      results.push(_meta);

      if (!dryRun) {
        const onlinePath = PATHS.playerStats(playerId);
        const dataPath = PATHS.playerDataStats(playerId);

        for (const [field, value] of Object.entries(newFields)) {
          updates[`${onlinePath}/${field}`] = value;
          updates[`${dataPath}/${field}`] = value;
        }
      }
    } catch (err) {
      console.error(`[migratePlayerStats] Erro ao migrar ${playerId}:`, err);
      errors.push({ playerId, error: err.message });
    }
  }

  // 3. Persiste em chunks para não ultrapassar limite do Firebase
  if (!dryRun && Object.keys(updates).length > 0) {
    const chunks = _chunk(updates);
    console.log(
      `[migratePlayerStats] Escrevendo ${Object.keys(updates).length} campos em ${chunks.length} chunk(s)...`,
    );

    for (let i = 0; i < chunks.length; i++) {
      await batchWrite(chunks[i]);
      console.log(`[migratePlayerStats] Chunk ${i + 1}/${chunks.length} concluído.`);
    }
  }

  // 4. Log resumo
  const summary = {
    success: errors.length === 0,
    dryRun,
    migrated: results.length,
    errors: errors.length,
    results,
    errorDetails: errors,
  };

  console.log(
    `[migratePlayerStats] Migração ${dryRun ? "(DRY RUN) " : ""}concluída:`,
    `${results.length} jogadores processados, ${errors.length} erro(s).`,
  );

  if (results.length > 0) {
    console.table(
      results.map((r) => ({
        id: r.playerId,
        classe: r.class,
        totalXp: r.totalXp,
        "nível antes": r.oldLevel,
        "nível novo": r.newLevel,
        "pontos devolvidos": r.pointsRestored,
      })),
    );
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Utilitário: preview de um único jogador (debug/admin)
// ---------------------------------------------------------------------------

/**
 * Mostra a migração calculada para um jogador específico sem escrever nada.
 * @param {string} playerId
 */
export async function previewPlayerMigration(playerId) {
  const playerData = await dbGet(PATHS.playerData(playerId));
  if (!playerData) {
    return { error: `Jogador "${playerId}" não encontrado em players_data` };
  }

  const { _meta, ...newFields } = _migrateOne(playerId, playerData);
  return { ..._meta, newFields };
}
