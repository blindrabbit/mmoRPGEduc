// =============================================================================
// progressionSystem.js — mmoRPGEduc
// Sistema de progressão: XP, Level Up, distribuição de atributos
//
// Arquitetura:
// • Núcleo calcula XP/level autoritativamente
// • Emite eventos para clientes renderizarem UI
// • Fórmulas balanceadas para classes físicas E mágicas
// • 4 atributos: FOR, INT, AGI, VIT
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../core/events.js";
import { dbSet, batchWrite, PATHS } from "../../core/db.js";
import { getPlayer, applyPlayersLocal } from "../../core/worldStore.js";

// =============================================================================
// CONFIGURAÇÃO DE PROGRESSÃO
// =============================================================================

export const PROGRESSION_CONFIG = Object.freeze({
  // XP necessário por nível: 10 * 1.15^(level-1)
  // Ex.: nivel 1->2 = 10 XP (progressão inicial mais rápida)
  xpToNextLevel: (level) => Math.floor(10 * Math.pow(1.15, level - 1)),

  // Pontos de atributo por nível
  statPointsPerLevel: 3,

  // Nível máximo
  maxLevel: 50,

  // Crescimento de atributos por classe
  classGrowth: {
    cavaleiro: {
      primary: "FOR",
      secondary: "VIT",
      growth: { FOR: 3, VIT: 2, AGI: 1, INT: 0 },
      hpPerVit: 12,
      mpPerInt: 3,
      description: "Guerreiro de close - alto HP e dano físico",
    },
    mago: {
      primary: "INT",
      secondary: "AGI",
      growth: { FOR: 0, VIT: 1, AGI: 1, INT: 4 },
      hpPerVit: 6,
      mpPerInt: 8,
      spellPowerPerInt: 2.5,
      description: "Mestre das artes arcanas - alto dano mágico",
    },
    arqueiro: {
      primary: "AGI",
      secondary: "FOR",
      growth: { FOR: 2, VIT: 1, AGI: 3, INT: 0 },
      hpPerVit: 8,
      mpPerInt: 3,
      critPerAgi: 0.7,
      description: "Atirador de elite - alto crítico e precisão",
    },
    druid: {
      primary: "INT",
      secondary: "VIT",
      growth: { FOR: 1, VIT: 2, AGI: 0, INT: 3 },
      hpPerVit: 10,
      mpPerInt: 6,
      spellPowerPerInt: 2.0,
      description: "Guardião da natureza - magia e sobrevivência",
    },
    clerigo: {
      primary: "INT",
      secondary: "VIT",
      growth: { FOR: 0, VIT: 2, AGI: 0, INT: 3 },
      hpPerVit: 10,
      mpPerInt: 7,
      healPowerPerInt: 2.5,
      description: "Servo da luz - curas poderosas e suporte",
    },
  },

  // XP concedida por monstro (base * level do monstro)
  xpPerMonsterLevel: 10,

  // Atributos válidos
  validStats: ["FOR", "INT", "AGI", "VIT"],
});

// =============================================================================
// CÁLCULOS DE PROGRESSÃO
// =============================================================================

/**
 * Calcula XP necessário para o próximo nível
 */
export function getXpToNextLevel(currentLevel) {
  return PROGRESSION_CONFIG.xpToNextLevel(Math.max(1, currentLevel));
}

/**
 * Calcula nível baseado no XP total
 */
export function getLevelFromXp(totalXp) {
  let level = 1;
  let xpAccumulated = 0;

  while (
    xpAccumulated + getXpToNextLevel(level) <= totalXp &&
    level < PROGRESSION_CONFIG.maxLevel
  ) {
    xpAccumulated += getXpToNextLevel(level);
    level++;
  }

  return {
    level,
    currentXp: totalXp - xpAccumulated,
    xpToNext: getXpToNextLevel(level),
  };
}

/**
 * Calcula atributos totais de um jogador
 * (base da classe + pontos distribuídos)
 */
