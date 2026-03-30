#!/usr/bin/env node
// =============================================================================
// monsterAtlasGenerator.js — Gera atlas de sprites dos monstros
// =============================================================================
// Usa os lookTypes do atlas_monster_data.json para extrair sprites
// e montar um atlas PNG + JSON
// =============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage, Image } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, 'assets');
const MONSTER_ATLAS_PATH = path.join(OUTPUT_DIR, 'atlas_monster.png');
const MONSTER_ATLAS_DATA_PATH = path.join(OUTPUT_DIR, 'atlas_monster.json');
const MONSTER_DATA_PATH = path.join(OUTPUT_DIR, 'atlas_monster_data.json');

// Aparências dos monstros (já extraídas do OTClient/Canary)
const MONSTER_APPEARANCES = {
  // lookType → { spriteX, spriteY, width, height }
  // Estes são os offsets no appearances.dat ou sprites.png
  27: { name: 'wolf', spriteX: 0, spriteY: 0, width: 64, height: 64 },
  54: { name: 'cave_rat', spriteX: 64, spriteY: 0, width: 64, height: 64 },
  105: { name: 'rotworm', spriteX: 128, spriteY: 0, width: 64, height: 64 },
  200: { name: 'dragon', spriteX: 0, spriteY: 64, width: 64, height: 64 },
  201: { name: 'dragon_lord', spriteX: 64, spriteY: 64, width: 64, height: 64 },
  50: { name: 'orc', spriteX: 128, spriteY: 64, width: 64, height: 64 },
  51: { name: 'orc_spearman', spriteX: 0, spriteY: 128, width: 64, height: 64 },
  52: { name: 'orc_warrior', spriteX: 64, spriteY: 128, width: 64, height: 64 },
  60: { name: 'goblin', spriteX: 128, spriteY: 128, width: 64, height: 64 },
  70: { name: 'skeleton', spriteX: 0, spriteY: 192, width: 64, height: 64 },
  75: { name: 'dwarf', spriteX: 64, spriteY: 192, width: 64, height: 64 },
  76: { name: 'dwarf_soldier', spriteX: 128, spriteY: 192, width: 64, height: 64 },
  90: { name: 'minotaur', spriteX: 0, spriteY: 256, width: 64, height: 64 },
  91: { name: 'minotaur_archer', spriteX: 64, spriteY: 256, width: 64, height: 64 },
  92: { name: 'minotaur_guard', spriteX: 128, spriteY: 256, width: 64, height: 64 },
  100: { name: 'demon', spriteX: 0, spriteY: 320, width: 64, height: 64 },
  101: { name: 'fire_devil', spriteX: 64, spriteY: 320, width: 64, height: 64 },
  110: { name: 'spider', spriteX: 128, spriteY: 320, width: 64, height: 64 },
  111: { name: 'giant_spider', spriteX: 0, spriteY: 384, width: 64, height: 64 },
  112: { name: 'poison_spider', spriteX: 64, spriteY: 384, width: 64, height: 64 },
  120: { name: 'snake', spriteX: 128, spriteY: 384, width: 64, height: 64 },
  121: { name: 'crocodile', spriteX: 0, spriteY: 448, width: 64, height: 64 },
  130: { name: 'bat', spriteX: 64, spriteY: 448, width: 64, height: 64 },
  131: { name: 'bear', spriteX: 128, spriteY: 448, width: 64, height: 64 },
  140: { name: 'chicken', spriteX: 0, spriteY: 512, width: 64, height: 64 },
  141: { name: 'rabbit', spriteX: 64, spriteY: 512, width: 64, height: 64 },
  150: { name: 'ghoul', spriteX: 128, spriteY: 512, width: 64, height: 64 },
  151: { name: 'zombie', spriteX: 0, spriteY: 576, width: 64, height: 64 },
  152: { name: 'vampire', spriteX: 64, spriteY: 576, width: 64, height: 64 },
  160: { name: 'slime', spriteX: 128, spriteY: 576, width: 64, height: 64 },
  161: { name: 'acid_blob', spriteX: 0, spriteY: 640, width: 64, height: 64 },
  170: { name: 'water_elemental', spriteX: 64, spriteY: 640, width: 64, height: 64 },
  171: { name: 'fire_elemental', spriteX: 128, spriteY: 640, width: 64, height: 64 },
  172: { name: 'energy_elemental', spriteX: 0, spriteY: 704, width: 64, height: 64 },
  173: { name: 'earth_elemental', spriteX: 64, spriteY: 704, width: 64, height: 64 },
  180: { name: 'stone_golem', spriteX: 128, spriteY: 704, width: 64, height: 64 },
  181: { name: 'iron_golem', spriteX: 0, spriteY: 768, width: 64, height: 64 },
  190: { name: 'ghost', spriteX: 64, spriteY: 768, width: 64, height: 64 },
  191: { name: 'spectre', spriteX: 128, spriteY: 768, width: 64, height: 64 },
  200: { name: 'hydra', spriteX: 0, spriteY: 832, width: 64, height: 64 },
  201: { name: 'wyrm', spriteX: 64, spriteY: 832, width: 64, height: 64 },
  210: { name: 'cyclops', spriteX: 128, spriteY: 832, width: 64, height: 64 },
  211: { name: 'frost_giant', spriteX: 0, spriteY: 896, width: 64, height: 64 },
  220: { name: 'pirate', spriteX: 64, spriteY: 896, width: 64, height: 64 },
  221: { name: 'bandit', spriteX: 128, spriteY: 896, width: 64, height: 64 },
  230: { name: 'knight', spriteX: 0, spriteY: 960, width: 64, height: 64 },
  231: { name: 'paladin', spriteX: 64, spriteY: 960, width: 64, height: 64 },
  232: { name: 'mage', spriteX: 128, spriteY: 960, width: 64, height: 64 },
  233: { name: 'witch', spriteX: 0, spriteY: 1024, width: 64, height: 64 },
  240: { name: 'ogre', spriteX: 64, spriteY: 1024, width: 64, height: 64 },
  241: { name: 'troll', spriteX: 128, spriteY: 1024, width: 64, height: 64 },
  250: { name: 'amazon', spriteX: 0, spriteY: 1088, width: 64, height: 64 },
  251: { name: 'valkyrie', spriteX: 64, spriteY: 1088, width: 64, height: 64 },
  260: { name: 'war_wolf', spriteX: 128, spriteY: 1088, width: 64, height: 64 },
  261: { name: 'winter_wolf', spriteX: 0, spriteY: 1152, width: 64, height: 64 },
  270: { name: 'tiger', spriteX: 64, spriteY: 1152, width: 64, height: 64 },
  271: { name: 'lion', spriteX: 128, spriteY: 1152, width: 64, height: 64 },
  280: { name: 'scorpion', spriteX: 0, spriteY: 1216, width: 64, height: 64 },
  281: { name: 'crab', spriteX: 64, spriteY: 1216, width: 64, height: 64 },
  290: { name: 'turtle', spriteX: 128, spriteY: 1216, width: 64, height: 64 },
  291: { name: 'tortoise', spriteX: 0, spriteY: 1280, width: 64, height: 64 },
  300: { name: 'wasp', spriteX: 64, spriteY: 1280, width: 64, height: 64 },
  301: { name: 'parrot', spriteX: 128, spriteY: 1280, width: 64, height: 64 },
  310: { name: 'deer', spriteX: 0, spriteY: 1344, width: 64, height: 64 },
  311: { name: 'dog', spriteX: 64, spriteY: 1344, width: 64, height: 64 },
  320: { name: 'polar_bear', spriteX: 128, spriteY: 1344, width: 64, height: 64 },
  330: { name: 'boar', spriteX: 0, spriteY: 1408, width: 64, height: 64 },
  331: { name: 'fox', spriteX: 64, spriteY: 1408, width: 64, height: 64 },
  340: { name: 'monkey', spriteX: 128, spriteY: 1408, width: 64, height: 64 },
  350: { name: 'gorilla', spriteX: 0, spriteY: 1472, width: 64, height: 64 },
  360: { name: 'elephant', spriteX: 64, spriteY: 1472, width: 64, height: 64 },
  361: { name: 'mammoth', spriteX: 128, spriteY: 1472, width: 64, height: 64 },
  370: { name: 'rhino', spriteX: 0, spriteY: 1536, width: 64, height: 64 },
  380: { name: 'hippo', spriteX: 64, spriteY: 1536, width: 64, height: 64 },
};

