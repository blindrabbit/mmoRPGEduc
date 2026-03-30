#!/usr/bin/env node
// =============================================================================
// monsterExtractor.js — Extrai dados de monstros do Lua (Canary)
// =============================================================================
// ✅ Normalização de nomes + Extração de IDs para Atlas de Monstros
// =============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, "assets");
const MONSTER_DATA_OUTPUT = path.join(__dirname, "src", "gameplay");
const CANARY_MONSTER_DIR = "G:\\Meu Drive\\SEDU\\2026\\RPG_Novo\\canary\\data-canary\\monster";

// =============================================================================
// NORMALIZAÇÃO DE NOMES
// =============================================================================

/**
 * Normaliza nome do monstro para lowercase snake_case
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')  // espaços → underscore
    .replace(/[^a-z0-9_]/g, '');  // remove caracteres especiais
}

/**
 * Converte nome do XML para nome do arquivo Lua
 * @param {string} xmlName
 * @returns {string}
 */
function xmlToLuaName(xmlName) {
  const normalized = normalizeName(xmlName);
  
  // Mapeamento direto
  const mapping = {
    'wolf': 'wolf',
    'rotworm': 'rotworm',
    'rat': 'cave_rat',
    'dragon': 'dragon',
    'dragon_lord': 'dragon_lord',
    'orc': 'orc',
    'orc_spearman': 'orc_spearman',
    'orc_warrior': 'orc_warrior',
    'goblin': 'goblin',
    'skeleton': 'skeleton',
    'dwarf': 'dwarf',
    'dwarf_soldier': 'dwarf_soldier',
    'dwarf_guard': 'dwarf_guard',
    'minotaur': 'minotaur',
    'minotaur_archer': 'minotaur_archer',
    'minotaur_guard': 'minotaur_guard',
    'demon': 'demon',
    'fire_devil': 'fire_devil',
    'lich': 'lich',
    'ghoul': 'ghoul',
    'zombie': 'zombie',
    'spider': 'spider',
    'giant_spider': 'giant_spider',
    'scorpion': 'scorpion',
    'crab': 'crab',
    'snake': 'snake',
    'crocodile': 'crocodile',
    'turtle': 'turtle',
    'chicken': 'chicken',
    'rabbit': 'rabbit',
    'deer': 'deer',
    'dog': 'dog',
    'cat': 'cat',
    'bat': 'bat',
    'bear': 'bear',
    'polar_bear': 'polar_bear',
    'tiger': 'tiger',
    'lion': 'lion',
    'war_wolf': 'war_wolf',
    'winter_wolf': 'winter_wolf',
    'boar': 'boar',
    'badger': 'badger',
    'fox': 'fox',
    'raccoon': 'raccoon',
    'skunk': 'skunk',
    'stag': 'stag',
    'moose': 'moose',
    'elephant': 'elephant',
    'mammoth': 'mammoth',
    'rhino': 'rhino',
    'hippo': 'hippo',
    'gorilla': 'gorilla',
    'monkey': 'monkey',
    'parrot': 'parrot',
    'pirate': 'pirate',
    'bandit': 'bandit',
    'thief': 'thief',
    'assassin': 'assassin',
    'knight': 'knight',
    'paladin': 'paladin',
    'mage': 'mage',
    'priest': 'priest',
    'witch': 'witch',
    'wizard': 'wizard',
    'sorcerer': 'sorcerer',
    'dragon_hatchling': 'dragon_hatchling',
    'dragon_lord_hatchling': 'dragon_lord_hatchling',
    'wyrm': 'wyrm',
    'hydra': 'hydra',
    'serpent_spawn': 'serpent_spawn',
    'medusa': 'medusa',
    'naga': 'naga',
    'sea_serpent': 'sea_serpent',
    'water_elemental': 'water_elemental',
    'fire_elemental': 'fire_elemental',
    'energy_elemental': 'energy_elemental',
    'earth_elemental': 'earth_elemental',
    'ice_golem': 'ice_golem',
    'stone_golem': 'stone_golem',
    'iron_golem': 'iron_golem',
    'gargoyle': 'gargoyle',
    'goblin_assassin': 'goblin_assassin',
    'goblin_leader': 'goblin_leader',
    'goblin_scavenger': 'goblin_scavenger',
    'orc_leader': 'orc_leader',
    'orc_berserker': 'orc_berserker',
    'orc_marauder': 'orc_marauder',
    'orc_shaman': 'orc_shaman',
    'orc_rider': 'orc_rider',
    'ogre': 'ogre',
    'ogre_brute': 'ogre_brute',
    'ogre_savage': 'ogre_savage',
    'ogre_rowdy': 'ogre_rowdy',
    'cyclops': 'cyclops',
    'cyclops_smith': 'cyclops_smith',
    'cyclops_drone': 'cyclops_drone',
    'frost_giant': 'frost_giant',
    'frost_giantess': 'frost_giantess',
    'juggernaut': 'juggernaut',
    'behemoth': 'behemoth',
    'nightmare': 'nightmare',
    'nightstalker': 'nightstalker',
    'demon_skeleton': 'demon_skeleton',
    'undead_dragon': 'undead_dragon',
    'undead_mine_worker': 'undead_mine_worker',
    'undead_prospector': 'undead_prospector',
    'undead_elite_gladiator': 'undead_elite_gladiator',
    'bonebeast': 'bonebeast',
    'blightwalker': 'blightwalker',
    'vampire': 'vampire',
    'vampire_bride': 'vampire_bride',
    'vampire_viscount': 'vampire_viscount',
    'vampire_lord': 'vampire_lord',
    'werewolf': 'werewolf',
    'grim_reaper': 'grim_reaper',
    'banshee': 'banshee',
    'ghost': 'ghost',
    'spectre': 'spectre',
    'wisp': 'wisp',
    'bog_raider': 'bog_raider',
    'slime': 'slime',
    'acid_blob': 'acid_blob',
    'death_blob': 'death_blob',
    'tar_blob': 'tar_blob',
    'mercury_blob': 'mercury_blob',
    'oil_blob': 'oil_blob',
    'lava_blob': 'lava_blob',
    'magma_crawler': 'magma_crawler',
    'blood_beast': 'blood_beast',
    'deep_terror': 'deep_terror',
    'devourer': 'devourer',
  };
  
  return mapping[normalized] || normalized;
}

