# 🛡️ Action Schema Validation — Arquitetura Zero Trust

## 📋 Visão Geral

Inspirado no sistema de protocolo do **Canary/OTClient**, implementamos uma camada de **Schema Validation** que valida todas as ações antes de executar.

```
┌─────────────┐     player_actions/{id}      ┌──────────────────┐
│   CLIENTE   │ ───────────────────────────→ │  Schema Validator│
│             │    { type, playerId, ... }   │  (actionSchema)  │
│             │                              │                  │
│             │                              │  Valida:         │
│             │                              │  ✓ Campos        │
│             │                              │  ✓ Tipos         │
│             │                              │  ✓ Limites       │
│             │                              │  ✓ Distância     │
│             │                              │  ✓ Timestamp     │
│             │                              └────────┬─────────┘
│             │                                       │
│             │                              ┌────────▼─────────┐
│             │                              │ actionProcessor  │
│             │                              │ (business logic) │
│             │                              └────────┬─────────┘
│             │                                       │
│             │                              ┌────────▼─────────┐
│  Render     │ ←── Firebase ─────────────── │  Aplicação       │
│  otimista   │     online_players/{id}      │  (batchWrite)    │
└─────────────┘     (estado oficial)         └──────────────────┘
```

---

## 🎯 Camadas de Validação

### Camada 0: Schema Validation (NOVA)

**Arquivo:** `src/core/actionSchema.js`

**O que valida:**
- ✅ Campos obrigatórios existem
- ✅ Tipos de dados corretos
- ✅ Limites de coordenadas
- ✅ Distância máxima
- ✅ Timestamp válido (anti-replay)
- ✅ Enums válidos (direção, itemAction, stat)

**Exemplo:**
```javascript
const validation = validateAction({
  type: "move",
  playerId: "user123",
  x: 100,
  y: 100,
  z: 7,
  direcao: "frente"
}, player);

if (!validation.ok) {
  console.error(validation.error);  // "distance_exceeded"
  return;  // ❌ Rejeita antes de processar
}
```

### Camada 1: Validações de Negócio

**Arquivo:** `src/gameplay/actionProcessor.js`

**O que valida:**
- ✅ Cooldowns
- ✅ Colisão (isTileWalkable)
- ✅ Mana/HP suficiente
- ✅ Requisitos de skill
- ✅ Inventário

### Camada 2: Validações Específicas

**Arquivos:** `spellBook.js`, `combatLogic.js`, `ItemMoveValidator.js`

**O que valida:**
- ✅ Requisitos de magia
- ✅ Fórmula de dano
- ✅ Regras de movimento de item

---

## 📊 Action Schema — Tipos de Ação

### 1. Move (Movimento)

```javascript
{
  type: "move",
  required: ["playerId", "x", "y"],
  optional: ["z", "direcao", "source", "ts", "expiresAt"],
  validators: [
    validatePlayerId,       // playerId é string válida?
    validateCoordinates,    // x,y,z dentro dos limites?
    validateDirection,      // direção é válida?
    validateDistance("move"), // dx ≤ 1, dy ≤ 1?
    validateTimestamp       // ts é recente?
  ]
}
```

**Exemplo válido:**
```json
{
  "type": "move",
  "playerId": "user123",
  "x": 100,
  "y": 100,
  "z": 7,
  "direcao": "frente",
  "source": "keyboard",
  "ts": 1711728000000,
  "expiresAt": 1711728060000
}
```

**Exemplo inválido:**
```json
{
  "type": "move",
  "playerId": "user123",
  "x": 99999,  // ❌ Fora dos limites
  "y": 99999
}
// Error: "coord_out_of_bounds"
```

---

### 2. Attack (Ataque Físico)

```javascript
{
  type: "attack",
  required: ["playerId", "targetId"],
  validators: [
    validatePlayerId,
    validateTargetExists,  // target existe e está vivo?
    validateDistance("attack"), // range ≤ 1.5?
    validateTimestamp
  ]
}
```

