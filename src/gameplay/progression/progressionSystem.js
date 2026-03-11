// =============================================================================
// progressionSystem.js — mmoRPGEduc (REFINADO - Estilo MMORPG)
//
// Arquitetura MMORPG Clássico:
// • AUTO-GROWTH: HP/MP/Stats crescem automaticamente por nível (por classe)
// • MANUAL POINTS: 5 pontos por nível para distribuir livremente
// • CLASS BONUS: Cada classe tem eficiência diferente ao gastar pontos
// • SOFT CAP: Atributos têm retornos decrescentes para balanceamento
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../core/events.js";
import { batchWrite, PATHS } from "../../core/db.js";
import { getPlayer, applyPlayersLocal } from "../../core/worldStore.js";

// =============================================================================
// CONFIGURAÇÃO MMORPG-STYLE
// =============================================================================

export const PROGRESSION_CONFIG = Object.freeze({
  // === CURVA DE XP ===
  // Fórmula: base * (level ^ exponent)
  // Quadrática suave — cresce mais rápido nos níveis altos que linear,
  // mas sem a explosão exponencial.
  xpCurve: {
    base: 100,
    exponent: 1.75,
    maxLevel: 100,
  },

  // === PONTOS DE ATRIBUTO ===
  statPointsPerLevel: 5, // ✅ Sua sugestão: 5 pontos para distribuir

  // === AUTO-GROWTH POR CLASSE (por nível) ===
  // Estes valores são ADICIONADOS automaticamente ao subir de nível
  classAutoGrowth: {
    cavaleiro: {
      hpPerLevel: 18, // +18 HP automático por nível
      mpPerLevel: 3, // +3 MP automático por nível
      statsPerLevel: { FOR: 1.2, VIT: 0.8, AGI: 0.3, INT: 0.0 },
      description: "Tanque: alto HP, bônus em FOR e VIT",
    },
    mago: {
      hpPerLevel: 6,
      mpPerLevel: 15, // +15 MP automático por nível
      statsPerLevel: { FOR: 0.0, VIT: 0.2, AGI: 0.3, INT: 1.5 },
      spellPowerPerInt: 2.8, // Eficiência mágica alta
      description: "Dano mágico: alto MP, bônus massivo em INT",
    },
    arqueiro: {
      hpPerLevel: 10,
      mpPerLevel: 5,
      statsPerLevel: { FOR: 0.8, VIT: 0.3, AGI: 1.4, INT: 0.0 },
      critPerAgi: 0.8, // Eficiência de crítico
      description: "Precisão: bônus em AGI para crítico e esquiva",
    },
    druid: {
      hpPerLevel: 12,
      mpPerLevel: 10,
      statsPerLevel: { FOR: 0.4, VIT: 0.7, AGI: 0.2, INT: 1.0 },
      spellPowerPerInt: 2.2,
      description: "Híbrido: equilíbrio entre magia e sobrevivência",
    },
    clerigo: {
      hpPerLevel: 12,
      mpPerLevel: 12,
      statsPerLevel: { FOR: 0.2, VIT: 0.8, AGI: 0.2, INT: 1.1 },
      healPowerPerInt: 3.0, // Eficiência de cura alta
      description: "Suporte: bônus em INT para cura e MP",
    },
  },

  // === EFICIÊNCIA DE PONTOS MANUAIS POR CLASSE ===
  // Quando jogador gasta 1 ponto manual, quanto ele ganha de stat?
  // Valores > 1.0 = bônus de classe, < 1.0 = penalidade
  manualStatEfficiency: {
    cavaleiro: { FOR: 1.3, VIT: 1.2, AGI: 0.9, INT: 0.5 },
    mago: { FOR: 0.4, VIT: 0.7, AGI: 0.8, INT: 1.5 },
    arqueiro: { FOR: 1.0, VIT: 0.8, AGI: 1.4, INT: 0.5 },
    druid: { FOR: 0.7, VIT: 1.0, AGI: 0.7, INT: 1.2 },
    clerigo: { FOR: 0.5, VIT: 1.1, AGI: 0.7, INT: 1.3 },
  },

  // === CONVERSÃO DE ATRIBUTOS PARA COMBATE ===
  // Quanto cada atributo vale em termos de poder de combate
  statConversions: {
    FOR: { attackPower: 1.5, hpBonus: 0 }, // 1 FOR = +1.5 dano físico
    INT: { spellPower: 2.5, healPower: 2.8, mpBonus: 0 }, // 1 INT = +2.5 dano mágico
    AGI: { critChance: 0.6, evasion: 0.3 }, // 1 AGI = +0.6% crítico
    VIT: { hpBonus: 10, defense: 0.4 }, // 1 VIT = +10 HP, +0.4 defesa
  },

  // === SOFT CAPS (retornos decrescentes para balanceamento) ===
  // Após certo valor, atributos rendem menos para evitar power creep
  softCaps: {
    FOR: { threshold: 50, decay: 0.7 }, // Após 50 FOR, cada ponto vale 70%
    INT: { threshold: 50, decay: 0.7 },
    AGI: { threshold: 40, decay: 0.8 },
    VIT: { threshold: 60, decay: 0.8 },
  },

  // === ATRIBUTOS VÁLIDOS ===
  validStats: ["FOR", "INT", "AGI", "VIT"],
});