// =============================================================================
// CARREGAR DADOS DO CANARY (LUA)
// =============================================================================

/**
 * Carrega todos os arquivos .lua de monstros recursivamente
 * @returns {Object} Mapa de nome normalizado -> dados do monstro
 */
function loadAllCanaryMonsters() {
  const monsters = {};
  
  if (!fs.existsSync(CANARY_MONSTER_DIR)) {
    console.log(`⚠️  Diretório Canary não encontrado: ${CANARY_MONSTER_DIR}`);
    return monsters;
  }
  
  // Buscar recursivamente todos os arquivos .lua
  const luaFiles = findAllLuaFiles(CANARY_MONSTER_DIR);
  console.log(`📁 Encontrados ${luaFiles.length} arquivos .lua de monstros`);
  
  for (const filePath of luaFiles) {
    try {
      const luaContent = fs.readFileSync(filePath, 'utf-8');
      const monsterData = parseLuaMonster(luaContent, filePath);
      
      if (monsterData && monsterData.name) {
        // ✅ NORMALIZAR NOME
        const normalizedName = normalizeName(monsterData.name);
        console.log(`  ✅ ${normalizedName} (${path.basename(filePath)})`);
        monsters[normalizedName] = monsterData;
      } else {
        console.log(`  ⚠️  Sem nome: ${filePath}`);
      }
    } catch (e) {
      console.warn(`⚠️  Erro ao ler ${filePath}: ${e.message}`);
    }
  }
  
  return monsters;
}

/**
 * Busca recursivamente todos os arquivos .lua em um diretório
 * @param {string} dir
 * @returns {string[]} Array de caminhos de arquivos
 */
function findAllLuaFiles(dir) {
  const files = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...findAllLuaFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.lua')) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    console.warn(`⚠️  Erro ao ler diretório ${dir}: ${e.message}`);
  }
  
  return files;
}

