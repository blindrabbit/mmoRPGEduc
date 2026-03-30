#!/usr/bin/env node
// =============================================================================
// monsterExtractor.js — Extrai dados de monstros do Lua (Canary)
// =============================================================================
// Busca recursiva em subpastas: mammals/wolf.lua, dragons/dragon.lua, etc.
// =============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, "..", "..", "assets");
const MONSTER_DATA_OUTPUT = path.join(__dirname, "..", "gameplay");
// ✅ Caminho absoluto do Canary (ajuste conforme necessário)
const CANARY_MONSTER_DIR =
  "G:\\Meu Drive\\SEDU\\2026\\RPG_Novo\\canary\\data-canary\\monster";

// =============================================================================
// CARREGAR DADOS DO CANARY (LUA)
// =============================================================================

/**
 * Carrega todos os arquivos .lua de monstros recursivamente
 * @returns {Object} Mapa de nome -> dados do monstro
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
      const luaContent = fs.readFileSync(filePath, "utf-8");
      const monsterData = parseLuaMonster(luaContent, filePath);

      if (monsterData && monsterData.name) {
        const normalizedName = monsterData.name.toLowerCase().trim();
        monsters[normalizedName] = monsterData;
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

      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        // Recursivo em subpastas
        files.push(...findAllLuaFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".lua")) {
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
 * Formato: mType:type("name")
 * @param {string} luaContent
 * @param {string} filePath
 * @returns {Object} Dados extraídos
 */
