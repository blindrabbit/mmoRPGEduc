# 📚 Funções Canônicas — Guia de Referência

## ✅ Funções Únicas (Sem Duplicação)

Todas as funções listadas estão **corretamente localizadas** em seus arquivos canônicos.

---

## 🎯 Funções de Colisão e Movimento

| Função | Arquivo Canônico | Importar De |
|--------|------------------|-------------|
| `isTileWalkable(x, y, z, worldTiles, nexoData)` | `src/core/collision.js` | ✅ `import { isTileWalkable } from "../core/collision.js"` |
| `getTileMovementCost(x, y, z, worldTiles, nexoData)` | `src/core/collision.js` | ✅ |
| `isPassableForMob(x, y, z, worldTiles, nexoData)` | `src/core/collision.js` | ✅ |
| `calculateStepDuration(speed)` | `src/gameplay/gameCore.js` | ✅ `import { calculateStepDuration } from "../gameplay/gameCore.js"` |
| `getDirectionFromDelta(dx, dy)` | `src/gameplay/combatLogic.js` | ✅ `import { getDirectionFromDelta } from "../gameplay/combatLogic.js"` |

---

## ⚔️ Funções de Combate

| Função | Arquivo Canônico | Importar De |
|--------|------------------|-------------|
| `calculateCombatResult(...)` | `src/gameplay/combatLogic.js` | ✅ |
| `calculateNewHp(hp, damage, maxHp)` | `src/gameplay/combatLogic.js` | ✅ |
| `calculateFinalDamage(...)` | `src/gameplay/combatLogic.js` | ✅ |
| `isInAttackRange(attacker, target, range)` | `src/gameplay/combatLogic.js` | ✅ |
| `processAttack(...)` | `src/gameplay/combat/combatService.js` | ✅ |

---

## 🎮 Funções de Player Actions

| Função | Arquivo Canônico | Importar De |
|--------|------------------|-------------|
| `getActionCursor(action)` | `src/core/playerAction.js` | ✅ `import { getActionCursor } from "../core/playerAction.js"` |
| `PlayerAction` (enum) | `src/core/playerAction.js` | ✅ |
| `getActionSystem()` | `src/core/actionSystem.js` | ✅ |
| `registerDefaultActions(worldState)` | `src/gameplay/defaultActions.js` | ✅ |

---

## 🗺️ Funções de Pathfinding

| Função | Arquivo Canônico | Importar De |
|--------|------------------|-------------|
| `PathFinder` (classe) | `src/core/pathfinding.js` | ✅ `import { PathFinder } from "../../core/pathfinding.js"` |

---

## 📦 Funções Utilitárias

| Função | Arquivo Canônico | Importar De |
|--------|------------------|-------------|
| `clamp(value, min, max)` | `src/core/db.js` (interno) | ❌ Não exportado - uso local apenas |
| `clampFloor(z, limits)` | `src/core/floorVisibility.js` | ✅ |
| `toNumberOrNull(value)` | `src/core/db.js` | ❌ Interno |

---

## 📝 Padrões de Importação

### ✅ CORRETO

```javascript
// Importar de arquivos canônicos
import { isTileWalkable } from "../../core/collision.js";
import { calculateStepDuration } from "../../gameplay/gameCore.js";
import { getDirectionFromDelta } from "../../gameplay/combatLogic.js";
import { getActionCursor, PlayerAction } from "../../core/playerAction.js";
```

### ❌ ERRADO

```javascript
// NÃO recriar funções que já existem
function isTileWalkable(x, y, worldTiles) { ... }  // ❌ Duplicação!
function calculateStepDuration(speed) { ... }      // ❌ Duplicação!
function clamp(value, min, max) { ... }            // ❌ Usar Math.max/min ou importar
```

---

## 🔍 Como Verificar Duplicação

### 1. Buscar a função em todos os arquivos

```bash
# Exemplo: verificar se isTileWalkable está duplicada
grep -r "export function isTileWalkable" src/
```

### 2. Verificar importações

```bash
# Verificar quem importa a função canônica
grep -r "import.*isTileWalkable" src/
```

### 3. Identificar duplicações

Se encontrar **mais de um resultado** em `export function`, há duplicação!

---

## 🛠️ Como Refatorar Duplicações

### Passo 1: Identificar a versão canônica

- Arquivo em `src/core/` ou `src/gameplay/` = ✅ Canônico
- Arquivo em `src/clients/` = ❌ Provavelmente duplicado

### Passo 2: Substituir por importação

**Antes:**
```javascript
// src/clients/shared/initRPGPlayerActions.js
function calculateStepDuration(speed) {
  return Math.max(50, 600 - speed * 2);
}
```

**Depois:**
```javascript
// src/clients/shared/initRPGPlayerActions.js
import { calculateStepDuration } from "../../gameplay/gameCore.js";

// ✅ Remover a função local!
```

### Passo 3: Testar

```bash
# Verificar se não há erros de importação
node --check src/clients/shared/initRPGPlayerActions.js
```

---

## 📊 Status Atual (2026-03-29)

| Categoria | Funções Canônicas | Duplicações | Status |
|-----------|-------------------|-------------|--------|
| **Colisão** | 3 | 0 | ✅ OK |
| **Combate** | 5 | 0 | ✅ OK |
| **Player Actions** | 4 | 0 | ✅ OK |
| **Pathfinding** | 1 | 0 | ✅ OK |
| **Utilitários** | 2 | 0 | ✅ OK |

**Total:** 15 funções canônicas, 0 duplicações

---

## 🎯 Princípios

1. **Uma única fonte de verdade** — Cada função tem UM arquivo canônico
2. **Importar, não copiar** — Sempre importar de `src/core/` ou `src/gameplay/`
3. **DRY (Don't Repeat Yourself)** — Não repetir lógica em múltiplos lugares
4. **Zero Trust** — Validações sempre no server (actionProcessor.js)

---

## 📁 Estrutura de Arquivos

```
src/
├── core/                    # ✅ Funções canônicas de base
│   ├── collision.js         # isTileWalkable, getTileMovementCost
│   ├── playerAction.js      # getActionCursor, PlayerAction
│   ├── actionSystem.js      # getActionSystem
│   ├── pathfinding.js       # PathFinder
│   ├── db.js                # clamp (interno), toNumberOrNull
│   └── floorVisibility.js   # clampFloor
│
├── gameplay/                # ✅ Funções canônicas de jogo
│   ├── gameCore.js          # calculateStepDuration
│   ├── combatLogic.js       # getDirectionFromDelta, calculateCombatResult
│   ├── combat/              # processAttack, emitDamage
│   ├── actionProcessor.js   # processAction, _processMove
│   └── spellBook.js         # getSpell, canCastSpell
│
└── clients/                 # ❌ NÃO criar funções canônicas aqui
    ├── shared/              # ✅ Apenas importar
    │   ├── initRPGPlayerActions.js
    │   └── input/
    └── world-engine/        # ✅ Apenas importar
        └── boot/
```

---

**Última verificação:** 2026-03-29  
**Status:** ✅ Sem duplicações encontradas