/**
 * Parse de arquivo Lua de monstro do Canary
 * @param {string} luaContent
 * @param {string} filePath
 * @returns {Object} Dados extraídos
 */
function parseLuaMonster(luaContent, filePath) {
  const data = {
    name: null,
    description: '',
    health: 0,
    maxHealth: 0,
    experience: 0,
    speed: 0,
    corpse: null,
    lookType: null,  // ✅ ID DO SPRITE
    lookHead: 0,
    lookBody: 0,
    lookLegs: 0,
    lookFeet: 0,
    lookAddons: 0,
    raceId: null,    // ✅ ID DA RAÇA
    flags: {},
    voices: [],
    attacks: [],
    loot: [],
    elements: {},
    immunities: [],
  };
  
  // Extrair nome: Game.createMonsterType("Wolf")
  const nameMatch = luaContent.match(/Game\.createMonsterType\(["']([^"']+)["']\)/);
  if (nameMatch) data.name = nameMatch[1];
  
  // Extrair description
  const descMatch = luaContent.match(/monster\.description\s*=\s*["']([^"']+)["']/);
  if (descMatch) data.description = descMatch[1];
  
  // Extrair health
  const healthMatch = luaContent.match(/monster\.health\s*=\s*(\d+)/);
  if (healthMatch) data.health = parseInt(healthMatch[1]);
  
  const maxHealthMatch = luaContent.match(/monster\.maxHealth\s*=\s*(\d+)/);
  if (maxHealthMatch) data.maxHealth = parseInt(maxHealthMatch[1]);
  
  // Extrair experience
  const expMatch = luaContent.match(/monster\.experience\s*=\s*(\d+)/);
  if (expMatch) data.experience = parseInt(expMatch[1]);
  
  // Extrair speed
  const speedMatch = luaContent.match(/monster\.speed\s*=\s*(\d+)/);
  if (speedMatch) data.speed = parseInt(speedMatch[1]);
  
  // ✅ Extrair corpse ID (para atlas de corpses)
  const corpseMatch = luaContent.match(/monster\.corpse\s*=\s*(\d+)/);
  if (corpseMatch) data.corpse = parseInt(corpseMatch[1]);
  
  // ✅ Extrair lookType (ID do sprite no atlas)
  const lookTypeMatch = luaContent.match(/lookType\s*=\s*(\d+)/);
  if (lookTypeMatch) data.lookType = parseInt(lookTypeMatch[1]);
  
  // Extrair lookHead/Body/Legs/Feet/Addons
  const lookHeadMatch = luaContent.match(/lookHead\s*=\s*(\d+)/);
  if (lookHeadMatch) data.lookHead = parseInt(lookHeadMatch[1]);
  
  const lookBodyMatch = luaContent.match(/lookBody\s*=\s*(\d+)/);
  if (lookBodyMatch) data.lookBody = parseInt(lookBodyMatch[1]);
  
  const lookLegsMatch = luaContent.match(/lookLegs\s*=\s*(\d+)/);
  if (lookLegsMatch) data.lookLegs = parseInt(lookLegsMatch[1]);
  
  const lookFeetMatch = luaContent.match(/lookFeet\s*=\s*(\d+)/);
  if (lookFeetMatch) data.lookFeet = parseInt(lookFeetMatch[1]);
  
  const lookAddonsMatch = luaContent.match(/lookAddons\s*=\s*(\d+)/);
  if (lookAddonsMatch) data.lookAddons = parseInt(lookAddonsMatch[1]);
  
  // ✅ Extrair raceId (ID da raça)
  const raceIdMatch = luaContent.match(/monster\.raceId\s*=\s*(\d+)/);
  if (raceIdMatch) data.raceId = parseInt(raceIdMatch[1]);
  
  // Extrair flags
  const flagsMatch = luaContent.match(/monster\.flags\s*=\s*\{([^}]+)\}/s);
  if (flagsMatch) {
    const flagsContent = flagsMatch[1];
    const flagPairs = flagsContent.match(/(\w+)\s*=\s*(true|false|\d+)/g);
    if (flagPairs) {
      for (const pair of flagPairs) {
        const [key, value] = pair.split(/\s*=\s*/);
        data.flags[key.trim()] = value.trim();
      }
    }
  }
  
  // Extrair voices: { text = "Yoooohhuuuu!", yell = false }
  const voiceRegex = /text\s*=\s*["']([^"']+)["'][^}]*yell\s*=\s*(true|false)/g;
  let voiceMatch;
  while ((voiceMatch = voiceRegex.exec(luaContent)) !== null) {
    data.voices.push({
      sentence: voiceMatch[1],
      yell: voiceMatch[2] === 'true',
    });
  }
  
  // Extrair attacks: { name = "melee", interval = 2000, minDamage = 0, maxDamage = -20 }
  const attackRegex = /name\s*=\s*["']([^"']+)["'][^}]*interval\s*=\s*(\d+)[^}]*minDamage\s*=\s*(-?\d+)[^}]*maxDamage\s*=\s*(-?\d+)/g;
  let attackMatch;
  while ((attackMatch = attackRegex.exec(luaContent)) !== null) {
    data.attacks.push({
      name: attackMatch[1],
      interval: parseInt(attackMatch[2]),
      minDamage: parseInt(attackMatch[3]),
      maxDamage: parseInt(attackMatch[4]),
    });
  }
  
  // Extrair loot: { id = 3577, chance = 55000, maxCount = 2 }
  const lootRegex = /id\s*=\s*(\d+)[^}]*chance\s*=\s*(\d+)[^}]*(?:maxCount\s*=\s*(\d+))?/g;
  let lootMatch;
  while ((lootMatch = lootRegex.exec(luaContent)) !== null) {
    data.loot.push({
      id: parseInt(lootMatch[1]),
      chance: parseInt(lootMatch[2]),
      countmax: lootMatch[3] ? parseInt(lootMatch[3]) : 1,
    });
  }
  
  // Extrair elements: { type = COMBAT_FIREDAMAGE, percent = 0 }
  const elementRegex = /type\s*=\s*(COMBAT_\w+)[^}]*percent\s*=\s*(-?\d+)/g;
  let elementMatch;
  while ((elementMatch = elementRegex.exec(luaContent)) !== null) {
    const type = elementMatch[1].replace('COMBAT_', '').replace('DAMAGE', '').toLowerCase();
    data.elements[type] = parseInt(elementMatch[2]);
  }
  
  // Extrair immunities: { type = "paralyze", condition = false }
  const immunityRegex = /type\s*=\s*["']([^"']+)["'][^}]*condition\s*=\s*(true|false)/g;
  let immunityMatch;
  while ((immunityMatch = immunityRegex.exec(luaContent)) !== null) {
    if (immunityMatch[2] === 'false') {
      data.immunities.push(immunityMatch[1]);
    }
  }
  
  return data;
}