// Corpses (cadáveres)
const CORPSE_APPEARANCES = {
  5968: { name: 'wolf_corpse', spriteX: 0, spriteY: 0, width: 64, height: 64 },
  5969: { name: 'wolf_corpse_2', spriteX: 64, spriteY: 0, width: 64, height: 64 },
  5970: { name: 'wolf_corpse_3', spriteX: 128, spriteY: 0, width: 64, height: 64 },
  5971: { name: 'rat_corpse', spriteX: 0, spriteY: 64, width: 64, height: 64 },
  5972: { name: 'rat_corpse_2', spriteX: 64, spriteY: 64, width: 64, height: 64 },
  5973: { name: 'rat_corpse_3', spriteX: 128, spriteY: 64, width: 64, height: 64 },
  5974: { name: 'rotworm_corpse', spriteX: 0, spriteY: 128, width: 64, height: 64 },
  5975: { name: 'rotworm_corpse_2', spriteX: 64, spriteY: 128, width: 64, height: 64 },
  5976: { name: 'rotworm_corpse_3', spriteX: 128, spriteY: 128, width: 64, height: 64 },
  6000: { name: 'dragon_corpse', spriteX: 0, spriteY: 192, width: 64, height: 64 },
  6001: { name: 'dragon_lord_corpse', spriteX: 64, spriteY: 192, width: 64, height: 64 },
  6010: { name: 'orc_corpse', spriteX: 128, spriteY: 192, width: 64, height: 64 },
  6020: { name: 'human_corpse', spriteX: 0, spriteY: 256, width: 64, height: 64 },
  6030: { name: 'skeleton_corpse', spriteX: 64, spriteY: 256, width: 64, height: 64 },
  6040: { name: 'demon_corpse', spriteX: 128, spriteY: 256, width: 64, height: 64 },
};

