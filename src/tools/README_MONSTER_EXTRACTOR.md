# 🐉 Monster Extractor — OTBM XML para JSON

## 📋 Visão Geral

Extrator de dados de monstros a partir de arquivos XML de respawn (OTBM) do OTClient/Canary.

**Funcionalidades:**
- ✅ Parse de XML de respawn (`mapa-monster.xml`)
- ✅ Extração de posições de spawns
- ✅ Catálogo automático de monstros únicos
- ✅ Geração de templates compatíveis com `monsterData.js`
- ✅ Mapeamento de sprites e comportamentos

---

## 🚀 Uso

### Básico

```bash
cd "g:\Meu Drive\SEDU\2026\RPG_Novo"
node src/tools/monsterExtractor.js assets/mapa-monster.xml
```

### Com Caminho Personalizado

```bash
node src/tools/monsterExtractor.js /caminho/do/mapa-monster.xml
```

---

## 📁 Arquivos Gerados

### 1. `assets/monster_spawns.json`

**Descrição:** Lista de todos os spawns com posições.

**Estrutura:**
```json
{
  "version": "1.0",
  "generatedAt": "2026-03-29T...",
  "totalSpawns": 111,
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

**Uso:** Carregar spawns no worldEngine.

---

### 2. `assets/monster_catalog.json`

**Descrição:** Catálogo de monstros únicos com dados completos.

**Estrutura:**
```json
{
  "version": "1.0",
  "generatedAt": "2026-03-29T...",
  "totalMonsters": 3,
  "monsters": {
    "wolf": {
      "name": "Wolf",
      "normalizedName": "wolf",
      "appearance": {
        "outfitId": "wolf",
        "outfitPack": "monstros_01",
        "speed": 100
      },
      "stats": {
        "hp": 60,
        "FOR": 8,
        "INT": 0,
        "AGI": 12,
        "VIT": 5,
        "combatProfile": "skirmisher",
        "level": 2,
        "xpValue": 20
      },
      "behavior": {
        "range": 10,
        "loseAggro": 15,
        "maxDistance": 20
      },
      "attacks": [
        {
          "name": "Bite",
          "type": "melee",
          "range": 1,
          "damage": 10,
          "cooldown": 1500,
          "chance": 1,
          "effectId": 1
        }
      ],
      "corpseFrames": ["2660", "2661", "2662"],
      "corpseDuration": 10000,
      "respawnDelay": 60000,
      "threatTier": "starter"
    }
  }
}
```

**Uso:** Referência de dados dos monstros.

---

### 3. `src/gameplay/monsterData.generated.js`

**Descrição:** Templates no formato do `monsterData.js`.

**Estrutura:**
```javascript
export const MONSTER_SPAWN_DATA = {
  version: '1.0',
  generatedAt: '2026-03-29T...',
  totalMonsters: 3,
  monsters: {
    wolf: { ... },
    rotworm: { ... },
    // ...
  },
};

export default MONSTER_SPAWN_DATA;
```

**Uso:** Importar diretamente no código.

---

## 🔧 Configuração

### Mapeamento de Sprites

Edite `MONSTER_SPRITE_MAP` no script:

```javascript
const MONSTER_SPRITE_MAP = {
  'wolf': { outfitId: 'wolf', outfitPack: 'monstros_01' },
  'dragon': { outfitId: 'dragon', outfitPack: 'monstros_01' },
  // Adicione novos monstros aqui
};
```

### Templates Base

Edite `MONSTER_BASE_TEMPLATES`:

```javascript
const MONSTER_BASE_TEMPLATES = {
  'wolf': {
    stats: { hp: 60, FOR: 8, INT: 0, AGI: 12, VIT: 5 },
    behavior: { range: 10, loseAggro: 15, maxDistance: 20 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 1, damage: 10 }
    ],
    // ...
  },
  // Adicione novos templates aqui
};
```

---

## 📊 Formato do XML (OTBM)

O script espera o seguinte formato:

```xml
<?xml version="1.0"?>
<monsters>
  <monster centerx="113" centery="96" centerz="7" radius="1">
    <monster name="Wolf" x="0" y="0" z="7" spawntime="60" />
  </monster>
  <monster centerx="152" centery="96" centerz="7" radius="1">
    <monster name="Rotworm" x="0" y="0" z="9" spawntime="120" />
  </monster>