// =============================================================================
// PARSER XML DE SPAWN
// =============================================================================

function parseMonsterXML(xmlString) {
  const spawns = [];
  const monsterBlockRegex = /<monster\s+([^>]*?)>\s*<monster\s+([^>]*?)\s*\/?>/g;
  let match;
  
  while ((match = monsterBlockRegex.exec(xmlString)) !== null) {
    const parentAttrs = parseAttributes(match[1]);
    const childAttrs = parseAttributes(match[2]);
    
    const spawn = {
      centerx: parentAttrs.centerx,
      centery: parentAttrs.centery,
      centerz: parentAttrs.centerz,
      radius: parentAttrs.radius,
      name: childAttrs.name,
      x: childAttrs.x || 0,
      y: childAttrs.y || 0,
      z: childAttrs.z || parentAttrs.centerz,
      spawntime: childAttrs.spawntime,
    };
    
    if (spawn.name) {
      spawns.push(spawn);
    }
  }
  
  return spawns;
}

function parseAttributes(attrStr) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  
  while ((match = attrRegex.exec(attrStr)) !== null) {
    const key = match[1];
    let value = match[2];
    
    if (/^\d+$/.test(value)) {
      value = parseInt(value, 10);
    } else if (/^\d+\.\d+$/.test(value)) {
      value = parseFloat(value);
    }
    
    attrs[key] = value;
  }
  
  return attrs;
}