function parseLuaMonster(luaContent, filePath) {
  const data = {
    name: null,
    description: "",
    health: {},
    experience: 0,
    speed: 0,
    look: {},
    flags: {},
    voices: [],
    attacks: [],
    loot: [],
    elements: {},
    immunities: [],
    summons: [],
    corpse: null,
  };

  // Extrair nome: mType:type("Wolf")
  const nameMatch = luaContent.match(/mType:type\(["']([^"']+)["']\)/);
  if (nameMatch) {
    data.name = nameMatch[1];
  }

  // Extrair description
  const descMatch = luaContent.match(/description\s*=\s*["']([^"']+)["']/);
  if (descMatch) {
    data.description = descMatch[1];
  }

  // Extrair health: health = {now = 60, max = 60}
  const healthNowMatch = luaContent.match(
    /health\s*=\s*\{[^}]*now\s*=\s*(\d+)/,
  );
  const healthMaxMatch = luaContent.match(
    /health\s*=\s*\{[^}]*max\s*=\s*(\d+)/,
  );
  if (healthNowMatch) data.health.now = parseInt(healthNowMatch[1]);
  if (healthMaxMatch) data.health.max = parseInt(healthMaxMatch[1]);

  // Extrair experience
  const expMatch = luaContent.match(/experience\s*=\s*(\d+)/);
  if (expMatch) data.experience = parseInt(expMatch[1]);

  // Extrair speed
  const speedMatch = luaContent.match(/speed\s*=\s*(\d+)/);
  if (speedMatch) data.speed = parseInt(speedMatch[1]);

  // Extrair look: look = {type = 305, corpse = 2660}
  const lookTypeMatch = luaContent.match(/look\s*=\s*\{[^}]*type\s*=\s*(\d+)/);
  const lookCorpseMatch = luaContent.match(
    /look\s*=\s*\{[^}]*corpse\s*=\s*(\d+)/,
  );
  if (lookTypeMatch) data.look.type = parseInt(lookTypeMatch[1]);
  if (lookCorpseMatch) data.corpse = parseInt(lookCorpseMatch[1]);

  // Extrair flags
  const flagRegex = /flags\s*=\s*\{([^}]+)\}/s;
  const flagMatch = luaContent.match(flagRegex);
  if (flagMatch) {
    const flagsContent = flagMatch[1];
    const flagPairs = flagsContent.match(/(\w+)\s*=\s*(\d+|["'][^"']+["'])/g);
    if (flagPairs) {
      for (const pair of flagPairs) {
        const [key, value] = pair.split(/\s*=\s*/);
        data.flags[key.trim()] = value.trim().replace(/["']/g, "");
      }
    }
  }

  // Extrair voices
  const voiceRegex =
    /voice\s*=\s*\{[^}]*text\s*=\s*["']([^"']+)["'][^}]*(?:interval\s*=\s*(\d+))?[^}]*\}/g;
  let voiceMatch;
  while ((voiceMatch = voiceRegex.exec(luaContent)) !== null) {
    data.voices.push({
      sentence: voiceMatch[1],
      interval: voiceMatch[2] ? parseInt(voiceMatch[2]) : 2000,
    });
  }

  // Extrair attacks
  const attackRegex =
    /attack\s*=\s*\{[^}]*name\s*=\s*["']([^"']+)["'][^}]*damage\s*=\s*(\d+)[^}]*interval\s*=\s*(\d+)[^}]*\}/g;
  let attackMatch;
  while ((attackMatch = attackRegex.exec(luaContent)) !== null) {
    data.attacks.push({
      name: attackMatch[1],
      damage: parseInt(attackMatch[2]),
      interval: parseInt(attackMatch[3]),
    });
  }

  // Extrair loot (simplificado)
  const lootRegex = /loot\s*=\s*\{([^}]+)\}/s;
  const lootMatch = luaContent.match(lootRegex);
  if (lootMatch) {
    const lootContent = lootMatch[1];
    const itemMatches = lootContent.matchAll(
      /id\s*=\s*(\d+)(?:.*?chance\s*=\s*(\d+))?/g,
    );
    for (const itemMatch of itemMatches) {
      data.loot.push({
        id: parseInt(itemMatch[1]),
        chance: itemMatch[2] ? parseInt(itemMatch[2]) : 100000,
      });
    }
  }

  // Extrair elements
  const elementRegex = /elements\s*=\s*\{([^}]+)\}/s;
  const elementMatch = luaContent.match(elementRegex);
  if (elementMatch) {
    const elementsContent = elementMatch[1];
    const elementPairs = elementsContent.match(/(\w+)\s*=\s*(-?\d+)/g);
    if (elementPairs) {
      for (const pair of elementPairs) {
        const [key, value] = pair.split(/\s*=\s*/);
        data.elements[key.trim()] = parseInt(value.trim());
      }
    }
  }

  // Extrair immunities
  const immunityRegex = /immunities\s*=\s*\{([^}]+)\}/s;
  const immunityMatch = luaContent.match(immunityRegex);
  if (immunityMatch) {
    const immunitiesContent = immunityMatch[1];
    const immunityItems = immunitiesContent.match(/["'](\w+)["']/g);
    if (immunityItems) {
      data.immunities = immunityItems.map((i) => i.replace(/["']/g, ""));
    }
  }

  return data;
}

// =============================================================================
// PARSER XML DE SPAWN
// =============================================================================

function parseMonsterXML(xmlString) {
  const spawns = [];
  const monsterBlockRegex =
    /<monster\s+([^>]*?)>\s*<monster\s+([^>]*?)\s*\/?>/g;
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

  for (const spawn of spawns) {
    const { name, centerx, centery, centerz, radius, x, y, z, spawntime } =
      spawn;

    if (!name) continue;

    const normalizedName = name.toLowerCase().trim();
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
      const canaryData = canaryMonsters[normalizedName] || null;
      const corpseId = canaryData?.corpse || null;
      const corpseFrames = corpseId
        ? [String(corpseId)]
        : getCorpseFrames(normalizedName);
      const template = getBaseTemplate(normalizedName);
      const appearance = getAppearance(normalizedName);

      const monsterData = {
        name: canaryData?.name || name,
        normalizedName,
        appearance: {
          ...appearance,
          speed: canaryData?.look?.type || template?.appearance?.speed || 100,
        },
        stats: {
          hp: canaryData?.health?.max || template?.stats?.hp || 100,
          maxHp: canaryData?.health?.max || template?.stats?.maxHp || 100,
          FOR: template?.stats?.FOR || 10,
          INT: template?.stats?.INT || 0,
          AGI: template?.stats?.AGI || 10,
          VIT: template?.stats?.VIT || 10,
          combatProfile: template?.stats?.combatProfile || "balanced",
          level: template?.stats?.level || 5,
          xpValue: canaryData?.experience || template?.stats?.xpValue || 50,
        },
        behavior: {
          range: template?.behavior?.range || 10,
          loseAggro: template?.behavior?.loseAggro || 15,
          maxDistance: template?.behavior?.maxDistance || 20,
        },
        attacks: canaryData?.attacks?.length
          ? canaryData.attacks
          : template?.attacks || [
              {
                name: "Melee",
                type: "melee",
                range: 1,
                damage: 10,
                cooldown: 1500,
                chance: 1,
                effectId: 1,
              },
            ],
        voices: canaryData?.voices || [],
        loot: canaryData?.loot || [],
        elements: canaryData?.elements || {},
        immunities: canaryData?.immunities || [],
        corpseFrames: corpseFrames,
        corpseDuration: 10000,
        respawnDelay: (spawntime || 60) * 1000,
        threatTier: template?.threatTier || "common",
        canaryData: canaryData
          ? {
              flags: canaryData.flags,
              immunities: canaryData.immunities,
              elements: canaryData.elements,
              description: canaryData.description,
            }
          : null,
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
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function getBaseTemplate(normalizedName) {
  const templates = {
    wolf: {
      stats: {
        hp: 60,
        FOR: 8,
        INT: 0,
        AGI: 12,
        VIT: 5,
        combatProfile: "skirmisher",
        level: 2,
        xpValue: 20,
      },
      behavior: { range: 10, loseAggro: 15, maxDistance: 20 },
      attacks: [
        {
          name: "Bite",
          type: "melee",
          range: 1,
          damage: 10,
          cooldown: 1500,
          chance: 1,
          effectId: 1,
        },
      ],
      threatTier: "starter",
    },
    rat: {
      stats: {
        hp: 36,
        FOR: 3,
        INT: 0,
        AGI: 8,
        VIT: 2,
        combatProfile: "skirmisher",
        level: 1,
        xpValue: 10,
      },
      behavior: { range: 10, loseAggro: 15, maxDistance: 20 },
      attacks: [
        {
          name: "Bite",
          type: "melee",
          range: 1,
          damage: 6,
          cooldown: 1500,
          chance: 1,
          effectId: 1,
        },
      ],
      threatTier: "starter",
    },
    rotworm: {
      stats: {
        hp: 65,
        FOR: 10,
        INT: 0,
        AGI: 6,
        VIT: 8,
        combatProfile: "balanced",
        level: 3,
        xpValue: 30,
      },
      behavior: { range: 8, loseAggro: 12, maxDistance: 15 },
      attacks: [
        {
          name: "Bite",
          type: "melee",
          range: 1,
          damage: 12,
          cooldown: 1800,
          chance: 1,
          effectId: 1,
        },
      ],
      threatTier: "starter",
    },
  };

  return templates[normalizedName] || null;
}

function getAppearance(normalizedName) {
  const appearanceMap = {
    wolf: { outfitId: "wolf", outfitPack: "monstros_01" },
    rat: { outfitId: "rat", outfitPack: "monstros_01" },
    rotworm: { outfitId: "rotworm", outfitPack: "monstros_01" },
  };

  return (
    appearanceMap[normalizedName] || {
      outfitId: normalizedName,
      outfitPack: "monstros_01",
    }
  );
}

function getCorpseFrames(normalizedName) {
  const corpseMap = {
    wolf: ["2660", "2661", "2662"],
    rat: ["2660", "2661", "2662"],
    rotworm: ["2663", "2664", "2665"],
  };

  return corpseMap[normalizedName] || ["2660", "2661", "2662"];
}

// =============================================================================
// GERADOR DE ARQUIVOS
// =============================================================================

function saveMonsterSpawns(spawns, outputPath) {
  const output = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    totalSpawns: spawns.length,
    spawns: spawns.sort((a, b) => {
      if (a.z !== b.z) return a.z - b.z;
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    }),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`✅ Spawns salvos: ${outputPath}`);
  console.log(`   Total: ${spawns.length} spawns`);
}

function saveMonsterCatalog(catalog, outputPath) {
  const output = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    totalMonsters: Object.keys(catalog).length,
    monsters: catalog,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`✅ Catálogo salvo: ${outputPath}`);
  console.log(`   Total: ${Object.keys(catalog).length} monstros únicos`);
}

function saveCanaryMonsterData(canaryData, outputPath) {
  const output = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    totalMonsters: Object.keys(canaryData).length,
    monsters: canaryData,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`✅ Dados Canary salvos: ${outputPath}`);
  console.log(`   Total: ${Object.keys(canaryData).length} monstros`);
}

function saveMonsterDataGenerated(catalog, outputPath) {
  const sortedMonsters = Object.entries(catalog).sort((a, b) =>
    a[0].localeCompare(b[0]),
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
    const safeKey = key.replace(/\s+/g, "_");
    content += `    ${safeKey}: ${JSON.stringify(monster, null, 4)
      .split("\n")
      .join("\n    ")},\n`;
  }

  content += `  },
};

export default MONSTER_SPAWN_DATA;
`;

  fs.writeFileSync(outputPath, content, "utf-8");
  console.log(`✅ Templates gerados: ${outputPath}`);
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Uso: node monsterExtractor.js <caminho-do-arquivo-xml>");
    console.log("Exemplo: node monsterExtractor.js assets/mapa-monster.xml");
    process.exit(1);
  }

  const xmlPath = args[0];

  if (!fs.existsSync(xmlPath)) {
    console.error(`❌ Arquivo não encontrado: ${xmlPath}`);
    process.exit(1);
  }

  console.log("🔍 Monster Extractor — Canary Lua para JSON");
  console.log("═══════════════════════════════════════════");
  console.log(`📄 Input XML: ${xmlPath}`);
  console.log(`📂 Canary Lua: ${CANARY_MONSTER_DIR}`);
  console.log();

  console.log("📖 Lendo XML de spawns...");
  const xmlContent = fs.readFileSync(xmlPath, "utf-8");

  console.log("🔧 Parseando XML...");
  const spawns = parseMonsterXML(xmlContent);
  console.log(`   Encontrados: ${spawns.length} spawns`);

  console.log();
  console.log("📂 Carregando monstros do Canary (.lua)...");
  const canaryMonsters = loadAllCanaryMonsters();

  console.log();
  console.log("🔍 Extraindo dados...");
  const data = extractMonsterData(spawns, canaryMonsters);

  console.log();
  console.log("💾 Salvando arquivos...");

  saveMonsterSpawns(data.spawns, path.join(OUTPUT_DIR, "monster_spawns.json"));

  saveMonsterCatalog(
    data.catalog,
    path.join(OUTPUT_DIR, "monster_catalog.json"),
  );

  if (Object.keys(data.canaryData).length > 0) {
    saveCanaryMonsterData(
      data.canaryData,
      path.join(OUTPUT_DIR, "data_monster.json"),
    );
  } else {
    console.log("⚠️  Sem dados do Canary (arquivos .lua não encontrados)");
  }

  saveMonsterDataGenerated(
    data.catalog,
    path.join(MONSTER_DATA_OUTPUT, "monsterData.generated.js"),
  );

  console.log();
  console.log("✅ Extração concluída com sucesso!");
  console.log();
  console.log("📊 Resumo:");
  console.log(`   - Spawns totais: ${data.spawns.length}`);
  console.log(`   - Monstros únicos: ${Object.keys(data.catalog).length}`);
  console.log(`   - Dados Canary: ${Object.keys(data.canaryData).length}`);
  console.log();
  console.log("📁 Arquivos gerados:");
  console.log(`   - assets/monster_spawns.json`);
  console.log(`   - assets/monster_catalog.json`);
  if (Object.keys(data.canaryData).length > 0) {
    console.log(`   - assets/data_monster.json (Canary Lua)`);
  }
  console.log(`   - src/gameplay/monsterData.generated.js`);
}

main();