export function calculateTotalStats(player) {
  const classConfig =
    PROGRESSION_CONFIG.classGrowth[player.class] ||
    PROGRESSION_CONFIG.classGrowth.cavaleiro;
  const level = player.stats?.level ?? 1;
  const allocatedStats = player.stats?.allocatedStats || {
    FOR: 0,
    INT: 0,
    AGI: 0,
    VIT: 0,
  };

  // Stats base da classe (crescimento automático por nível)
  const baseStats = {
    FOR: 5 + classConfig.growth.FOR * (level - 1),
    INT: 5 + classConfig.growth.INT * (level - 1),
    AGI: 5 + classConfig.growth.AGI * (level - 1),
    VIT: 5 + classConfig.growth.VIT * (level - 1),
  };

  // Stats totais (base + pontos alocados manualmente)
  const totalStats = {
    FOR: baseStats.FOR + (allocatedStats.FOR || 0),
    INT: baseStats.INT + (allocatedStats.INT || 0),
    AGI: baseStats.AGI + (allocatedStats.AGI || 0),
    VIT: baseStats.VIT + (allocatedStats.VIT || 0),
  };

  // Calcular HP e MP derivados
  const maxHp = Math.floor(100 + totalStats.VIT * classConfig.hpPerVit);
  const maxMp = Math.floor(50 + totalStats.INT * classConfig.mpPerInt);

  // Poder mágico (para magos)
  const spellPower = classConfig.spellPowerPerInt
    ? totalStats.INT * classConfig.spellPowerPerInt
    : 0;

  // Poder de cura (para clerigos)
  const healPower = classConfig.healPowerPerInt
    ? totalStats.INT * classConfig.healPowerPerInt
    : 0;

  // Chance de crítico (para arqueiros)
  const critChance = classConfig.critPerAgi
    ? (totalStats.AGI * classConfig.critPerAgi) / 100
    : 0.05;

  return {
    baseStats,
    totalStats,
    allocatedStats,
    maxHp,
    maxMp,
    spellPower,
    healPower,
    critChance,
    availablePoints: player.stats?.availableStatPoints ?? 0,
    classConfig,
  };
}

/**
 * Inicializa stats de um jogador novo
 */
export function initializePlayerStats(playerClass) {
  const classConfig =
    PROGRESSION_CONFIG.classGrowth[playerClass] ||
    PROGRESSION_CONFIG.classGrowth.cavaleiro;

  const baseFOR = 5 + classConfig.growth.FOR * 0;
  const baseINT = 5 + classConfig.growth.INT * 0;
  const baseAGI = 5 + classConfig.growth.AGI * 0;
  const baseVIT = 5 + classConfig.growth.VIT * 0;
  const baseAtk = Math.round(
    (classConfig.primary === "INT" ? baseINT : baseFOR) * 1.5,
  );
  const baseDef = Math.round(baseVIT * 0.5 + baseAGI * 0.2);
  const baseCritChance = classConfig.critPerAgi
    ? Number(((baseAGI * classConfig.critPerAgi) / 100).toFixed(4))
    : Number((0.05 + baseAGI * 0.005).toFixed(4));
  const baseSpellPower = Math.round(
    classConfig.spellPowerPerInt ? baseINT * classConfig.spellPowerPerInt : 0,
  );
  const baseHealPower = Math.round(
    classConfig.healPowerPerInt ? baseINT * classConfig.healPowerPerInt : 0,
  );

  return {
    level: 1,
    xp: 0,
    totalXp: 0,
    availableStatPoints: 0,
    allocatedStats: { FOR: 0, INT: 0, AGI: 0, VIT: 0 },
    maxHp: 100 + 5 * classConfig.hpPerVit,
    maxMp: 50 + 5 * classConfig.mpPerInt,
    hp: 100 + 5 * classConfig.hpPerVit,
    mp: 50 + 5 * classConfig.mpPerInt,
    FOR: baseFOR,
    INT: baseINT,
    AGI: baseAGI,
    VIT: baseVIT,
    atk: baseAtk,
    def: baseDef,
    agi: baseAGI,
    spellPower: baseSpellPower,
    healPower: baseHealPower,
    critChance: baseCritChance,
  };
}