// =============================================================================
// EXTRATOR DE DADOS
// =============================================================================

function extractMonsterData(spawns, canaryMonsters) {
  const monsterCatalog = new Map();
  const monsterSpawns = [];
  const monsterDataCanary = {};
  const atlasData = { monsters: {}, corpses: {} };
  
  for (const spawn of spawns) {
    const { name, centerx, centery, centerz, radius, x, y, z, spawntime } = spawn;
    
    if (!name) continue;
    
    // ✅ NORMALIZAR NOME DO XML
    const luaName = xmlToLuaName(name);
    const normalizedName = normalizeName(name);
    
    const posX = centerx + (x || 0);
    const posY = centery + (y || 0);
    const posZ = centerz + (z || 0);
    
    monsterSpawns.push({
      name: normalizedName,
      x: posX,
      y: posY,
      z: posZ,
      radius: radius || 1,
      spawntime: spawntime || 60,
    });
    
    if (!monsterCatalog.has(normalizedName)) {
      const canaryData = canaryMonsters[luaName] || null;
      
      // ✅ EXTRAIR IDs PARA ATLAS
      if (canaryData) {
        if (canaryData.lookType) {
          atlasData.monsters[normalizedName] = {
            lookType: canaryData.lookType,
            lookHead: canaryData.lookHead,
            lookBody: canaryData.lookBody,
            lookLegs: canaryData.lookLegs,
            lookFeet: canaryData.lookFeet,
            lookAddons: canaryData.lookAddons,
            raceId: canaryData.raceId,
          };
        }
        if (canaryData.corpse) {
          atlasData.corpses[normalizedName] = {
            corpseId: canaryData.corpse,
          };
        }
      }
      
      const corpseId = canaryData?.corpse || null;
      const corpseFrames = corpseId ? [String(corpseId)] : getCorpseFrames(normalizedName);
      const template = getBaseTemplate(normalizedName);
      const appearance = getAppearance(normalizedName);
      
      const monsterData = {
        name: canaryData?.name || name,
        normalizedName,
        appearance: {
          ...appearance,
          lookType: canaryData?.lookType || null,
          speed: canaryData?.speed || (template?.appearance?.speed || 100),
        },
        stats: {
          hp: canaryData?.maxHealth || template?.stats?.hp || 100,
          maxHp: canaryData?.maxHealth || template?.stats?.maxHp || 100,
          FOR: template?.stats?.FOR || 10,
          INT: template?.stats?.INT || 0,
          AGI: template?.stats?.AGI || 10,
          VIT: template?.stats?.VIT || 10,
          combatProfile: template?.stats?.combatProfile || 'balanced',
          level: template?.stats?.level || 5,
          xpValue: canaryData?.experience || template?.stats?.xpValue || 50,
        },
        behavior: {
          range: template?.behavior?.range || 10,
          loseAggro: template?.behavior?.loseAggro || 15,
          maxDistance: template?.behavior?.maxDistance || 20,
        },
        attacks: canaryData?.attacks?.length ?
          canaryData.attacks.map(a => ({
            name: a.name,
            type: 'melee',
            range: 1,
            damage: Math.abs(a.maxDamage),
            cooldown: a.interval,
            chance: 1,
            effectId: 1,
          })) :
          (template?.attacks || [
            { name: 'Melee', type: 'melee', range: 1, damage: 10, cooldown: 1500, chance: 1, effectId: 1 },
          ]),
        voices: canaryData?.voices || [],
        loot: canaryData?.loot || [],
        elements: canaryData?.elements || {},
        immunities: canaryData?.immunities || [],
        corpseFrames: corpseFrames,
        corpseDuration: 10000,
        respawnDelay: (spawntime || 60) * 1000,
        threatTier: template?.threatTier || 'common',
        canaryData: canaryData ? {
          flags: canaryData.flags,
          immunities: canaryData.immunities,
          elements: canaryData.elements,
          description: canaryData.description,
          raceId: canaryData.raceId,
          lookType: canaryData.lookType,
          corpse: canaryData.corpse,
        } : null,
      };
      
      monsterCatalog.set(normalizedName, monsterData);
      
      if (canaryData) {
        monsterDataCanary[normalizedName] = canaryData;
      }
    }
  }
  
  return {
    spawns: monsterSpawns,
    catalog: Object.fromEntries(monsterCatalog),
    canaryData: monsterDataCanary,
    atlasData,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function getBaseTemplate(normalizedName) {
  const templates = {
    'wolf': {
      stats: { hp: 25, FOR: 8, INT: 0, AGI: 12, VIT: 5, combatProfile: 'skirmisher', level: 2, xpValue: 18 },
      behavior: { range: 10, loseAggro: 15, maxDistance: 20 },
      attacks: [{ name: 'Bite', type: 'melee', range: 1, damage: 20, cooldown: 2000, chance: 1, effectId: 1 }],
      threatTier: 'starter',
    },
    'rotworm': {
      stats: { hp: 65, FOR: 10, INT: 0, AGI: 6, VIT: 8, combatProfile: 'balanced', level: 3, xpValue: 40 },
      behavior: { range: 8, loseAggro: 12, maxDistance: 15 },
      attacks: [{ name: 'Bite', type: 'melee', range: 1, damage: 12, cooldown: 1800, chance: 1, effectId: 1 }],
      threatTier: 'starter',
    },
    'cave_rat': {
      stats: { hp: 30, FOR: 3, INT: 0, AGI: 8, VIT: 2, combatProfile: 'skirmisher', level: 1, xpValue: 10 },
      behavior: { range: 10, loseAggro: 15, maxDistance: 20 },
      attacks: [{ name: 'Bite', type: 'melee', range: 1, damage: 6, cooldown: 1500, chance: 1, effectId: 1 }],
      threatTier: 'starter',
    },
  };
  
  return templates[normalizedName] || null;
}

function getAppearance(normalizedName) {
  const appearanceMap = {
    'wolf': { outfitId: 'wolf', outfitPack: 'monstros_01' },
    'cave_rat': { outfitId: 'rat', outfitPack: 'monstros_01' },
    'rotworm': { outfitId: 'rotworm', outfitPack: 'monstros_01' },
  };
  
  return appearanceMap[normalizedName] || { outfitId: normalizedName, outfitPack: 'monstros_01' };
}

function getCorpseFrames(normalizedName) {
  const corpseMap = {
    'wolf': ['5968', '5969', '5970'],
    'cave_rat': ['5971', '5972', '5973'],
    'rotworm': ['5974', '5975', '5976'],
  };
  
  return corpseMap[normalizedName] || ['5968'];
}

// =============================================================================
// GERADOR DE ARQUIVOS
// =============================================================================

function saveMonsterSpawns(spawns, outputPath) {
  const output = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalSpawns: spawns.length,
    spawns: spawns.sort((a, b) => {
      if (a.z !== b.z) return a.z - b.z;
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    }),
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ Spawns salvos: ${outputPath}`);
  console.log(`   Total: ${spawns.length} spawns`);
}

function saveMonsterCatalog(catalog, outputPath) {
  const output = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalMonsters: Object.keys(catalog).length,
    monsters: catalog,
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ Catálogo salvo: ${outputPath}`);
  console.log(`   Total: ${Object.keys(catalog).length} monstros únicos`);
}

function saveCanaryMonsterData(canaryData, outputPath) {
  const output = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalMonsters: Object.keys(canaryData).length,
    monsters: canaryData,
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ Dados Canary salvos: ${outputPath}`);
  console.log(`   Total: ${Object.keys(canaryData).length} monstros`);
}

function saveMonsterAtlasData(atlasData, outputPath) {
  const output = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalMonsters: Object.keys(atlasData.monsters).length,
    totalCorpses: Object.keys(atlasData.corpses).length,
    monsters: atlasData.monsters,
    corpses: atlasData.corpses,
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ Atlas data salvo: ${outputPath}`);
  console.log(`   Monstros: ${Object.keys(atlasData.monsters).length}`);
  console.log(`   Corpses: ${Object.keys(atlasData.corpses).length}`);
}