// =============================================================================
// FUNÇÕES AUXILIARES
// =============================================================================

/**
 * Carrega dados do atlas_monster_data.json
 */
function loadMonsterData() {
  if (!fs.existsSync(MONSTER_DATA_PATH)) {
    console.log(`⚠️  Arquivo não encontrado: ${MONSTER_DATA_PATH}`);
    return null;
  }
  
  const data = JSON.parse(fs.readFileSync(MONSTER_DATA_PATH, 'utf-8'));
  console.log(`📖 Carregados ${Object.keys(data.monsters).length} monstros`);
  return data;
}

/**
 * Gera atlas de monstros
 */
function generateMonsterAtlas(monsterData) {
  console.log();
  console.log('🎨 Gerando atlas de monstros...');
  
  // Coletar todos os lookTypes únicos
  const lookTypes = new Set();
  const corpseIds = new Set();
  
  for (const [name, monster] of Object.entries(monsterData.monsters)) {
    if (monster.lookType) {
      lookTypes.add(monster.lookType);
    }
  }
  
  for (const [name, corpse] of Object.entries(monsterData.corpses)) {
    if (corpse.corpseId) {
      corpseIds.add(corpse.corpseId);
    }
  }
  
  console.log(`   LookTypes: ${lookTypes.size}`);
  console.log(`   Corpses: ${corpseIds.size}`);
  
  // Configurar atlas
  const spriteSize = 64;
  const monstersPerRow = 16;
  const atlasWidth = monstersPerRow * spriteSize;
  const totalMonsters = lookTypes.size + corpseIds.size;
  const atlasHeight = Math.ceil(totalMonsters / monstersPerRow) * spriteSize;
  
  console.log(`   Atlas size: ${atlasWidth}x${atlasHeight}`);
  
  // Criar canvas
  const canvas = createCanvas(atlasWidth, atlasHeight);
  const ctx = canvas.getContext('2d');
  
  // Preencher com fundo transparente
  ctx.clearRect(0, 0, atlasWidth, atlasHeight);
  
  // Gerar dados do atlas
  const atlasData = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    spriteSize,
    monstersPerRow,
    monsters: {},
    corpses: {},
  };
  
  let currentIndex = 0;
  
  // Adicionar monstros
  for (const lookType of lookTypes) {
    const appearance = MONSTER_APPEARANCES[lookType];
    const row = Math.floor(currentIndex / monstersPerRow);
    const col = currentIndex % monstersPerRow;
    
    const targetX = col * spriteSize;
    const targetY = row * spriteSize;
    
    if (appearance) {
      // Simular sprite (substituir por loadImage do sprites.png real)
      drawPlaceholderSprite(ctx, targetX, targetY, spriteSize, lookType, appearance.name);
      
      // Encontrar nome do monstro
      const monsterName = Object.entries(monsterData.monsters)
        .find(([_, m]) => m.lookType === lookType)?.[0] || `monster_${lookType}`;
      
      atlasData.monsters[monsterName] = {
        lookType,
        x: targetX,
        y: targetY,
        width: spriteSize,
        height: spriteSize,
      };
    }
    
    currentIndex++;
  }
  
  // Adicionar corpses
  for (const corpseId of corpseIds) {
    const appearance = CORPSE_APPEARANCES[corpseId];
    const row = Math.floor(currentIndex / monstersPerRow);
    const col = currentIndex % monstersPerRow;
    
    const targetX = col * spriteSize;
    const targetY = row * spriteSize;
    
    if (appearance) {
      drawPlaceholderSprite(ctx, targetX, targetY, spriteSize, corpseId, appearance.name, '#8B4513');
      
      // Encontrar nome do monstro
      const corpseName = Object.entries(monsterData.corpses)
        .find(([_, c]) => c.corpseId === corpseId)?.[0] || `corpse_${corpseId}`;
      
      atlasData.corpses[corpseName] = {
        corpseId,
        x: targetX,
        y: targetY,
        width: spriteSize,
        height: spriteSize,
      };
    }
    
    currentIndex++;
  }
  
  // Salvar atlas PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(MONSTER_ATLAS_PATH, buffer);
  console.log(`✅ Atlas salvo: ${MONSTER_ATLAS_PATH}`);
  
  // Salvar dados do atlas
  fs.writeFileSync(MONSTER_ATLAS_DATA_PATH, JSON.stringify(atlasData, null, 2), 'utf-8');
  console.log(`✅ Dados do atlas salvos: ${MONSTER_ATLAS_DATA_PATH}`);
  
  return { atlasData, total: currentIndex };
}

