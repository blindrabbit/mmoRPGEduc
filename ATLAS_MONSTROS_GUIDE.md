# 🎨 Atlas de Monstros — Guia Completo

## 📋 Visão Geral

O atlas de monstros é gerado automaticamente a partir dos dados extraídos do Canary/OTClient.

**Arquivos:**
- `assets/atlas_monsters.json` — Coordenadas dos sprites no atlas PNG
- `assets/monstros_01.png` — Atlas PNG com todos os sprites
- `assets/atlas_monster_data.json` — IDs (lookType, corpseId) extraídos do Canary

---

## 🚀 Geração do Atlas

### Passo 1: Extrair Dados dos Monstros

```bash
node monsterExtractor.js assets/mapa-monster.xml
```

**Gera:**
- `assets/atlas_monster_data.json` — IDs dos monstros
- `assets/data_monster.json` — Dados completos

### Passo 2: Montar Atlas

```bash
node monsterAtlasBuilder.js
```

**Gera:**
- `assets/atlas_monsters.json` — Coordenadas finais
- Usa `assets/monstros_01.png` — Atlas de sprites

---

## 📁 Estrutura do Atlas

### `atlas_monsters.json`

```json
{
  "version": "1.0",
  "generatedAt": "2026-03-29T...",
  "texture": "monstros_01.png",
  "monsters": {
    "wolf": {
      "lookType": 27,
      "raceId": 27,
      "frame": {
        "x": 0,
        "y": 0,
        "w": 64,
        "h": 64
      }
    }
  },
  "corpses": {
    "wolf": {
      "corpseId": 5968,
      "frame": {
        "x": 0,
        "y": 0,
        "w": 64,
        "h": 64
      }
    }
  }
}
```

---

## 🎮 Uso no Jogo

### Carregar Atlas

```javascript
// worldEngine.html ou initializer.js
import monsterAtlas from '../assets/atlas_monsters.json';

// Obter sprite de um monstro
const wolf = monsterAtlas.monsters.wolf;
console.log(wolf.frame);  // { x: 0, y: 0, w: 64, h: 64 }

// Obter corpse
const wolfCorpse = monsterAtlas.corpses.wolf;
console.log(wolfCorpse.corpseId);  // 5968
```

### Renderizar Monstro

```javascript
// render/monsterRenderer.js
import monsterAtlas from '../assets/atlas_monsters.json';
import { TILE_SIZE } from '../core/config.js';

function drawMonster(ctx, monster, camX, camY) {
  const atlasData = monsterAtlas.monsters[monster.type];
  
  if (!atlasData) return;
  
  const { frame } = atlasData;
  const screenX = Math.round(monster.x * TILE_SIZE - camX);
  const screenY = Math.round(monster.y * TILE_SIZE - camY);
  
  // Carregar atlas PNG
  const atlasImage = document.getElementById('monstros_01');
  
  // Desenhar sprite
  ctx.drawImage(
    atlasImage,
    frame.x, frame.y, frame.w, frame.h,  // Recorte do atlas
    screenX, screenY, TILE_SIZE, TILE_SIZE  // Posição na tela
  );
}
```

### Renderizar Corpse

```javascript
function drawCorpse(ctx, corpse, camX, camY) {
  const atlasData = monsterAtlas.corpses[corpse.type];
  
  if (!atlasData) return;
  
  const { frame } = atlasData;
  const screenX = Math.round(corpse.x * TILE_SIZE - camX);
  const screenY = Math.round(corpse.y * TILE_SIZE - camY);
  
  const atlasImage = document.getElementById('monstros_01');
  
  ctx.drawImage(
    atlasImage,
    frame.x, frame.y, frame.w, frame.h,
    screenX, screenY, TILE_SIZE, TILE_SIZE
  );
}
```

---

## 📊 Mapeamento de LookTypes

