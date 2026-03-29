# 🎮 mmoRPGEduc - AI Agent Instructions

## 🧭 Princípios Fundamentais (NUNCA VIOLAR)

### Zero Trust Client

- ❌ NUNCA valide lógica de jogo no cliente (range, cooldown, dano, requisitos)
- ✅ Cliente APENAS envia intenções: `{ type: "ACTION", payload: {...} }`
- ✅ Cliente APENAS renderiza estado recebido do Firebase/worldEngine
- ✅ Cliente pode fazer "optimistic UI" mas DEVE reverter se server negar

### Server Authority (worldEngine)

- ✅ TODA validação de negócio ocorre no worldEngine (Node.js futuro)
- ✅ worldEngine é a ÚNICA fonte de verdade para: HP, dano, inventário, posição
- ✅ Firebase atua como "message bus" + persistência, NÃO como lógica

### Separação de Camadas

- ✅ worldEngine é "headless" - sem dependências de renderização ou cliente
- ✅ Cliente é "dumb" - sem lógica de jogo, apenas UI e input

---

## 🛡️ Arquitetura Zero Trust — Movimento e Posição

### Visão Geral

```
┌─────────────┐     player_actions/{id}      ┌──────────────┐
│   CLIENTE   │ ───────────────────────────→ │ WorldEngine  │
│  (rpg.html) │    type: "move"              │ (actionProc) │
│             │    x, y, z, direcao          │              │
│             │                              │  Validações: │
│             │                              │  ① Distância │
│             │                              │  ② Colisão   │
│             │                              │  ③ Cooldown  │
│             │                              │              │
│  Render     │ ←── Firebase ─────────────── │  Aplica:     │
│  otimista   │     online_players/{id}      │  batchWrite  │
└─────────────┘     x, y, z (oficial)        └──────────────┘
```

### Validações Server-Side (actionProcessor.js)

**① Validação de Distância (Anti-Teleporte)**

```javascript
const dx = Math.abs(x - (player.x ?? 0));
const dy = Math.abs(y - (player.y ?? 0));
if (dx > 1 || dy > 1) return; // ❌ BLOQUEIA teleporte
```

**② Validação de Colisão (Walkable)**

```javascript
if (!isTileWalkable(x, y, z, map, mapData)) {
  return; // ❌ BLOQUEIA movimento em tile não-caminhável
}
```

**③ Validação de Cooldown (Speed Hack)**

```javascript
const speedMs = Math.max(100, Math.floor(40000 / (player.speed ?? 120)));
if (_isOnCooldown(playerId, "move")) return; // ❌ BLOQUEIA speed hack
_setCooldown(playerId, "move", speedMs);
```

### Fluxo Correto — Cliente

```javascript
// ✅ CORRETO: Cliente envia intenção, NÃO escreve posição
const actionId = `${uid}_move_${now}_${seq}`;
dbSet(`${PATHS.actions}/${actionId}`, {
  type: "move",
  playerId: uid,
  x: nx,
  y: ny,
  z: nz,
  direcao: dir,
  ts: now,
  expiresAt: now + 5000,
});

// ❌ ERRADO: Cliente NUNCA escreve posição diretamente
// batchWrite({ [`online_players/${uid}/x`]: nx, ... }); // NÃO FAZER!
```

### handlePlayerSync — Uso Restrito

```javascript
/**
 * @deprecated Use player_actions/{id} com type:"move"
 * Esta função só deve ser usada INTERNAMENTE pelo worldEngine.
 * NUNCA chamar diretamente do cliente (rpg.html, admin.html).
 */
export function handlePlayerSync(charId, myPos) {
  // ...
}
```

### Exceções (Admin/GM)

- `admin.html` pode usar `player_actions` com `source: "admin_*"` para teleport
- WorldEngine usa `player_actions` com `source: "worldengine"` para spawns
- Ambos passam pelas MESMAS validações de distância/colisão

---

## 🛡️ Arquitetura Zero Trust — Itens do Mapa (Map Tile Pickup)

### Risco: Duplicação de Itens

**Problema potencial:**

```javascript
// ❌ ERRADO: Cliente criar world_items diretamente
await dbSet(`world_items/${tempId}`, { ... }); // NÃO FAZER!
```

Se o cliente pudesse criar itens diretamente, um jogador mal-intencionado poderia:

1. Coletar um item do mapa
2. Enviar múltiplas requisições antes do servidor processar
3. Duplicar o item infinitamente

### Fluxo Correto (Já Implementado)

```
┌─────────────┐  player_actions/{id}   ┌──────────────┐
│   CLIENTE   │ ─────────────────────→ │ WorldEngine  │
│             │  type:"map_tile_pickup"│ (actionProc) │
│             │  coord, tileId,        │              │
│             │  clientTempId          │  Validações: │
│             │                        │  ① Distância │
│             │                        │  ② Tile existe│
│             │                        │  ③ Unique ID │
│             │                        │              │
│  Render     │ ←── Firebase ───────── │  Atômico:    │
│  otimista   │     world_items/{id}   │  batchWrite  │
└─────────────┘     (oficial)          │  ① Remove do │
                                        │     tile     │
                                        │  ② Cria item │
                                        └──────────────┘
```

### Validações Server-Side (\_processMapTilePickup)

**① Validação de Distância**

```javascript
const dist = Math.max(Math.abs(tx - player.x), Math.abs(ty - player.y));
if (dist > 2) return; // ❌ Fora de alcance
```

**② Validação de Existência do Tile**