// =============================================================================
// CÁLCULOS DE PROGRESSÃO
// =============================================================================

/**
 * Calcula XP necessário para o próximo nível.
 * Fórmula: floor(base * level^exponent)
 *   Nível 1 → 2 :   100 XP
 *   Nível 5 → 6 : 1.546 XP
 *   Nível 10 → 11: 5.623 XP
 *   Nível 20 → 21: 20.000 XP
 *   Nível 50 → 51: 102.800 XP
 */
export function getXpToNextLevel(currentLevel) {
  const { base, exponent } = PROGRESSION_CONFIG.xpCurve;
  return Math.floor(base * Math.pow(currentLevel, exponent));
}

/**
 * Calcula nível baseado no XP total
 */
export function getLevelFromXp(totalXp) {
  let level = 1;
  let xpAccumulated = 0;
  const { maxLevel } = PROGRESSION_CONFIG.xpCurve;

  while (
    xpAccumulated + getXpToNextLevel(level) <= totalXp &&
    level < maxLevel
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
 * Aplica soft cap a um valor de atributo
 * Retorna o valor efetivo após decaimento
 */
export function applySoftCap(statName, baseValue) {
  const softCap = PROGRESSION_CONFIG.softCaps[statName];
  if (!softCap || baseValue <= softCap.threshold) {
    return baseValue;
  }
  // Após o threshold, cada ponto extra vale 'decay' do valor original
  const excess = baseValue - softCap.threshold;
  return softCap.threshold + excess * softCap.decay;
}

/**
 * Calcula atributos totais de um jogador
 * Separa: auto-growth (automático por nível) + manual points (distribuídos)
 */
export function calculateTotalStats(player) {
  const classConfig =
    PROGRESSION_CONFIG.classAutoGrowth[player.class] ||
    PROGRESSION_CONFIG.classAutoGrowth.cavaleiro;
  const efficiency =
    PROGRESSION_CONFIG.manualStatEfficiency[player.class] ||
    PROGRESSION_CONFIG.manualStatEfficiency.cavaleiro;
  const level = player.stats?.level ?? 1;

  // Stats distribuídos manualmente pelo jogador
  const manualStats = player.stats?.allocatedStats || {
    FOR: 0,
    INT: 0,
    AGI: 0,
    VIT: 0,
  };

  // === AUTO-GROWTH: cresce automaticamente com o nível ===
  const autoStats = {
    FOR: Math.floor((classConfig.statsPerLevel.FOR || 0) * (level - 1)),
    INT: Math.floor((classConfig.statsPerLevel.INT || 0) * (level - 1)),
    AGI: Math.floor((classConfig.statsPerLevel.AGI || 0) * (level - 1)),
    VIT: Math.floor((classConfig.statsPerLevel.VIT || 0) * (level - 1)),
  };

  // === MANUAL STATS: aplicados com eficiência de classe + soft cap ===
  const effectiveManual = {};
  for (const stat of PROGRESSION_CONFIG.validStats) {
    const baseManual = manualStats[stat] || 0;
    const efficiencyMult = efficiency[stat] || 1.0;
    const rawValue = baseManual * efficiencyMult;
    effectiveManual[stat] = applySoftCap(stat, rawValue);
  }

  // Stats totais = auto + manual efetivo
  const totalStats = {
    FOR: autoStats.FOR + effectiveManual.FOR,
    INT: autoStats.INT + effectiveManual.INT,
    AGI: autoStats.AGI + effectiveManual.AGI,
    VIT: autoStats.VIT + effectiveManual.VIT,
  };

  // === HP/MP: base + auto-growth + bônus de VIT/INT ===
  const baseHp = 100;
  const baseMp = 50;
  const hpFromVit =
    totalStats.VIT * PROGRESSION_CONFIG.statConversions.VIT.hpBonus;
  const mpFromInt =
    totalStats.INT * PROGRESSION_CONFIG.statConversions.INT.mpBonus;

  const maxHp = Math.floor(
    baseHp + classConfig.hpPerLevel * (level - 1) + hpFromVit,
  );
  const maxMp = Math.floor(
    baseMp + classConfig.mpPerLevel * (level - 1) + mpFromInt,
  );

  // === PODERES DERIVADOS ===
  const spellPower =
    totalStats.INT *
    (classConfig.spellPowerPerInt ||
      PROGRESSION_CONFIG.statConversions.INT.spellPower);
  const healPower =
    totalStats.INT *
    (classConfig.healPowerPerInt ||
      PROGRESSION_CONFIG.statConversions.INT.healPower);
  const critChance =
    0.05 +
    (totalStats.AGI *
      (classConfig.critPerAgi ||
        PROGRESSION_CONFIG.statConversions.AGI.critChance)) /
      100;
  const defense =
    5 +
    totalStats.VIT * PROGRESSION_CONFIG.statConversions.VIT.defense +
    totalStats.AGI * PROGRESSION_CONFIG.statConversions.AGI.evasion;

  return {
    autoStats, // Crescimento automático da classe
    manualStats, // Pontos distribuídos pelo jogador (brutos)
    effectiveManual, // Pontos manuais após eficiência + soft cap
    totalStats, // Soma final: auto + efetivo
    maxHp,
    maxMp,
    spellPower,
    healPower,
    critChance: Math.min(0.5, critChance), // Cap de 50% crítico
    defense,
    availablePoints: player.stats?.availableStatPoints ?? 0,
    classConfig,
    efficiency,
  };
}

/**
 * Inicializa stats de um jogador novo (nível 1)
 */
export function initializePlayerStats(playerClass) {
  const classConfig =
    PROGRESSION_CONFIG.classAutoGrowth[playerClass] ||
    PROGRESSION_CONFIG.classAutoGrowth.cavaleiro;

  return {
    level: 1,
    xp: 0,
    totalXp: 0,
    availableStatPoints: 0, // Começa com 0, ganha 5 ao subir para nível 2
    allocatedStats: { FOR: 0, INT: 0, AGI: 0, VIT: 0 },
    // HP/MP base + auto-growth do nível 1 (que é 0, pois growth é por level-1)
    maxHp: 100,
    maxMp: 50,
    hp: 100,
    mp: 50,
  };
}

// =============================================================================
// PROCESSAMENTO DE XP E LEVEL UP
// =============================================================================

/**
 * Processa ganho de XP e verifica level up
 * Ao subir de nível: concede 5 pontos + auto-growth de HP/MP/stats
 */
export async function processXpGain(playerId, xpAmount, source = "monster") {
  const player = getPlayer(playerId);
  if (!player) {
    console.warn(`[progressionSystem] processXpGain: jogador não encontrado no store local — id="${playerId}"`);
    return { success: false, error: "Jogador não encontrado" };
  }

  const currentLevel = player.stats?.level ?? 1;
  const newXpTotal = (player.stats?.totalXp ?? 0) + xpAmount;

  // Calcular novo nível
  const levelData = getLevelFromXp(newXpTotal);
  const leveledUp = levelData.level > currentLevel;
  const levelsGained = levelData.level - currentLevel;

  // Calcular pontos ganhos (5 por nível)
  const pointsGained = levelsGained * PROGRESSION_CONFIG.statPointsPerLevel;

  // Preparar atualizações — escreve nos dois caminhos para persistência correta
  const updates = {};
  const onlinePath = PATHS.playerStats(playerId);
  const dataPath = PATHS.playerDataStats(playerId);

  function _set(field, value) {
    updates[`${onlinePath}/${field}`] = value;
    updates[`${dataPath}/${field}`] = value;
  }

  _set("xp", levelData.currentXp);
  _set("totalXp", newXpTotal);

  if (leveledUp) {
    _set("level", levelData.level);
    _set("availableStatPoints", (player.stats?.availableStatPoints ?? 0) + pointsGained);

    // ✅ AUTO-GROWTH: recalcular HP/MP máximos com novo nível
    const tempPlayer = {
      ...player,
      stats: { ...player.stats, level: levelData.level },
    };
    const newStats = calculateTotalStats(tempPlayer);

    _set("maxHp", newStats.maxHp);
    _set("maxMp", newStats.maxMp);
    // Cura completa no level up (estilo MMORPG)
    _set("hp", newStats.maxHp);
    _set("mp", newStats.maxMp);
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
      maxHp: updates[`${onlinePath}/maxHp`] ?? player.stats?.maxHp,
      maxMp: updates[`${onlinePath}/maxMp`] ?? player.stats?.maxMp,
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
      autoGrowth: {
        hpGain:
          (updates[`${onlinePath}/maxHp`] ?? 0) -
          (player.stats?.maxHp ?? 100),
        mpGain:
          (updates[`${onlinePath}/maxMp`] ?? 0) -
          (player.stats?.maxMp ?? 50),
      },
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
// DISTRIBUIÇÃO DE PONTOS MANUAIS
// =============================================================================

/**
 * Distribui pontos de atributo manualmente
 * Aplica eficiência de classe e soft caps
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

  // Atualizar atributos alocados (valores brutos, eficiência aplicada no cálculo)
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

  // Recalcular stats totais com nova distribuição
  const newStats = calculateTotalStats({
    ...player,
    stats: {
      ...player.stats,
      allocatedStats: newAllocated,
      availableStatPoints: available - amount,
    },
  });

  // Preparar atualizações — escreve nos dois caminhos para persistência correta
  const updates = {};
  const onlinePath = PATHS.playerStats(playerId);
  const dataPath = PATHS.playerDataStats(playerId);

  function _set(field, value) {
    updates[`${onlinePath}/${field}`] = value;
    updates[`${dataPath}/${field}`] = value;
  }

  _set("allocatedStats", newAllocated);
  _set("availableStatPoints", available - amount);
  _set("maxHp", newStats.maxHp);
  _set("maxMp", newStats.maxMp);

  // Manter HP/MP atuais proporcionalmente
  const hpRatio = (player.stats?.hp ?? 100) / (player.stats?.maxHp ?? 100);
  const mpRatio = (player.stats?.mp ?? 50) / (player.stats?.maxMp ?? 50);
  _set("hp", Math.floor(newStats.maxHp * hpRatio));
  _set("mp", Math.floor(newStats.maxMp * mpRatio));

  await batchWrite(updates);

  // Atualizar worldStore local
  applyPlayersLocal(playerId, {
    stats: {
      ...player.stats,
      allocatedStats: newAllocated,
      availableStatPoints: available - amount,
      maxHp: newStats.maxHp,
      maxMp: newStats.maxMp,
      hp: updates[`${playerStatsPath}/hp`],
      mp: updates[`${playerStatsPath}/mp`],
    },
  });

  // Emitir evento com detalhes para UI
  worldEvents.emit(EVENT_TYPES.PROGRESSION_STAT_ALLOCATED, {
    playerId,
    statName,
    amount,
    rawPointsAdded: amount,
    effectiveGain:
      newStats.effectiveManual[statName] -
      player.stats?.allocatedStats?.[statName] *
        (PROGRESSION_CONFIG.manualStatEfficiency[player.class]?.[statName] ||
          1),
    newValue: newStats.totalStats[statName],
    totalStats: newStats.totalStats,
    availablePoints: available - amount,
    efficiency:
      PROGRESSION_CONFIG.manualStatEfficiency[player.class]?.[statName] || 1,
    timestamp: Date.now(),
  });

  return {
    success: true,
    statName,
    amount,
    rawPointsAdded: amount,
    effectiveGain:
      newStats.effectiveManual[statName] -
      (newAllocated[statName] - amount) *
        (PROGRESSION_CONFIG.manualStatEfficiency[player.class]?.[statName] ||
          1),
    newValue: newStats.totalStats[statName],
    totalStats: newStats.totalStats,
    availablePoints: available - amount,
  };
}

// =============================================================================
// HELPERS PARA COMBATE (integração com combatService)
// =============================================================================

export function getAttackPower(player, weaponDamage = 0) {
  const stats = calculateTotalStats(player);
  return (
    weaponDamage +
    stats.totalStats.FOR * PROGRESSION_CONFIG.statConversions.FOR.attackPower
  );
}

export function getSpellPower(player) {
  const stats = calculateTotalStats(player);
  return stats.spellPower;
}

export function getHealPower(player) {
  const stats = calculateTotalStats(player);
  return stats.healPower;
}

export function getCritChance(player) {
  const stats = calculateTotalStats(player);
  return stats.critChance;
}

export function getDefense(player, baseDef = 0) {
  const stats = calculateTotalStats(player);
  return baseDef + stats.defense;
}

export function getMaxHp(player) {
  const stats = calculateTotalStats(player);
  return stats.maxHp;
}

export function getMaxMp(player) {
  const stats = calculateTotalStats(player);
  return stats.maxMp;
}

/**
 * Recalcula todos os stats (após equipamento, buff, etc.)
 */
export async function recalculatePlayerStats(playerId) {
  const player = getPlayer(playerId);
  if (!player) return { success: false, error: "Jogador não encontrado" };

  const newStats = calculateTotalStats(player);

  const onlinePath = PATHS.playerStats(playerId);
  const dataPath = PATHS.playerDataStats(playerId);
  const updates = {
    [`${onlinePath}/maxHp`]: newStats.maxHp,
    [`${onlinePath}/maxMp`]: newStats.maxMp,
    [`${dataPath}/maxHp`]: newStats.maxHp,
    [`${dataPath}/maxMp`]: newStats.maxMp,
  };

  await batchWrite(updates);

  applyPlayersLocal(playerId, {
    stats: {
      ...player.stats,
      maxHp: newStats.maxHp,
      maxMp: newStats.maxMp,
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

// =============================================================================
// UTILITÁRIOS PARA UI
// =============================================================================

/**
 * Retorna descrição do bônus de classe para tooltip
 */
export function getClassProgressionInfo(className) {
  const config = PROGRESSION_CONFIG.classAutoGrowth[className];
  const efficiency = PROGRESSION_CONFIG.manualStatEfficiency[className];

  if (!config) return null;

  return {
    autoGrowth: {
      hp: config.hpPerLevel,
      mp: config.mpPerLevel,
      stats: config.statsPerLevel,
    },
    manualEfficiency: efficiency,
    description: config.description,
  };
}

/**
 * Calcula preview de stats ao gastar X pontos em um atributo
 * (para tooltip da UI antes de confirmar)
 */
export function previewStatAllocation(player, statName, pointsToSpend) {
  const current = calculateTotalStats(player);
  const efficiency = current.efficiency[statName] || 1.0;
  const currentManual = current.manualStats[statName] || 0;

  // Calcular novo valor bruto
  const newManualRaw = (currentManual + pointsToSpend) * efficiency;
  const newManualEffective = applySoftCap(statName, newManualRaw);
  const oldManualEffective = applySoftCap(statName, currentManual * efficiency);

  const effectiveGain = newManualEffective - oldManualEffective;
  const newTotal = current.totalStats[statName] + effectiveGain;

  // Calcular impactos derivados
  let hpGain = 0,
    mpGain = 0,
    spellPowerGain = 0,
    critGain = 0;

  if (statName === "VIT") {
    hpGain = Math.floor(
      effectiveGain * PROGRESSION_CONFIG.statConversions.VIT.hpBonus,
    );
  } else if (statName === "INT") {
    mpGain = Math.floor(
      effectiveGain * PROGRESSION_CONFIG.statConversions.INT.mpBonus,
    );
    spellPowerGain =
      effectiveGain *
      (current.classConfig.spellPowerPerInt ||
        PROGRESSION_CONFIG.statConversions.INT.spellPower);
  } else if (statName === "AGI") {
    critGain =
      (effectiveGain *
        (current.classConfig.critPerAgi ||
          PROGRESSION_CONFIG.statConversions.AGI.critChance)) /
      100;
  }

  return {
    statName,
    pointsToSpend,
    currentTotal: current.totalStats[statName],
    newTotal,
    effectiveGain,
    efficiency,
    derived: { hpGain, mpGain, spellPowerGain, critGain },
  };
}