function buildDerivedStatSnapshot(calculatedStats) {
  const total = calculatedStats?.totalStats ?? {
    FOR: 0,
    INT: 0,
    AGI: 0,
    VIT: 0,
  };
  const classConfig =
    calculatedStats?.classConfig ?? PROGRESSION_CONFIG.classGrowth.cavaleiro;

  const attackSource = classConfig.primary === "INT" ? total.INT : total.FOR;
  const atk = Math.max(1, Math.round(attackSource * 1.5));
  const def = Math.max(0, Math.round(total.VIT * 0.5 + total.AGI * 0.2));
  const agi = Math.max(1, Math.round(total.AGI));
  const spellPower = Math.round(calculatedStats?.spellPower ?? 0);
  const healPower = Math.round(calculatedStats?.healPower ?? 0);
  const critChance = Number(
    (
      calculatedStats?.critChance ?? 0.05 + Number(total.AGI ?? 0) * 0.005
    ).toFixed(4),
  );

  return {
    FOR: Number(total.FOR ?? 0),
    INT: Number(total.INT ?? 0),
    AGI: Number(total.AGI ?? 0),
    VIT: Number(total.VIT ?? 0),
    atk,
    def,
    agi,
    spellPower,
    healPower,
    critChance,
  };
}

// =============================================================================
// PROCESSAMENTO DE XP
// =============================================================================

/**
 * Processa ganho de XP e verifica level up
 */