```javascript
const chunkData = await dbGet(chunkPath);
const tileData = chunkData?.[tileXY];
const layerItems = tileData?.[layerStr];
const idx = layerItems.findIndex((it) => Number(it.id) === tileId);

if (idx < 0) return; // ❌ Item não existe = REJEITA
```

**③ Atômico: Remove do Tile + Cria Item**

```javascript
await batchWrite({
  [`world_items/${tempId}`]: { ... },     // Cria item
  [tilePath]: updatedLayerItems,          // Remove do tile
});
```

### Regras do Firebase (Anti-Duplicação)

```json
"world_items": {
  "$itemId": {
    ".write": "auth != null &&
               (!newData.child('skipRangeCheck').exists() ||
                newData.child('skipRangeCheck').val() === false)",
    "skipRangeCheck": { ".validate": "false" }
  }
}
```

**Proteções:**

- ✅ Cliente NUNCA pode definir `skipRangeCheck=true`
- ✅ Valida campos críticos: `fromMap`, `sourceCoord`, `unique_id`
- ✅ Valida limites: `quantity ≤ 1000`, `x/y/z` dentro do mapa

### ID Temporário (tempId)

O cliente gera um `clientTempId` **apenas para referência**, mas o servidor:

1. ✅ Valida que o tile existe antes de criar
2. ✅ Remove o item do tile ATOMICAMENTE
3. ✅ Usa o `tempId` apenas como chave única

**Formato:**

```javascript
const tempId = `maptile_${x}_${y}_${z}_${tileId}_${timestamp}`;
```

---

## 🛡️ Arquitetura Zero Trust — Portas e Mudança de Andar

### Portas (Toggle Door)

**Fluxo:**

```
Cliente → player_actions/{id} (type: "toggle_door")
  ↓
Server → Valida distância (≤ 2 SQMs)
  ↓
Server → Valida cooldown (500ms)
  ↓
Server → Valida chave (se porta trancada)
  ↓
Server → batchWrite: atualiza tile no Firebase
  ↓
Server → worldEvents.emit(DOOR_TOGGLED)
  ↓
Clientes → Renderizam porta aberta/fechada
```

**Validações Server-Side:**

```javascript
// ✅ Distância
if (dist > 2) return;

// ✅ Cooldown
if (_isOnCooldown(playerId, "toggle_door")) return;
_setCooldown(playerId, "toggle_door", 500);

// ✅ Chave (porta trancada com action_id)
if (tileActionId != null && !hasKey) {
  await dbSet(`players_data/${playerId}/server_message`, {
    text: "Esta porta está trancada com chave.",
  });
  return;
}

// ✅ Persistência
await batchWrite({
  [`${chunkPath}/${tileXY}`]: tileClone, // Porta atualizada
});
```

### Mudança de Andar (Change Floor)

**Fluxo:**

```
Cliente → player_actions/{id} (type: "change_floor")
  ↓
Server → Valida ±1 floor
  ↓
Server → Valida item (corda para rope hole)
  ↓
Server → Valida cooldown (600ms)
  ↓
Server → batchWrite: atualiza z do player
  ↓
Server → worldEvents.emit(PLAYER_MOVE)
  ↓
Clientes → Sincronizam câmera/floor
```

**Validações Server-Side:**

```javascript
// ✅ Validação de andar (±1)
if (Math.abs(toZ - fromZ) !== 1) return;

// ✅ Rope Hole requer corda
if (itemId === 386 && !hasRope) return;

// ✅ Cooldown
if (_isOnCooldown(playerId, "change_floor")) return;
_setCooldown(playerId, "change_floor", 600);

// ✅ Persistência
await batchWrite({
  [`${PATHS.playerData(playerId)}/z`]: toZ,
  [`${PATHS.player(playerId)}/z`]: toZ,
});
```

---

## 🛡️ Arquitetura Zero Trust — Buffs/Debuffs

### Problema: Memory Leak com setTimeout

**❌ ERRADO:**

```javascript
// setTimeout perde estado em restart do servidor
setTimeout(() => {
  player.stats.atk -= bonus;
}, duration);

// Se worldEngine reiniciar:
// - Timer é perdido
// - Buff fica PERMANENTE
```

### Solução: Map + Tick do WorldEngine

**✅ CORRETO:**

```javascript
// Registrar buff com timestamp de expiração
const _activeBuffs = new Map();

_activeBuffs.set(`${playerId}:${spellId}`, {
  expiresAt: now + duration,
  stat: "atk",
  originalValue: 10,
  targetType: "player",
  targetId: playerId,
});

// Processar expiração no tick (a cada 250ms)
export async function tickExpiredBuffs(now = Date.now()) {
  for (const [key, buff] of _activeBuffs.entries()) {
    if (now < buff.expiresAt) continue;
    _activeBuffs.delete(key);

    // Reverte stat no Firebase
    const updates = {};
    updates[`${PATHS.playerDataStats(buff.targetId)}/${buff.stat}`] =
      buff.originalValue;

    await batchWrite(updates);
  }
}
```

**Por Que é Seguro?**

| Risco                | Mitigação                              |
| -------------------- | -------------------------------------- |
| Restart do servidor  | Buffs checados no tick, não setTimeout |
| Memory leak          | \_activeBuffs.delete() após expirar    |
| Estado inconsistente | Reversão atômica via batchWrite        |
| Buff permanente      | Expira mesmo se servidor reiniciar     |

**Integração no World Tick:**

```javascript
// worldTick.js
async _tick() {
  const now = Date.now();

  // ... processar ações, monstros, etc.

  // ✅ Expirar buffs a cada tick
  await tickExpiredBuffs(now);
}
```

---