**Exemplo inválido:**
```json
{
  "type": "attack",
  "playerId": "user123",
  "targetId": "monster_999"  // ❌ Não existe
}
// Error: "target_not_found"
```

---

### 3. Spell (Magia)

```javascript
{
  type: "spell",
  required: ["playerId", "spellId"],
  optional: ["targetId", "targetX", "targetY", "targetZ"],
  validators: [
    validatePlayerId,
    validateSpellId,       // spell existe?
    validateSpellTarget,   // target correto para o tipo?
    validateTimestamp
  ]
}
```

**Regras por tipo:**
- **DIRECT:** precisa de `targetId`
- **FIELD:** precisa de `targetX`, `targetY`
- **SELF:** não precisa de target
- **AOE:** não precisa de target

---

### 4. Item (Ação de Item)

```javascript
{
  type: "item",
  required: ["playerId", "itemAction"],
  validators: [
    validatePlayerId,
    validateItemAction,     // ação é válida?
    validateItemPayload     // payload correto para a ação?
  ]
}
```

**Ações válidas:**
- `use`, `equip`, `unequip`
- `drop`, `move`, `pickUp`, `moveWorld`

**Exemplo:**
```json
{
  "type": "item",
  "playerId": "user123",
  "itemAction": "equip",
  "slotIndex": 5,
  "equipSlot": "weapon"  // ✅ Obrigatório para equip
}
```

---

### 5. Map Tile Pickup (Coletar Item do Mapa)

```javascript
{
  type: "map_tile_pickup",
  required: ["playerId", "coord", "tileId", "mapLayer"],
  validators: [
    validatePlayerId,
    validateTileCoord,     // coord formato "x,y,z"?
    validateTileId,        // tileId é número?
    validateMapLayer,      // mapLayer é número?
    validateDistance("interact"), // distância ≤ 2?
    validateTimestamp
  ]
}
```

**Exemplo válido:**
```json
{
  "type": "map_tile_pickup",
  "playerId": "user123",
  "coord": "100,100,7",
  "tileId": 3501,
  "mapLayer": 0,
  "clientTempId": "maptile_100_100_7_3501_1711728000000"
}
```

---

### 6. Toggle Door (Abrir/Fechar Porta)

```javascript
{
  type: "toggle_door",
  required: ["playerId", "target", "fromId", "toId"],
  validators: [
    validatePlayerId,
    validateTarget,        // target tem x,y,z?
    validateTileId("fromId"),
    validateTileId("toId"),
    validateDistance("interact"),
    validateTimestamp
  ]
}
```

---

### 7. Change Floor (Mudar de Andar)

```javascript
{
  type: "change_floor",
  required: ["playerId", "fromZ", "toZ"],
  validators: [
    validatePlayerId,
    validateFloorChange,   // |toZ - fromZ| = 1?
    validateTimestamp
  ]
}
```

**Exemplo inválido:**
```json
{
  "type": "change_floor",
  "playerId": "user123",
  "fromZ": 7,
  "toZ": 9  // ❌ Diferença > 1
}
// Error: "invalid_floor_diff"
```

---

### 8. Allocate Stat (Distribuir Atributo)

```javascript
{
  type: "allocateStat",
  required: ["playerId", "statName", "amount"],
  validators: [
    validatePlayerId,
    validateStatName,      // stat é válido?
    validateStatAmount,    // 1 ≤ amount ≤ 10?
    validateTimestamp
  ]
}
```

**Stats válidos:** `str`, `dex`, `int`, `con`, `agi`, `luk`

---

## 🔍 Validadores Base

### Coordenadas

```javascript
validateCoordinates(action) {
  // Valida:
  // - x, y são números finitos
  // - z é número (opcional)
  // - Limites: -8192 ≤ x,y ≤ 8192
  // - Limites: 0 ≤ z ≤ 15
}
```

### Distância

```javascript
validateDistance("move")(action, player) {
  // Valida:
  // - dx = |action.x - player.x| ≤ 1
  // - dy = |action.y - player.y| ≤ 1
}
```

