# 🐉 Monster Extractor — Guia Completo

## 📋 Visão Geral

Extrator de dados de monstros com **enriquecimento automático** do Canary/OTClient.

**Funcionalidades:**
- ✅ Parse de XML de respawn (OTBM)
- ✅ Extração de posições de spawns
- ✅ **Dados do Canary (falas, loot, ataques, immunities)**
- ✅ **IDs de corpse dos sprites**
- ✅ Catálogo automático de monstros
- ✅ Templates compatíveis com `monsterData.js`

---

## 🚀 Uso

```bash
cd "g:\Meu Drive\SEDU\2026\RPG_Novo"
node src/tools/monsterExtractor.js assets/mapa-monster.xml
```

---

## 📁 Arquivos Gerados

### 1. `monster_spawns.json`

**Descrição:** Lista de spawns com posições.

```json
{
  "version": "1.0",
  "totalSpawns": 107,
  "spawns": [
    {
      "name": "wolf",
      "x": 113,
      "y": 96,
      "z": 7,
      "radius": 1,
      "spawntime": 60
    }
  ]
}
```

---

### 2. `monster_catalog.json`

**Descrição:** Catálogo de monstros únicos com dados completos.

```json
{
  "monsters": {
    "wolf": {
      "name": "Wolf",
      "appearance": {
        "outfitId": "wolf",
        "outfitPack": "monstros_01"
      },
      "stats": {
        "hp": 60,
        "FOR": 8,
        "AGI": 12
      },
      "attacks": [...],
      "voices": [       // ✅ FALAS DO CANARY
        { "sentence": "Groooowl!", "interval": 3000 }
      ],
      "loot": [         // ✅ LOOT DO CANARY
        { "id": 2666, "countmax": 2, "chance": 30000 }
      ],
      "corpseFrames": ["2660"],  // ✅ CORPSE ID
      "canaryData": {   // ✅ DADOS COMPLETOS DO CANARY
        "flags": { "attackable": "1" },
        "immunities": ["fire", "energy"],
        "elements": { "fire": -10 }
      }
    }
  }
}
```

---

### 3. `data_monster.json` (NOVO!)

**Descrição:** Dados brutos extraídos do Canary.

```json
{
  "monsters": {
    "wolf": {
      "name": "Wolf",
      "flags": {
        "attackable": "1",
        "hostile": "1",
        "walk": "random"
      },
      "health": {
        "now": 60,
        "max": 60
      },
      "look": {
        "type": "305",
        "corpse": "2660"    // ✅ ID DO CORPSE
      },
      "voices": [           // ✅ FALAS
        { "sentence": "Groooowl!", "interval": 3000 }
      ],
      "attacks": [
        { "name": "melee", "damage": 10, "interval": 1500 }
      ],
      "loot": [             // ✅ LOOT
        { "id": 2666, "chance": 30000 }
      ],
      "elements": { "fire": -10 },
      "immunities": ["fire", "energy"]
    }
  }
}
```

---

### 4. `monsterData.generated.js`

**Descrição:** Templates no formato JavaScript.

```javascript
export const MONSTER_SPAWN_DATA = {
  monsters: {
    wolf: {
      name: "Wolf",
      voices: [
        { sentence: "Groooowl!", interval: 3000 }
      ],
      loot: [
        { id: 2666, countmax: 2, chance: 30000 }
      ],
      corpseFrames: ["2660"],
      canaryData: { ... }
    }
  }
};
```

---

## 🔧 Dados Extraídos do Canary

### Localização

```
G:\Meu Drive\SEDU\2026\canary\data-canary\monster\
├── wolf.xml
├── rotworm.xml
├── dragon.xml
└── ...
```

### Dados Extraídos

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| **flags** | Comportamento | `attackable`, `hostile`, `walk` |
| **health** | HP atual/máximo | `now: 60`, `max: 60` |
| **look** | Aparência e corpse | `type: 305`, `corpse: 2660` |
| **voices** | Falas do monstro | `sentence: "Groooowl!"` |
| **attacks** | Ataques e dano | `damage: 10`, `interval: 1500` |
| **loot** | Itens dropados | `id: 2666`, `chance: 30000` |
| **elements** | Resistências/fracas | `fire: -10` (fraco) |
| **immunities** | Imunidades | `["fire", "energy"]` |

---

## 🎨 Sprites e Corpses

### IDs de Corpse

Extraídos automaticamente do atributo `corpse` no XML do Canary:

```xml
<!-- canary/data-canary/monster/wolf.xml -->
<monster name="Wolf">
  <look type="305" corpse="2660" />
</monster>
```

**Resultado:**
```javascript
{
  corpseFrames: ["2660"],  // ✅ ID extraído
  corpseDuration: 10000
}
```

### Mapeamento de Sprites

Se não encontrar no Canary, usa mapeamento padrão:

```javascript
const corpseMap = {
  'wolf': ['2660', '2661', '2662'],
  'rat': ['2660', '2661', '2662'],
  'rotworm': ['2663', '2664', '2665'],
};
```

---

## 🗣️ Falas (Voices)

### Extração do Canary

```xml
<!-- canary/data-canary/monster/dragon.xml -->
<monster name="Dragon">
  <voice event="script" sentence="GROOOOOL!" interval="3000" />
  <voice sentence="You will burn!" interval="5000" yell="yes" />
</monster>
```

