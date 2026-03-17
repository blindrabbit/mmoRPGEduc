# Sistema de Player Actions — Documentação de Integração

## Visão Geral

Este sistema implementa ações de jogador baseadas no **OTClient** (opentibiabr/otclient), permitindo que itens e tiles tenham comportamentos interativos.

## 📋 Enum PLAYER_ACTION Oficial (OTClient)

No OTClient (`src/client/const.h`), o enum é definido assim:

```cpp
enum PLAYER_ACTION : uint8_t {
    PLAYER_ACTION_NONE = 0,
    PLAYER_ACTION_LOOK = 1,
    PLAYER_ACTION_USE = 2,
    PLAYER_ACTION_OPEN = 3,
    PLAYER_ACTION_AUTOWALK_HIGHLIGHT = 4
};
```

### Valores Numéricos Oficiais

| Valor | Constante            | Descrição        | Uso Típico            |
| ----- | -------------------- | ---------------- | --------------------- |
| **0** | `NONE`               | Nenhuma ação     | Default               |
| **1** | `LOOK`               | Inspecionar      | Itens, creatures      |
| **2** | `USE`                | Usar item        | Portas, alavancas     |
| **3** | `OPEN`               | Abrir            | Containers, portas    |
| **4** | `AUTOWALK_HIGHLIGHT` | Mover + destacar | Chão, tiles walkáveis |

### Exemplo: Item 369 (Grama)

No seu `map_data.json`, o item 369 tem:

```json
"369": {
  "flags_raw": {
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

**Significado:** Quando o player clica neste tile, o cliente deve executar **autowalk** até o tile adjacente e destacá-lo.

---

## Arquitetura

```
src/core/
├── playerAction.js      # Enum PlayerAction com todas as ações
├── actionSystem.js      # Sistema de registro e execução de ações
└── pathfinding.js       # Algoritmo A* para navegação automática

src/gameplay/
├── playerInputHandler.js # Handler de input (mouse/keyboard)
└── defaultActions.js     # Ações pré-configuradas para itens comuns
```

---

## Como Integrar no Seu Jogo

### 1. Inicializar o Sistema

No seu arquivo principal (ex: `rpg.html` ou `worldEngine.html`), adicione:

```javascript
import { getActionSystem } from "./src/core/actionSystem.js";
import { registerDefaultActions } from "./src/gameplay/defaultActions.js";
import { createPlayerInputHandler } from "./src/gameplay/playerInputHandler.js";

// Após carregar o mapa e assets
function initActionSystem() {
  // 1. Registra ações padrão (escadas, portas, NPCs, etc)
  registerDefaultActions(worldState);

  // 2. Cria o handler de input
  const inputHandler = createPlayerInputHandler({
    canvas: document.getElementById("gameCanvas"),
    camera: worldState.camera,
    worldState: worldState,

    // Callbacks
    onPlayerMove: (moveData) => {
      // Executa movimento (autowalk)
      if (moveData.type === "autowalk") {
        executeAutoWalk(moveData.directions);
      }
    },

    onPlayerAction: (actionData) => {
      // Executa ação (use, talk, attack, etc)
      handlePlayerAction(actionData);
    },

    showLookMessage: (message) => {
      // Exibe mensagem de look no chat/HUD
      addChatMessage(message, "look");
    },
  });

  return inputHandler;
}
```

---

### 2. Adicionar defaultAction ao Metadata dos Itens

No seu `appearances_map.json` (ou arquivo de metadata), adicione o campo `default_action`:

```json
{
  "103": {
    "id": 103,
    "name": "Grama",
    "flags_raw": {
      "bank": true,
      "unmove": true
    },
    "game": {
      "render_layer": 0,
      "category_type": "ground",
      "is_walkable": true,
      "default_action": "PLAYER_ACTION_AUTOWALK_HIGHLIGHT"
    }
  },
  "1900": {
    "id": 1900,
    "name": "Escada",
    "flags_raw": {
      "unmove": true
    },
    "game": {
      "render_layer": 2,
      "category_type": "floor_change",
      "floor_change": -1,
      "default_action": "PLAYER_ACTION_CHANGE_FLOOR"
    }
  },
  "1800": {
    "id": 1800,
    "name": "Teleport",
    "flags_raw": {
      "unmove": true
    },
    "game": {
      "render_layer": 2,
      "category_type": "teleport",
      "teleport_to": { "x": 100, "y": 100, "z": 7 },
      "default_action": "PLAYER_ACTION_TELEPORT"
    }
  }
}
```

---

### 3. Executar Autowalk

```javascript
function executeAutoWalk(directions) {
  // directions: array de números (1-8) conforme protocolo Tibia
  // 1=EAST, 2=NORTHEAST, 3=NORTH, 4=NORTHWEST, 5=WEST, 6=SOUTHWEST, 7=SOUTH, 8=SOUTHEAST

  let currentIndex = 0;

  function step() {
    if (currentIndex >= directions.length) return;

    const dir = directions[currentIndex];
    const delta = DIRECTION_DELTA[dir];

    // Atualiza posição do player
    worldState.player.x += delta.dx;
    worldState.player.y += delta.dy;

    currentIndex++;

    // Próximo passo após delay
    setTimeout(step, getStepDelay());
  }

  step();
}
```

---

### 4. Registrar Ações Customizadas

```javascript
import {
  registerCustomItemAction,
  registerPositionAction,
} from "./src/gameplay/defaultActions.js";