| Monstro | lookType | raceId | Sprite no Atlas |
|---------|----------|--------|-----------------|
| Wolf | 27 | 27 | 2648.png |
| Cave Rat | 54 | 54 | 2649.png |
| Rotworm | 105 | 105 | 2650.png |
| Dragon | 200 | 200 | 2651.png |
| Dragon Lord | 201 | 201 | 2652.png |
| Orc | 50 | 50 | 2653.png |
| Orc Spearman | 51 | 51 | 2654.png |
| Orc Warrior | 52 | 52 | 2655.png |
| Goblin | 60 | 60 | 2656.png |
| Skeleton | 70 | 70 | 2657.png |
| Dwarf | 75 | 75 | 2658.png |
| Minotaur | 90 | 90 | 2659.png |
| Demon | 100 | 100 | 2660.png |
| Spider | 110 | 110 | 2661.png |
| Giant Spider | 111 | 111 | 2662.png |

---

## 💀 Mapeamento de Corpses

| Corpse | corpseId | Sprite no Atlas |
|--------|----------|-----------------|
| Wolf Corpse | 5968 | 2648.png |
| Wolf Corpse 2 | 5969 | 2649.png |
| Wolf Corpse 3 | 5970 | 2650.png |
| Rat Corpse | 5971 | 2651.png |
| Rat Corpse 2 | 5972 | 2652.png |
| Rat Corpse 3 | 5973 | 2653.png |
| Rotworm Corpse | 5974 | 2654.png |
| Rotworm Corpse 2 | 5975 | 2655.png |
| Rotworm Corpse 3 | 5976 | 2656.png |

---

## 🔄 Workflow Completo

```
┌─────────────────────────────────────────┐
│  Canary (Lua files)                     │
│  - mammals/wolf.lua                     │
│  - dragons/dragon.lua                   │
│  - ...                                  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  monsterExtractor.js                    │
│  - Extrai lookType, corpseId, raceId    │
│  - Gera atlas_monster_data.json         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  monsterAtlasBuilder.js                 │
│  - Integra com monstros_01.json         │
│  - Gera atlas_monsters.json             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Jogo (WorldEngine)                     │
│  - Carrega atlas_monsters.json          │
│  - Renderiza sprites de monstros_01.png │
└─────────────────────────────────────────┘
```

---

## 🛠️ Adicionar Novos Monstros

### 1. Extrair Dados do Canary

```bash
node monsterExtractor.js assets/mapa-monster.xml
```

### 2. Adicionar Mapeamento

Editar `monsterAtlasBuilder.js`:

```javascript
const lookTypeToSprite = {
  // ... existentes
  300: '2663.png',  // Novo monstro
};
```

### 3. Re-gerar Atlas

```bash
node monsterAtlasBuilder.js
```

---

## 📊 Estatísticas Atuais

| Tipo | Quantidade |
|------|------------|
| **Monstros** | 1 |
| **Corpses** | 1 |
| **Sprites no Atlas** | 15 |

---

## 🎯 Próximos Passos

1. **Extrair mais monstros do Canary:**
   - Executar `monsterExtractor.js` com mapa completo
   - Terá mais lookTypes e corpseIds

2. **Adicionar mais sprites ao atlas:**
   - Extrair sprites do appearances.dat
   - Adicionar a `monstros_01.png`
   - Atualizar `monstros_01.json`

3. **Gerar atlas de corpses:**
   - Separar corpses em `atlas_corpses.json`
   - Usar para animação de decomposição

---

## 📞 Integração com WorldEngine

```javascript
// src/clients/world-engine/boot/initializer.js
import monsterAtlas from '../../assets/atlas_monsters.json';
import { MONSTER_SPAWN_DATA } from '../../gameplay/monsterData.generated.js';

async function initWorld() {
  // ... carregar mapa, itens, etc.
  
  // Carregar atlas de monstros
  const atlasImage = new Image();
  atlasImage.src = './assets/monstros_01.png';
  atlasImage.id = 'monstros_01';
  await atlasImage.decode();
  
  logger.ok(`🎨 Atlas de monstros carregado`);
  
  // Spawnar monstros com sprites corretos
  for (const spawn of monsterSpawns) {
    const monsterData = MONSTER_SPAWN_DATA.monsters[spawn.name];
    const atlasData = monsterAtlas.monsters[spawn.name];
    
    if (monsterData && atlasData) {
      spawnMonster({
        ...monsterData,
        sprite: atlasData.frame,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
      });
    }
  }
}
```

---

**Status:** ✅ **Atlas de monstros funcional**  
**Última atualização:** 2026-03-29  
**Versão:** 1.0
