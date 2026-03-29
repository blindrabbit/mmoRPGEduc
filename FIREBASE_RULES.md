# 🛡️ Firebase Rules — Validação Segura

## Problema: Validação Insuficiente

**❌ ERRADO:**
```json
{
  "player_actions": {
    ".write": "true"  // ❌ Perigoso! Qualquer um pode escrever
  }
}
```

## Solução: Regras Restritivas por Camada

**✅ CORRETO:**

```json
{
  "rules": {
    // ✅ player_actions: Lista branca de tipos + expiração
    "player_actions": {
      "$actionId": {
        ".write": "auth != null && 
                   (!newData.child('playerId').exists() || 
                    newData.child('playerId').val() === auth.uid)",
        "type": {
          ".validate": "newData.isString() && newData.val().matches(/^(attack|spell|move|item|map_tile_pickup|toggle_door|change_floor|allocateStat)$/)"
        },
        "expiresAt": {
          ".validate": "newData.isNumber() && 
                        newData.val() >= now && 
                        newData.val() < now + 60000"
        },
        "x": {
          ".validate": "!newData.exists() || 
                        (newData.isNumber() && 
                         newData.val() >= -8192 && 
                         newData.val() <= 8192)"
        },
        "$other": { ".validate": false }  // ✅ REJEITA campos extras
      }
    },
    
    // ✅ online_players: Campos de admin são somente-leitura
    "online_players": {
      "$playerId": {
        ".write": "auth != null && 
                   (auth.uid === $playerId || 
                    root.child('auth').child('admin').child(auth.uid).val() === true)",
        "isAdmin": { ".validate": "false" },  // ✅ Cliente não pode se tornar admin
        "isGM": { ".validate": "false" },
        "speed": {
          ".validate": "!newData.exists() || 
                        (newData.isNumber() && 
                         newData.val() >= 1 && 
                         newData.val() <= 600)"
        },  // ✅ Anti-speed-hack
        "lastMoveTime": {
          ".validate": "!newData.exists() || 
                        (newData.isNumber() && 
                         newData.val() <= now)"
        }  // ✅ Não pode escrever timestamp futuro
      }
    },
    
    // ✅ world_items: skipRangeCheck=false obrigatório
    "world_items": {
      "$itemId": {
        ".write": "auth != null && 
                   (!newData.child('skipRangeCheck').exists() || 
                    newData.child('skipRangeCheck').val() === false)",
        "skipRangeCheck": { ".validate": "false" },
        "fromMap": { ".validate": "!newData.exists() || newData.isBoolean()" },
        "quantity": {
          ".validate": "!newData.exists() || 
                        (newData.isNumber() && 
                         newData.val() >= 1 && 
                         newData.val() <= 1000)"
        }
      }
    }
  }
}
```

## Proteções Implementadas

| Nó | Validação | Protege Contra |
|----|-----------|----------------|
| **player_actions.type** | Lista branca | Ações não autorizadas |
| **player_actions.expiresAt** | `now <= x < now+60000` | Ações eternas/repetidas |
| **player_actions.$other** | `false` | Campos injetados |
| **online_players.isAdmin** | `false` | Escalação de privilégio |
| **online_players.speed** | `1-600` | Speed hack |
| **online_players.lastMoveTime** | `<= now` | Timestamp futuro |
| **world_items.skipRangeCheck** | `false` | Burlar validação |
| **world_items.quantity** | `1-1000` | Stack infinito |

## Validação de Timestamp (Anti-Replay)

```javascript
// ✅ expiresAt deve estar no futuro próximo
"expiresAt": {
  ".validate": "newData.isNumber() && 
                newData.val() >= now &&        // Não expirado
                newData.val() < now + 60000"   // Máx 60s no futuro
}

// ✅ Timestamps não podem ser do futuro
"lastMoveTime": {
  ".validate": "!newData.exists() || 
                (newData.isNumber() && 
                 newData.val() <= now)"  // <= tempo atual
}
```

## Validação de Coordenadas (Anti-Teleporte)

```javascript
// ✅ Limites do mapa
"x": {
  ".validate": "!newData.exists() || 
                (newData.isNumber() && 
                 newData.val() >= -8192 &&    // Limite esquerdo
                 newData.val() <= 8192)"      // Limite direito
}

"z": {
  ".validate": "!newData.exists() || 
                (newData.isNumber() && 
                 newData.val() >= 0 &&        // Floor 0
                 newData.val() <= 15)"        // Floor 15
}
```

## Regras Aplicadas em `md/firebase.rules.json`

### player_actions

```json
"player_actions": {
  "$actionId": {
    ".write": "auth != null && 
               (!newData.child('playerId').exists() || 
                newData.child('playerId').val() === auth.uid)",
    "type": {
      ".validate": "newData.isString() && 
                    newData.val().matches(/^(attack|spell|move|item|map_tile_pickup|toggle_door|change_floor|allocateStat)$/)"
    },
    "expiresAt": {
      ".validate": "newData.isNumber() && 
                    newData.val() >= now && 
                    newData.val() < now + 60000"
    },
    "x": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && 
                     newData.val() >= -8192 && 
                     newData.val() <= 8192)"
    },
    "y": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && 
                     newData.val() >= -8192 && 
                     newData.val() <= 8192)"
    },
    "z": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && 
                     newData.val() >= 0 && 
                     newData.val() <= 15)"
    },
    "source": {
      ".validate": "!newData.exists() || 
                    (newData.isString() && 
                     newData.val().matches(/^(input|keyboard|admin_|worldengine|player-actions|autowalk)$/))"
    },
    "$other": { ".validate": false }
  }
}
```

### online_players

```json
"online_players": {
  "$playerId": {
    ".write": "auth != null && 
               (auth.uid === $playerId || 
                root.child('auth').child('admin').child(auth.uid).val() === true)",
    "isAdmin": { ".validate": "false" },
    "isGM": { ".validate": "false" },
    "speed": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && 
                     newData.val() >= 1 && 
                     newData.val() <= 600)"
    },
    "lastMoveTime": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && 
                     newData.val() >= 0 && 
                     newData.val() <= now)"
    },
    "lastSeen": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && 
                     newData.val() >= 0 && 
                     newData.val() <= now)"
    }
  }
}
```

### world_items

```json
"world_items": {
  "$itemId": {
    ".write": "auth != null && 
               (!newData.child('skipRangeCheck').exists() || 
                newData.child('skipRangeCheck').val() === false)",
    "skipRangeCheck": { ".validate": "false" },
    "fromMap": { ".validate": "!newData.exists() || newData.isBoolean()" },
    "sourceCoord": { ".validate": "!newData.exists() || newData.isString()" },
    "unique_id": { ".validate": "!newData.exists() || newData.isNumber()" },
    "tileId": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && newData.val() > 0)"
    },
    "quantity": {
      ".validate": "!newData.exists() || 
                    (newData.isNumber() && 
                     newData.val() >= 1 && 
                     newData.val() <= 1000)"
    }
  }
}
```

## Resumo das Validações

| Categoria | Validações |
|-----------|------------|
| **Autenticação** | `auth != null`, `auth.uid === $playerId` |
| **Lista Branca** | `type`, `source`, `direcao` |
| **Limites Numéricos** | `x/y/z`, `speed`, `quantity`, `hp/mp` |
| **Timestamp** | `>= now`, `<= now`, `< now + 60000` |
| **Campos Bloqueados** | `isAdmin`, `isGM`, `role`, `skipRangeCheck=true` |
| **Campos Extras** | `$other: false` |

---

**Arquivo:** `md/firebase.rules.json`
**Última atualização:** 2026-03-29