### Timestamp

```javascript
validateTimestamp(action) {
  // Valida:
  // - ts é número recente (< 5s)
  // - expiresAt está no futuro (< 60s)
}
```

---

## 📁 Integração no ActionProcessor

```javascript
// actionProcessor.js
import { validateAction } from "../core/actionSchema.js";

async function _dispatch(actionId, action, now) {
  // ✅ VALIDAÇÃO ZERO TRUST #0: Schema Validation
  const validation = validateAction(action, player);
  if (!validation.ok) {
    pushLog("error", `[Schema] ${action.type} inválida: ${validation.error}`);
    return;  // ❌ Rejeita antes de processar
  }

  // ✅ Validações de negócio (cooldown, colisão, etc)
  // ...
}
```

---

## 🎯 Benefícios

| Benefício | Descrição |
|-----------|-----------|
| **Validação Precoce** | Rejeita ações inválidas antes de processar |
| **Código Limpo** | Validações centralizadas em um lugar |
| **Manutenção** | Fácil adicionar novos tipos de ação |
| **Debug** | Erros claros com campo específico |
| **Segurança** | Zero Trust: nunca confie no cliente |
| **Inspiração Canary** | Similar ao `ProtocolGame::parse*()` |

---

## 🧪 Exemplos de Uso

### ✅ Ação Válida

```javascript
const action = {
  type: "move",
  playerId: "user123",
  x: 100,
  y: 100,
  z: 7,
  direcao: "frente",
  ts: Date.now(),
  expiresAt: Date.now() + 5000
};

const validation = validateAction(action, player);
console.log(validation);  // { ok: true }
```

### ❌ Ação Inválida (Coordenadas)

```javascript
const action = {
  type: "move",
  playerId: "user123",
  x: 99999,  // ❌ Fora dos limites
  y: 99999
};

const validation = validateAction(action, player);
console.log(validation);
// {
//   ok: false,
//   error: "coord_out_of_bounds",
//   field: "x,y",
//   limits: { min: -8192, max: 8192, zMin: 0, zMax: 15 }
// }
```

### ❌ Ação Inválida (Timestamp)

```javascript
const action = {
  type: "move",
  playerId: "user123",
  x: 100,
  y: 100,
  ts: Date.now() - 10000  // ❌ 10s atrás
};

const validation = validateAction(action, player);
console.log(validation);
// {
//   ok: false,
//   error: "action_too_old",
//   field: "ts",
//   age: 10000,
//   maxAge: 5000
// }
```

---

## 📊 Constantes de Validação

```javascript
// Limites de coordenadas
const COORD_LIMITS = {
  min: -8192,
  max: 8192,
  zMin: 0,
  zMax: 15,
};

// Distâncias máximas por tipo de ação
const DISTANCE_LIMITS = {
  move: 1,        // Movimento: 1 SQM
  attack: 1.5,    // Melee: 1 SQM
  spell: 5,       // Magias: varia
  interact: 2,    // Interação: 2 SQMs
};

// Direções válidas
const VALID_DIRECTIONS = new Set([
  "frente",
  "costas",
  "lado",
  "lado-esquerdo",
]);

// Ações de item válidas
const VALID_ITEM_ACTIONS = new Set([
  "use",
  "equip",
  "unequip",
  "drop",
  "move",
  "pickUp",
  "moveWorld",
]);
```

---

## 🚀 Próximos Passos

1. **Adicionar mais validadores:**
   - `validateInventorySlot()`
   - `validateEquipmentSlot()`
   - `validateSpellCooldown()`

2. **Validação de permissões:**
   - `validateAdminAction()`
   - `validateGMCommand()`

3. **Cache de validação:**
   - Cache de `getSpell()` para performance
   - Cache de `getMonsters()` para validação de target

---

**Arquivo:** `src/core/actionSchema.js`  
**Última atualização:** 2026-03-29  
**Inspiração:** Canary/OTClient `ProtocolGame::parse*()`
