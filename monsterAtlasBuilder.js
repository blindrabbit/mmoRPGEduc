#!/usr/bin/env node
// =============================================================================
// monsterAtlasBuilder.js — Monta atlas de monstros a partir de dados existentes
// =============================================================================
// Integra atlas_monster_data.json (IDs) com monstros_01.json (sprites)
// =============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, 'assets');
const MONSTER_DATA_PATH = path.join(OUTPUT_DIR, 'atlas_monster_data.json');
const MONSTROS_ATLAS_PATH = path.join(OUTPUT_DIR, 'monstros_01.json');
const MONSTROS_PNG_PATH = path.join(OUTPUT_DIR, 'monstros_01.png');
const OUTPUT_ATLAS_PATH = path.join(OUTPUT_DIR, 'atlas_monsters.json');

// =============================================================================
// MAIN
// =============================================================================

function main() {
  console.log('🎨 Monster Atlas Builder');
  console.log('═══════════════════════════════════════');
  console.log();
  
  // Carregar atlas_monster_data.json (IDs dos monstros)
  if (!fs.existsSync(MONSTER_DATA_PATH)) {
    console.log('❌ Execute monsterExtractor.js primeiro!');
    process.exit(1);
  }
  const monsterData = JSON.parse(fs.readFileSync(MONSTER_DATA_PATH, 'utf-8'));
  console.log(`📖 atlas_monster_data.json: ${monsterData.totalMonsters} monstros`);
  
  // Carregar monstros_01.json (sprites existentes)
  if (!fs.existsSync(MONSTROS_ATLAS_PATH)) {
    console.log(`⚠️  monstros_01.json não encontrado`);
    process.exit(1);
  }
  const monstrosAtlas = JSON.parse(fs.readFileSync(MONSTROS_ATLAS_PATH, 'utf-8'));
  console.log(`📖 monstros_01.json: ${Object.keys(monstrosAtlas.frames).length} sprites`);
  
  // Mapear lookType → sprite no atlas
  const lookTypeToSprite = {
    27: '2648.png',   // Wolf
    54: '2649.png',   // Cave Rat
    105: '2650.png',  // Rotworm
    200: '2651.png',  // Dragon
    201: '2652.png',  // Dragon Lord
    50: '2653.png',   // Orc
    51: '2654.png',   // Orc Spearman
    52: '2655.png',   // Orc Warrior
    60: '2656.png',   // Goblin
    70: '2657.png',   // Skeleton
    75: '2658.png',   // Dwarf
    90: '2659.png',   // Minotaur
    100: '2660.png',  // Demon
    110: '2661.png',  // Spider
    111: '2662.png',  // Giant Spider
  };
  
  // Mapear corpseId → sprite no atlas
  const corpseToSprite = {
    5968: '2648.png',  // Wolf corpse
    5969: '2649.png',  // Wolf corpse 2
    5970: '2650.png',  // Wolf corpse 3
    5971: '2651.png',  // Rat corpse
    5972: '2652.png',  // Rat corpse 2
    5973: '2653.png',  // Rat corpse 3
    5974: '2654.png',  // Rotworm corpse
    5975: '2655.png',  // Rotworm corpse 2
    5976: '2656.png',  // Rotworm corpse 3
  };
  
  // Construir atlas final
  const finalAtlas = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    texture: 'monstros_01.png',
    monsters: {},
    corpses: {},
  };
  
  // Adicionar monstros
  for (const [name, data] of Object.entries(monsterData.monsters)) {
    const spriteName = lookTypeToSprite[data.lookType];
    
    if (spriteName && monstrosAtlas.frames[spriteName]) {
      const frame = monstrosAtlas.frames[spriteName].frame;
      
      finalAtlas.monsters[name] = {
        lookType: data.lookType,
        raceId: data.raceId,
        frame: {
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
        },
      };
      
      console.log(`  ✅ ${name} (lookType: ${data.lookType})`);
    } else {
      console.log(`  ⚠️  ${name} (lookType: ${data.lookType}) - sprite não encontrado`);
    }
  }
  
  // Adicionar corpses
  for (const [name, data] of Object.entries(monsterData.corpses)) {
    const spriteName = corpseToSprite[data.corpseId];
    
    if (spriteName && monstrosAtlas.frames[spriteName]) {
      const frame = monstrosAtlas.frames[spriteName].frame;
      
      finalAtlas.corpses[name] = {
        corpseId: data.corpseId,
        frame: {
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
        },
      };
      
      console.log(`  ✅ ${name} (corpseId: ${data.corpseId})`);
    } else {
      console.log(`  ⚠️  ${name} (corpseId: ${data.corpseId}) - sprite não encontrado`);
    }
  }
  
  // Salvar atlas final
  fs.writeFileSync(OUTPUT_ATLAS_PATH, JSON.stringify(finalAtlas, null, 2), 'utf-8');
  console.log();
  console.log(`✅ Atlas salvo: ${OUTPUT_ATLAS_PATH}`);
  console.log();
  console.log('📊 Resumo:');
  console.log(`   - Monstros: ${Object.keys(finalAtlas.monsters).length}`);
  console.log(`   - Corpses: ${Object.keys(finalAtlas.corpses).length}`);
  console.log();
  console.log('💡 Uso no jogo:');
  console.log(`   import atlas from './assets/atlas_monsters.json';`);
  console.log(`   const wolf = atlas.monsters.wolf;`);
  console.log(`   // { lookType: 27, frame: { x: 0, y: 0, w: 64, h: 64 } }`);
  console.log();
  console.log('🎨 Atlas PNG: assets/monstros_01.png');
}

main();