export async function processXpGain(playerId, xpAmount, source = "monster") {
  const player = getPlayer(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  const currentLevel = player.stats?.level ?? 1;
  const currentXp = player.stats?.xp ?? 0;
  const newXpTotal = (player.stats?.totalXp ?? 0) + xpAmount;

  // Calcular novo nível
  const levelData = getLevelFromXp(newXpTotal);
  const leveledUp = levelData.level > currentLevel;
  const levelsGained = levelData.level - currentLevel;

  // Calcular pontos de atributo ganhos
  const pointsGained = levelsGained * PROGRESSION_CONFIG.statPointsPerLevel;
  const levelUpStats = leveledUp
    ? calculateTotalStats({
        ...player,
        stats: { ...player.stats, level: levelData.level },
      })
    : null;

  // Preparar atualizações
  const updates = {};
  const statsPaths = [
    PATHS.playerStats?.(playerId) || `online_players/${playerId}/stats`,
    PATHS.playerDataStats?.(playerId) || `players_data/${playerId}/stats`,
  ];

  for (const playerStatsPath of statsPaths) {
    updates[`${playerStatsPath}/xp`] = levelData.currentXp;
    updates[`${playerStatsPath}/totalXp`] = newXpTotal;
  }

  if (leveledUp) {
    const derived = buildDerivedStatSnapshot(levelUpStats);

    for (const playerStatsPath of statsPaths) {
      updates[`${playerStatsPath}/level`] = levelData.level;
      updates[`${playerStatsPath}/availableStatPoints`] =
        (player.stats?.availableStatPoints ?? 0) + pointsGained;
    }

    for (const playerStatsPath of statsPaths) {
      updates[`${playerStatsPath}/maxHp`] = levelUpStats.maxHp;
      updates[`${playerStatsPath}/maxMp`] = levelUpStats.maxMp;
      updates[`${playerStatsPath}/hp`] = levelUpStats.maxHp; // Cura completa no level up
      updates[`${playerStatsPath}/mp`] = levelUpStats.maxMp;
      for (const [key, value] of Object.entries(derived)) {
        updates[`${playerStatsPath}/${key}`] = value;
      }
    }
  }

  // Aplicar atualizações no Firebase
  await batchWrite(updates);

  // Atualizar worldStore local
  applyPlayersLocal(playerId, {
    stats: {
      ...player.stats,
      xp: levelData.currentXp,
      totalXp: newXpTotal,
      level: levelData.level,
      availableStatPoints:
        (player.stats?.availableStatPoints ?? 0) + pointsGained,
      maxHp: levelUpStats?.maxHp ?? player.stats?.maxHp,
      maxMp: levelUpStats?.maxMp ?? player.stats?.maxMp,
      hp: levelUpStats?.maxHp ?? player.stats?.hp,
      mp: levelUpStats?.maxMp ?? player.stats?.mp,
      ...(levelUpStats ? buildDerivedStatSnapshot(levelUpStats) : {}),
    },
  });

  // Emitir eventos
  worldEvents.emit(EVENT_TYPES.PROGRESSION_XP_GAIN, {
    playerId,
    xpGained: xpAmount,
    source,
    totalXp: newXpTotal,
    currentLevel,
    timestamp: Date.now(),
  });

  if (leveledUp) {
    worldEvents.emit(EVENT_TYPES.PROGRESSION_LEVEL_UP, {
      playerId,
      newLevel: levelData.level,
      levelsGained,
      pointsGained,
      previousLevel: currentLevel,
      timestamp: Date.now(),
    });
  }

  return {
    success: true,
    leveledUp,
    newLevel: levelData.level,
    newXp: levelData.currentXp,
    pointsGained,
  };
}

// =============================================================================
// DISTRIBUIÇÃO DE ATRIBUTOS
// =============================================================================

/**
 * Distribui pontos de atributo manualmente
 */
export async function allocateStatPoint(playerId, statName, amount = 1) {
  const player = getPlayer(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  // Validar atributo
  if (!PROGRESSION_CONFIG.validStats.includes(statName)) {
    return {
      success: false,
      error: "Atributo inválido. Use: FOR, INT, AGI, VIT",
    };
  }

  // Verificar pontos disponíveis
  const available = player.stats?.availableStatPoints ?? 0;
  if (available < amount) {
    return {
      success: false,
      error: `Pontos insuficientes (${available} disponíveis)`,
    };
  }

  // Atualizar atributos alocados
  const currentAllocated = player.stats?.allocatedStats || {
    FOR: 0,
    INT: 0,
    AGI: 0,
    VIT: 0,
  };
  const newAllocated = {
    ...currentAllocated,
    [statName]: (currentAllocated[statName] ?? 0) + amount,
  };

  // Recalcular stats totais
  const newStats = calculateTotalStats({
    ...player,
    stats: {
      ...player.stats,
      allocatedStats: newAllocated,
      availableStatPoints: available - amount,
    },
  });

  // Preparar atualizações
  const updates = {};
  const derived = buildDerivedStatSnapshot(newStats);
  const statsPaths = [
    PATHS.playerStats?.(playerId) || `online_players/${playerId}/stats`,
    PATHS.playerDataStats?.(playerId) || `players_data/${playerId}/stats`,
  ];

  for (const playerStatsPath of statsPaths) {
    updates[`${playerStatsPath}/allocatedStats`] = newAllocated;
    updates[`${playerStatsPath}/availableStatPoints`] = available - amount;
    updates[`${playerStatsPath}/maxHp`] = newStats.maxHp;
    updates[`${playerStatsPath}/maxMp`] = newStats.maxMp;
    for (const [key, value] of Object.entries(derived)) {
      updates[`${playerStatsPath}/${key}`] = value;
    }
  }

  // Atualizar HP/MP atuais proporcionalmente
  const hpRatio = (player.stats?.hp ?? 100) / (player.stats?.maxHp ?? 100);
  const mpRatio = (player.stats?.mp ?? 50) / (player.stats?.maxMp ?? 50);
  const nextHp = Math.floor(newStats.maxHp * hpRatio);
  const nextMp = Math.floor(newStats.maxMp * mpRatio);
  for (const playerStatsPath of statsPaths) {
    updates[`${playerStatsPath}/hp`] = nextHp;
    updates[`${playerStatsPath}/mp`] = nextMp;
  }

  await batchWrite(updates);

  // Atualizar worldStore local
  applyPlayersLocal(playerId, {
    stats: {
      ...player.stats,
      allocatedStats: newAllocated,
      availableStatPoints: available - amount,
      maxHp: newStats.maxHp,
      maxMp: newStats.maxMp,
      hp: nextHp,
      mp: nextMp,
      ...derived,
    },
  });

  // Emitir evento
  worldEvents.emit(EVENT_TYPES.PROGRESSION_STAT_ALLOCATED, {
    playerId,
    statName,
    amount,
    newValue: newAllocated[statName],
    totalStats: newStats.totalStats,
    availablePoints: available - amount,
    timestamp: Date.now(),
  });

  return {
    success: true,
    statName,
    amount,
    newValue: newAllocated[statName],
    totalStats: newStats.totalStats,
    availablePoints: available - amount,
  };
}

// =============================================================================
// HELPERS PARA COMBATE (integração com combatService)
// =============================================================================

/**
 * Obtém poder de ataque baseado nos atributos do jogador
 */
export function getAttackPower(player, weaponDamage = 0) {
  const stats = calculateTotalStats(player);
  const classConfig =
    stats.classConfig || PROGRESSION_CONFIG.classGrowth.cavaleiro;

  // Classes físicas usam FOR, classes mágicas usam INT
  if (classConfig.primary === "INT") {
    return weaponDamage + stats.totalStats.INT * 1.5;
  }
  return weaponDamage + stats.totalStats.FOR * 1.5;
}

/**
 * Obtém poder mágico baseado em INT
 */
export function getSpellPower(player) {
  const stats = calculateTotalStats(player);
  return stats.spellPower || stats.totalStats.INT * 2.0;
}

/**
 * Obtém poder de cura baseado em INT
 */
export function getHealPower(player) {
  const stats = calculateTotalStats(player);
  return stats.healPower || stats.totalStats.INT * 2.0;
}

/**
 * Obtém chance de crítico baseado em AGI
 */
export function getCritChance(player) {
  const stats = calculateTotalStats(player);
  return stats.critChance || 0.05 + stats.totalStats.AGI * 0.005;
}

/**
 * Obtém defesa total baseada em VIT e DEF
 */
export function getDefense(player, baseDef = 0) {
  const stats = calculateTotalStats(player);
  return baseDef + stats.totalStats.VIT * 0.5 + stats.totalStats.AGI * 0.2;
}

/**
 * Recalcula todos os stats de um jogador (após mudança de equipamento, buff, etc.)
 */
export async function recalculatePlayerStats(playerId) {
  const player = getPlayer(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  const newStats = calculateTotalStats(player);
  const derived = buildDerivedStatSnapshot(newStats);

  const updates = {};
  const statsPaths = [
    PATHS.playerStats?.(playerId) || `online_players/${playerId}/stats`,
    PATHS.playerDataStats?.(playerId) || `players_data/${playerId}/stats`,
  ];

  for (const playerStatsPath of statsPaths) {
    updates[`${playerStatsPath}/maxHp`] = newStats.maxHp;
    updates[`${playerStatsPath}/maxMp`] = newStats.maxMp;
    for (const [key, value] of Object.entries(derived)) {
      updates[`${playerStatsPath}/${key}`] = value;
    }
  }

  await batchWrite(updates);

  applyPlayersLocal(playerId, {
    stats: {
      ...player.stats,
      maxHp: newStats.maxHp,
      maxMp: newStats.maxMp,
      ...derived,
    },
  });

  worldEvents.emit(EVENT_TYPES.PROGRESSION_STATS_RECALCULATED, {
    playerId,
    totalStats: newStats.totalStats,
    maxHp: newStats.maxHp,
    maxMp: newStats.maxMp,
    timestamp: Date.now(),
  });

  return { success: true, stats: newStats };
}