// Ação para um item específico (ex: alavanca)
registerCustomItemAction(7000, (ctx) => {
  const { player, target, updateTileSprite } = ctx;

  // Verifica se player está adjacente
  const dx = Math.abs(player.x - target.x);
  const dy = Math.abs(player.y - target.y);

  if (dx > 1 || dy > 1) {
    showLookMessage("Você está muito longe!");
    return false;
  }

  // Toggle sprite da alavanca
  const newSprite = target.id === 7000 ? 7001 : 7000;
  updateTileSprite(target.x, target.y, target.z, target.id, newSprite);

  // Triggera evento (abre porta, spawn, etc)
  onLeverPulled(target.x, target.y);

  return true;
});

// Ação para uma posição específica (ex: quest trigger)
registerPositionAction(150, 200, 7, (ctx) => {
  const { player, setStorageValue, showLookMessage } = ctx;

  // Verifica se player já completou quest
  if (player.storage?.["quest_example_completed"]) {
    return false;
  }

  // Completa quest
  setStorageValue("quest_example_completed", 1);
  showLookMessage("Quest iniciada: Encontre o tesouro perdido!");

  return true;
});
```

---

## PlayerAction Enum

| Ação                 | Descrição               | Uso Típico         |
| -------------------- | ----------------------- | ------------------ |
| `NONE`               | Nenhuma ação            | Default            |
| `AUTOWALK_HIGHLIGHT` | Move até tile adjacente | Chão, bordas       |
| `LOOK`               | Inspeciona              | Itens, creatures   |
| `USE`                | Usa item                | Portas, alavancas  |
| `USE_WITH_HOTKEY`    | Usa com hotkey          | Runas, poções      |
| `USE_ON_TARGET`      | Usa em target           | Chave em porta     |
| `OPEN_CONTAINER`     | Abre container          | Baús, mochilas     |
| `TRADE`              | Inicia trade            | NPCs, players      |
| `BUY`                | Compra                  | NPCs comerciantes  |
| `SELL`               | Vende                   | NPCs comerciantes  |
| `TELEPORT`           | Teletransporta          | Magic forcefield   |
| `CHANGE_FLOOR`       | Muda floor              | Escadas, rampas    |
| `ATTACK`             | Ataca                   | Creatures hostis   |
| `FOLLOW`             | Segue                   | Creatures, players |
| `TALK`               | Conversa                | NPCs               |
| `MESSAGE`            | Mensagem privada        | Players            |
| `PICKUP`             | Pega item               | Itens no chão      |
| `MOVE`               | Move item               | Drag & drop        |
| `ROTATE`             | Rotaciona               | Móveis             |
| `WRITE`              | Escreve                 | Livros, placas     |
| `IMBUE`              | Imbue item              | Imbuing shrine     |
| `CAST_SPELL`         | Conjura spell           | Spells com target  |

---

## Exemplo: Escada Funcional

### Metadata (appearances_map.json)

```json
{
  "1900": {
    "id": 1900,
    "name": "Stair",
    "flags_raw": { "unmove": true },
    "game": {
      "render_layer": 2,
      "category_type": "floor_change",
      "floor_change": -1,
      "default_action": "PLAYER_ACTION_CHANGE_FLOOR"
    }
  }
}
```

### Mapa (map_data.json)

```json
{
  "100,100,7": [103, 103, 1900],
  "100,100,6": [103, 103]
}
```

### Uso

1. Player clica na escada em (100, 100, 7)
2. Sistema executa autowalk até tile adjacente
3. Ao chegar, executa `CHANGE_FLOOR`
4. Player é movido para (100, 100, 6)

---

## Exemplo: NPC com Diálogo

### Metadata

```json
{
  "5000": {
    "id": 5000,
    "name": "NPC Guard",
    "flags_raw": { "unmove": true },
    "game": {
      "render_layer": 2,
      "category_type": "npc",
      "default_action": "PLAYER_ACTION_TALK"
    }
  }
}
```

### Diálogo (em defaultActions.js)

```javascript
registerNPCAction(actionSystem, worldState, {
  spriteIds: [5000],
  dialogTree: {
    greet: {
      text: "Olá! Posso ajudar?",
      responses: [
        { text: "Comprar poção", action: "buy_item", itemId: 1001, price: 50 },
        { text: "Adeus", next: "farewell" },
      ],
    },
    farewell: {
      text: "Até logo!",
      end: true,
    },
  },
});
```

---

## Debug e Testes

```javascript
// Habilita debug de hover
window.DEBUG_HOVER = true;

// Lista ações registradas
const actionSystem = getActionSystem();
console.log("Ações registradas:", Array.from(actionSystem.handlers.keys()));

// Testa ação manualmente
actionSystem.execute(PlayerAction.LOOK, {
  player: { x: 100, y: 100, z: 7 },
  target: { id: 1900, x: 101, y: 100, z: 7 },
  metadata: { name: "Stair" },
  showLookMessage: console.log,
});
```

---

## Próximos Passos

1. **Implementar pathfinding real** - Usar `pathfinding.js` com dados do mapa
2. **Criar UI de chat** - Para diálogo com NPCs
3. **Criar UI de container** - Para inventário de baús
4. **Criar UI de trade** - Para compra/venda
5. **Criar UI de imbue** - Para imbuing shrine
6. **Adicionar animações** - Para movimento e ações
7. **Implementar condições** - Para validar ações (ex: chave necessária)

---

## Referências

- **Tibia Canary**: `src/server/network/protocol/protocolgame.cpp` (parseAutoWalk)
- **Tibia Canary**: `src/creatures/creature.cpp` (startAutoWalk)
- **Tibia Canary**: `data-canary/scripts/actions/` (exemplos de ações Lua)