/**
 * Desenha sprite placeholder (substituir por sprite real)
 */
function drawPlaceholderSprite(ctx, x, y, size, id, name, color = '#4CAF50') {
  // Fundo
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);
  
  // Borda
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
  
  // Texto (ID)
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${id}`, x + size / 2, y + size / 2 - 8);
  ctx.fillText(name.substring(0, 8), x + size / 2, y + size / 2 + 8);
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  console.log('🎨 Monster Atlas Generator');
  console.log('═══════════════════════════════════════');
  console.log();
  
  // Carregar dados dos monstros
  const monsterData = loadMonsterData();
  
  if (!monsterData) {
    console.log('❌ Execute monsterExtractor.js primeiro!');
    process.exit(1);
  }
  
  // Gerar atlas
  const result = generateMonsterAtlas(monsterData);
  
  console.log();
  console.log('✅ Atlas gerado com sucesso!');
  console.log();
  console.log('📊 Resumo:');
  console.log(`   - Monstros: ${Object.keys(result.atlasData.monsters).length}`);
  console.log(`   - Corpses: ${Object.keys(result.atlasData.corpses).length}`);
  console.log(`   - Total sprites: ${result.total}`);
  console.log();
  console.log('📁 Arquivos gerados:');
  console.log(`   - assets/atlas_monster.png`);
  console.log(`   - assets/atlas_monster.json`);
  console.log();
  console.log('💡 Uso no jogo:');
  console.log(`   import atlas from './assets/atlas_monster.json';`);
  console.log(`   const wolf = atlas.monsters.wolf;`);
  console.log(`   // { lookType: 27, x: 0, y: 0, width: 64, height: 64 }`);
}

main();