function saveMonsterDataGenerated(catalog, outputPath) {
  const sortedMonsters = Object.entries(catalog).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  let content = `// ═══════════════════════════════════════════════════════════════
// monsterData.generated.js — Gerado automaticamente por monsterExtractor.js
// NÃO EDITAR MANUALMENTE! Execute o extractor para atualizar.
// ═══════════════════════════════════════════════════════════════

export const MONSTER_SPAWN_DATA = {
  version: '1.0',
  generatedAt: '${new Date().toISOString()}',
  totalMonsters: ${sortedMonsters.length},
  monsters: {
`;

  for (const [key, monster] of sortedMonsters) {
    const safeKey = key;  // Já está normalizado
    content += `    ${safeKey}: ${JSON.stringify(monster, null, 4)
      .split('\n')
      .join('\n    ')},\n`;
  }

  content += `  },
};

export default MONSTER_SPAWN_DATA;
`;

  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`✅ Templates gerados: ${outputPath}`);
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Uso: node monsterExtractor.js <caminho-do-arquivo-xml>');
    console.log('Exemplo: node monsterExtractor.js assets/mapa-monster.xml');
    process.exit(1);
  }
  
  const xmlPath = args[0];
  
  if (!fs.existsSync(xmlPath)) {
    console.error(`❌ Arquivo não encontrado: ${xmlPath}`);
    process.exit(1);
  }
  
  console.log('🔍 Monster Extractor — Canary Lua para JSON');
  console.log('═══════════════════════════════════════════');
  console.log(`📄 Input XML: ${xmlPath}`);
  console.log(`📂 Canary Lua: ${CANARY_MONSTER_DIR}`);
  console.log();
  
  console.log('📖 Lendo XML de spawns...');
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  
  console.log('🔧 Parseando XML...');
  const spawns = parseMonsterXML(xmlContent);
  console.log(`   Encontrados: ${spawns.length} spawns`);
  
  console.log();
  console.log('📂 Carregando monstros do Canary (.lua)...');
  const canaryMonsters = loadAllCanaryMonsters();
  
  console.log();
  console.log('🔍 Extraindo dados e normalizando nomes...');
  const data = extractMonsterData(spawns, canaryMonsters);
  
  console.log();
  console.log('💾 Salvando arquivos...');
  
  saveMonsterSpawns(
    data.spawns,
    path.join(OUTPUT_DIR, 'monster_spawns.json')
  );
  
  saveMonsterCatalog(
    data.catalog,
    path.join(OUTPUT_DIR, 'monster_catalog.json')
  );
  
  if (Object.keys(data.canaryData).length > 0) {
    saveCanaryMonsterData(
      data.canaryData,
      path.join(OUTPUT_DIR, 'data_monster.json')
    );
    
    // ✅ SALVAR DADOS DO ATLAS
    saveMonsterAtlasData(
      data.atlasData,
      path.join(OUTPUT_DIR, 'atlas_monster_data.json')
    );
  } else {
    console.log('⚠️  Sem dados do Canary (arquivos .lua não encontrados)');
  }
  
  saveMonsterDataGenerated(
    data.catalog,
    path.join(MONSTER_DATA_OUTPUT, 'monsterData.generated.js')
  );
  
  console.log();
  console.log('✅ Extração concluída com sucesso!');
  console.log();
  console.log('📊 Resumo:');
  console.log(`   - Spawns totais: ${data.spawns.length}`);
  console.log(`   - Monstros únicos: ${Object.keys(data.catalog).length}`);
  console.log(`   - Dados Canary: ${Object.keys(data.canaryData).length}`);
  console.log(`   - IDs para Atlas: ${Object.keys(data.atlasData.monsters).length}`);
  console.log();
  console.log('📁 Arquivos gerados:');
  console.log(`   - assets/monster_spawns.json`);
  console.log(`   - assets/monster_catalog.json`);
  if (Object.keys(data.canaryData).length > 0) {
    console.log(`   - assets/data_monster.json (Canary Lua)`);
    console.log(`   - assets/atlas_monster_data.json (IDs para Atlas)`);
  }
  console.log(`   - src/gameplay/monsterData.generated.js`);
}

main();
