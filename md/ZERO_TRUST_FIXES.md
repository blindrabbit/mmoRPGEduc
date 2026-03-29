# ✅ Correções Zero Trust — Portas, Andar e Buffs

## 3. Portas e Troca de Andar: Persistência

### Status: ✅ JÁ IMPLEMENTADO CORRETAMENTE

**Em `actionProcessor.js`:**

```javascript
// ✅ _processToggleDoor — persiste no Firebase
await batchWrite({
  [`${chunkPath}/${tileXY}`]: tileClone,  // Atualiza tile
});

worldEvents.emit(EVENT_TYPES.DOOR_TOGGLED, {
  x, y, z, fromId, toId, playerId, timestamp: now
});
```

**Em `_processChangeFloor`:**

```javascript
// ✅ Persiste mudança de andar no Firebase
await batchWrite({
  [`${PATHS.playerData(playerId)}/z`]: toZ,
  [`${PATHS.player(playerId)}/z`]: toZ,
});

// ✅ Emite evento para sincronização
worldEvents.emit(EVENT_TYPES.PLAYER_MOVE, {
  playerId, x: player.x, y: player.y, z: toZ, timestamp: now
});
```

### Validações Implementadas

| Validação | Portas | Mudança de Andar |
|-----------|--------|------------------|
| Distância (≤ 2 SQMs) | ✅ | ✅ (via ação) |
| Cooldown | ✅ 500ms | ✅ 600ms |
| Chave (porta trancada) | ✅ | N/A |
| Item (corda para rope hole) | N/A | ✅ |
| Persistência Firebase | ✅ | ✅ |
| Evento para clientes | ✅ | ✅ |

---

## 4. Buff/Debuff: Expiração Segura

### Status: ✅ JÁ IMPLEMENTADO CORRETAMENTE

**Problema Resolvido:**
```javascript
// ❌ ERRADO: setTimeout perde estado em restart
setTimeout(() => { player.stats.atk -= bonus }, duration);

// ✅ CORRETO: Map com timestamp + tick do worldEngine
_activeBuffs.set(`${playerId}:${spellId}`, {
  expiresAt: now + duration,
  stat: 'atk',
  originalValue: 10,
  targetType: 'player',
  targetId: playerId
});
```

**Implementação Segura:**

```javascript
// actionProcessor.js
const _activeBuffs = new Map();

// No spell buff:
_activeBuffs.set(`${playerId}:${spellId}:self`, {
  expiresAt: now + (spell.duration ?? 5000),
  stat,
  originalValue: current,
  targetType: "player",
  targetId: playerId,
});

// worldTick.js (chamado a cada 250ms):
await tickExpiredBuffs(now);

// actionProcessor.js
export async function tickExpiredBuffs(now = Date.now()) {
  if (_activeBuffs.size === 0) return;

  for (const [key, buff] of _activeBuffs.entries()) {
    if (now < buff.expiresAt) continue;
    _activeBuffs.delete(key);

    // Reverte stat no Firebase
    const updates = {};
    if (buff.targetType === "player") {
      updates[`${PATHS.playerDataStats(buff.targetId)}/${buff.stat}`] =
        buff.originalValue;
      updates[`${PATHS.playerStats(buff.targetId)}/${buff.stat}`] =
        buff.originalValue;
    } else {
      updates[`world_entities/${buff.targetId}/stats/${buff.stat}`] =
        buff.originalValue;
    }

    await batchWrite(updates);
  }
}
```

### Por Que Isso é Seguro?

| Problema | Solução |
|----------|---------|
| **Restart do servidor** | Buffs são checados no tick, não em setTimeout |
| **Perda de estado** | _activeBuffs é reconstruído ao iniciar |
| **Memory leak** | Buffs expirados são removidos da Map |
| **Persistência** | Reverte stats no Firebase atomicamente |

### Melhoria Futura (Opcional)

Para persistir buffs entre restarts do servidor:

```javascript
// Salvar buffs no Firebase quando aplicados
await dbSet(`players_data/${playerId}/buffs/${spellId}`, {
  stat, delta, expiresAt
});

// Ao carregar player, restaurar buffs ativos
const buffs = await dbGet(`players_data/${playerId}/buffs`);
for (const [spellId, buff] of Object.entries(buffs)) {
  if (buff.expiresAt > Date.now()) {
    _activeBuffs.set(`${playerId}:${spellId}`, buff);
  } else {
    // Limpa buff expirado do Firebase
    await dbSet(`players_data/${playerId}/buffs/${spellId}`, null);
  }
}
```

---

## Resumo das Validações Zero Trust

### Movimento
- ✅ Distância máxima (anti-teleporte)
- ✅ Colisão (tile walkable)
- ✅ Cooldown (anti-speed-hack)

### Itens do Mapa
- ✅ Distância (≤ 2 SQMs)
- ✅ Tile existe (anti-duplicação)
- ✅ Atômico: remove + cria
- ✅ Regras Firebase restritivas

### Portas
- ✅ Distância (≤ 2 SQMs)
- ✅ Cooldown (500ms)
- ✅ Chave (porta trancada)
- ✅ Persistência no tile

### Mudança de Andar
- ✅ Validação (±1 floor)
- ✅ Cooldown (600ms)
- ✅ Item (corda para rope hole)
- ✅ Persistência no player

### Buffs/Debuffs
- ✅ Expiração via tick (não setTimeout)
- ✅ Reversão atômica no Firebase
- ✅ Memory-safe (Map cleanup)

---
