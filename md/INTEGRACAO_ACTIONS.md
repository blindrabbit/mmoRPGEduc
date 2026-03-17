# 🚀 Guia Rápido de Integração — Player Actions

## ✅ Integração Automática (Já Feita!)

O sistema de Player Actions já está integrado em ambos os clientes:

### 📺 worldEngine.html

- Sistema inicializado em `initPlayerActionsIntegration()`
- Arquivo: `src/clients/world-engine/boot/initPlayerActions.js`

### 🎮 rpg.html

- Sistema inicializado após `setupMovement()`
- Arquivo: `src/clients/shared/initRPGPlayerActions.js`
- Import e chamada já adicionados no `rpg.html`

---

## ✅ Passo 3: Configurar Itens no Map Data

No seu `map_data.json`, os itens já devem ter o `default_action`:

### Exemplo: Grama (Autowalk)

```json
"369": {
  "id": 369,
  "flags_raw": {
    "bank": true,
    "unmove": true,
    "default_action": {
      "action": 4  // PLAYER_ACTION_AUTOWALK_HIGHLIGHT
    }
  },
  "game": {
    "category_type": "ground",
    "is_walkable": true
  }
}
```

### Exemplo: Escada (Muda Floor)

```json
"1900": {
  "id": 1900,
  "flags_raw": {
    "unmove": true,
    "default_action": {
      "action": 5  // CHANGE_FLOOR (ação estendida)
    }
  },
  "game": {
    "category_type": "floor_change",
    "floor_change": -1  // Sobe 1 floor
  }
}
```

### Exemplo: Baú (Abre Container)

```json
"4000": {
  "id": 4000,
  "flags_raw": {
    "container": true,
    "default_action": {
      "action": 3  // PLAYER_ACTION_OPEN
    }
  },
  "game": {
    "category_type": "container"
  }
}
```

---

## ✅ Passo 4: Testar no Jogo

1. **Abra o `worldEngine.html`**
2. **Clique em um tile de grama** → Player deve executar autowalk
3. **Clique em uma escada** → Player deve mudar de floor
4. **Clique em um baú** → Deve abrir container (se implementado)

---

## 🔧 Personalização

### Registrar Ação Customizada

```javascript
import { registerCustomItemAction } from "./src/gameplay/defaultActions.js";

// Alavanca que abre porta
registerCustomItemAction(7000, (ctx) => {
  const { player, target, updateTileSprite } = ctx;

  // Toggle sprite
  const newSprite = target.id === 7000 ? 7001 : 7000;
  updateTileSprite(target.x, target.y, target.z, target.id, newSprite);

  // Triggera evento
  onLeverPulled(target.x, target.y);

  return true;
});
```

### Registrar Ação por Posição

```javascript
import { registerPositionAction } from "./src/gameplay/defaultActions.js";

// Quest trigger em posição específica
registerPositionAction(150, 200, 7, (ctx) => {
  const { player, setStorageValue, showLookMessage } = ctx;

  if (!player.storage?.["quest_example_completed"]) {
    setStorageValue("quest_example_completed", 1);
    showLookMessage("Quest iniciada: Encontre o tesouro!");
  }

  return true;
});
```

---

## 📊 Valores do Enum PLAYER_ACTION

| Valor | Nome                 | Descrição               |
| ----- | -------------------- | ----------------------- |
| 0     | `NONE`               | Nenhuma ação            |
| 1     | `LOOK`               | Inspecionar             |
| 2     | `USE`                | Usar item               |
| 3     | `OPEN`               | Abrir container/porta   |
| 4     | `AUTOWALK_HIGHLIGHT` | Mover até tile          |
| 5+    | (ações estendidas)   | CHANGE_FLOOR, TALK, etc |

---

## 🐛 Debug

```javascript
// Habilita logs
window.DEBUG_ACTIONS = true;

// Verifica ações registradas
const actionSystem = getActionSystem();
console.log("Ações:", Array.from(actionSystem.handlers.keys()));

// Testa ação manualmente
actionSystem.execute(4, {
  // AUTOWALK_HIGHLIGHT
  player: { x: 100, y: 100, z: 7 },
  target: { x: 101, y: 100, z: 7 },
});
```

---

## 📚 Próximos Passos

1. **Implementar UI de container** — Para `OPEN_CONTAINER`
2. **Implementar diálogo com NPC** — Para `TALK`
3. **Implementar sistema de trade** — Para `BUY`/`SELL`
4. **Implementar pathfinding real** — Usar `pathfinding.js` com validação de mapa
5. **Adicionar animações de movimento** — Smooth walking

---

## ❓ Dúvidas?

Consulte a documentação completa em `PLAYER_ACTIONS.md`.