**Resultado:**
```javascript
{
  voices: [
    {
      event: "script",
      sentence: "GROOOOOL!",
      interval: 3000
    },
    {
      sentence: "You will burn!",
      interval: 5000,
      yell: true
    }
  ]
}
```

### Uso no Jogo

```javascript
// monsterAI.js
function playMonsterVoice(monster) {
  const voice = randomChoice(monster.voices);
  if (voice) {
    showSpeechBubble(monster.x, monster.y, voice.sentence);
    if (voice.yell) {
      playSound('yell.mp3');
    }
  }
}
```

---

## 💎 Loot

### Extração do Canary

```xml
<!-- canary/data-canary/monster/wolf.xml -->
<monster name="Wolf">
  <loot>
    <item id="2666" countmax="2" chance="30000" />
    <item id="2671" countmax="1" chance="50000" />
  </loot>
</monster>
```

**Resultado:**
```javascript
{
  loot: [
    { id: 2666, countmax: 2, chance: 30000 },
    { id: 2671, countmax: 1, chance: 50000 }
  ]
}
```

### Uso no Jogo

```javascript
// monsterManager.js
function dropLoot(monster) {
  for (const item of monster.loot) {
    if (Math.random() * 100000 < item.chance) {
      spawnItem(item.id, monster.x, monster.y, item.countmax);
    }
  }
}
```

---

## 🛡️ Elementos e Imunidades

### Extração do Canary

```xml
<monster name="Dragon">
  <element type="fire" percent="-10" />   <!-- Fraco: -10% -->
  <element type="ice" percent="20" />     <!-- Resistente: +20% -->
  <immunity name="fire" />                 <!-- Imune -->
  <immunity name="energy" />
</monster>
```

**Resultado:**
```javascript
{
  elements: {
    fire: -10,  // Toma 10% a mais de dano
    ice: 20     // Toma 20% a menos de dano
  },
  immunities: ["fire", "energy"]  // Não toma dano
}
```

### Uso em Combate

```javascript
// combatLogic.js
function calculateDamage(attacker, defender, damage, elementType) {
  // Verificar imunidade
  if (defender.immunities.includes(elementType)) {
    return 0;  // Imune
  }
  
  // Verificar resistência/fracas
  const elementMod = defender.elements[elementType] || 0;
  return damage * (1 + elementMod / 100);
}
```

---

## 📊 Estrutura Completa

```
┌─────────────────────────────────────────┐
│  XML de Respawn (OTBM)                  │
│  - Posições dos spawns                  │
│  - Raio de deambulação                  │
│  - Tempo de respawn                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Canary Monster XML                     │
│  - Flags (comportamento)                │
│  - Health (HP)                          │
│  - Look (aparência, corpse)             │
│  - Voices (falas)                       │
│  - Attacks (ataques)                    │
│  - Loot (drops)                         │
│  - Elements (resistências)              │
│  - Immunities (imunidades)              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  monsterExtractor.js                    │
│  - Parse de XML                         │
│  - Mescla de dados                      │
│  - Conversão para JSON                  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Arquivos Gerados                       │
│  - monster_spawns.json                  │
│  - monster_catalog.json                 │
│  - data_monster.json                    │
│  - monsterData.generated.js             │
└─────────────────────────────────────────┘
```

---

## 🔄 Workflow Completo

### 1. Extrair Mapa OTBM

```bash
cd "_Editor de Mapa"
python otbmMapToJsonMapFull.py
```

**Gera:**
- ✅ `map_data.json`
- ✅ `map_compacto.json`
- ✅ **`monster_spawns.json`** (se existir mapa-monster.xml)
- ✅ **`data_monster.json`** (dados do Canary)

---

### 2. Revisar Dados

```bash
# Verificar monstros extraídos
cat assets/monster_spawns.json | jq '.totalSpawns'
cat assets/data_monster.json | jq '.monsters.wolf.voices'
```

---

### 3. Integrar no Código

```javascript
// initializer.js
import monsterSpawns from '../assets/monster_spawns.json' assert { type: 'json' };
import { MONSTER_SPAWN_DATA } from '../gameplay/monsterData.generated.js';

async function initMonsters() {
  for (const spawn of monsterSpawns.spawns) {
    const template = MONSTER_SPAWN_DATA.monsters[spawn.name];
    
    // Spawnar com vozes
    if (template.voices?.length) {
      setInterval(() => {
        playVoice(template, randomChoice(template.voices));
      }, 5000);
    }
    
    // Spawnar com loot
    await spawnMonster({
      ...template,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
    });
  }
}
```

---

## 📞 Solução de Problemas

### Erro: "Canary não encontrado"

**Solução:** Verificar caminho:

```bash
ls "G:\Meu Drive\SEDU\2026\canary\data-canary\monster"
```

Se não existir, os dados serão gerados com valores padrão.

---

### Erro: "Corpse ID não encontrado"

**Solução:** Adicionar ao XML do Canary:

```xml
<look type="305" corpse="2660" />
```

Ou adicionar mapeamento manual no script.

---

### Monstros sem Falas

**Causa:** XML do Canary não tem `<voice>`.

**Solução:** Adicionar ao XML:

```xml
<monster name="Wolf">
  <voice sentence="Groooowl!" interval="3000" />
</monster>
```

---

**Status:** ✅ **Extração completa com dados do Canary**  
**Última atualização:** 2026-03-29  
**Versão:** 2.0 (com Canary integration)