</monsters>
```

**Atributos:**
- `centerx`, `centery`, `centerz` — Posição do spawn
- `radius` — Raio de deambulação
- `name` — Nome do monstro
- `x`, `y`, `z` — Offset relativo ao centro
- `spawntime` — Tempo de respawn (segundos)

---

## 🧪 Exemplo de Uso no Código

### Carregar Spawns

```javascript
import monsterSpawns from '../assets/monster_spawns.json' assert { type: 'json' };

// Iterar sobre spawns
for (const spawn of monsterSpawns.spawns) {
  console.log(`${spawn.name} em (${spawn.x}, ${spawn.y}, ${spawn.z})`);
}
```

### Carregar Catálogo

```javascript
import monsterCatalog from '../assets/monster_catalog.json' assert { type: 'json' };

// Obter dados de um monstro
const wolfData = monsterCatalog.monsters.wolf;
console.log(`HP: ${wolfData.stats.hp}`);
console.log(`Dano: ${wolfData.attacks[0].damage}`);
```

### Usar Templates Gerados

```javascript
import { MONSTER_SPAWN_DATA } from '../gameplay/monsterData.generated.js';

// Usar diretamente
const wolf = MONSTER_SPAWN_DATA.monsters.wolf;
spawnMonster(wolf);
```

---

## 🔄 Workflow de Atualização

### 1. Extrair Novo Mapa

```bash
node src/tools/monsterExtractor.js assets/novo-mapa-monster.xml
```

### 2. Revisar Arquivos Gerados

```bash
# Verificar monster_spawns.json
# Verificar monster_catalog.json
```

### 3. Mesclar com `monsterData.js`

```javascript
// monsterData.js
import { MONSTER_SPAWN_DATA } from './monsterData.generated.js';

// Mesclar templates
export const MONSTER_TEMPLATES = {
  ...MONSTER_SPAWN_DATA.monsters,
  // Monstros manuais
  boss: { ... },
};
```

---

## 📈 Estatísticas

### Extração Atual (mapa-monster.xml)

| Métrica | Valor |
|---------|-------|
| **Spawns totais** | 111 |
| **Monstros únicos** | 3 |
| **Floors** | 7, 9, 10 |

**Monstros encontrados:**
- Wolf (87 spawns)
- Rotworm (24 spawns)

---

## 🛠️ Extensões Futuras

### 1. Extrair Ataques Especiais

```javascript
// Adicionar ao XML
<monster name="Dragon">
  <attack name="fire" type="beam" damage="50" />
  <attack name="fire" type="area" shape="cone" damage="30" />
</monster>
```

### 2. Extrair Loot

```javascript
// Adicionar ao XML
<loot>
  <item id="2148" countmax="50" chance="50000" />
  <item id="2666" countmax="2" chance="30000" />
</loot>
```

### 3. Extrair Scripts de IA

```javascript
// Adicionar ao XML
<script>
  <script name="on_think" event="script" value="dragon_think.lua" />
  <script name="on_attack" event="script" value="dragon_attack.lua" />
</script>
```

---

## 🐛 Solução de Problemas

### Erro: "Arquivo não encontrado"

```bash
# Verificar caminho
ls assets/mapa-monster.xml

# Usar caminho absoluto
node src/tools/monsterExtractor.js /caminho/absoluto/mapa-monster.xml
```

### Erro: "ENOENT: no such file or directory"

Verificar se diretórios de saída existem:

```bash
mkdir -p assets
mkdir -p src/gameplay
```

### Monstros Desconhecidos

Se um monstro não tem template, usa dados padrão:

```javascript
{
  stats: { hp: 100, FOR: 10, INT: 0, AGI: 10, VIT: 10 },
  attacks: [{ name: 'Melee', type: 'melee', damage: 10 }]
}
```

**Solução:** Adicionar ao `MONSTER_BASE_TEMPLATES`.

---

## 📞 Suporte

Para adicionar novos monstros ou ajustar dados:

1. Edite `src/tools/monsterExtractor.js`
2. Adicione ao `MONSTER_SPRITE_MAP`
3. Adicione ao `MONSTER_BASE_TEMPLATES`
4. Execute o extractor novamente

---

**Última atualização:** 2026-03-29  
**Versão:** 1.0  
**Status:** ✅ Funcional
