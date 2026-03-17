# 📜 Ações Configuráveis via JSON

## Visão Geral

O sistema de **ActionConfigLoader** permite criar ações, eventos e quests sem modificar o código do núcleo do jogo. Basta editar um arquivo JSON!

---

## 🚀 Uso Básico

### 1. Carregar Configurações

```javascript
import { createActionConfigLoader } from "./src/core/actionConfigLoader.js";

// No init do jogo
const actionLoader = createActionConfigLoader(worldState);

// Carregar de arquivo local
const response = await fetch("./assets/action_configs.json");
const config = await response.json();
actionLoader.loadFromJSON(config);

// OU carregar de URL (Firebase, HTTP)
await actionLoader.loadFromURL("https://seu-firebase.com/action_configs.json");
```

### 2. Integrar no RPG

```javascript
// No rpg.html, após initRPGPlayerActions:
import { createActionConfigLoader } from "./src/core/actionConfigLoader.js";

const actionLoader = createActionConfigLoader({
  map,
  camera: cam,
  player: myPos,
  assets: { mapData },
});

// Carrega configurações
const config = await fetch("./assets/action_configs.json").then(r => r.json());
actionLoader.loadFromJSON(config);
```

---

## 📋 Estrutura do JSON

```json
{
  "name": "Nome da Configuração",
  "version": "1.0.0",
  "actions": [
    {
      "id": "acao_única",
      "type": "position|item",
      "action": 0-6,
      "conditions": { ... },
      "effects": { ... },
      "messages": { ... }
    }
  ]
}
```

---

## 🎯 Tipos de Ação

### Type: `position`

Aciona quando player pisa em uma posição específica.

```json
{
  "id": "quest_trigger",
  "type": "position",
  "x": 150,
  "y": 200,
  "z": 7,
  "action": 2,
  "effects": {
    "setStorage": { "key": "quest_started", "value": 1 }
  },
  "messages": {
    "success": "Quest iniciada!"
  }
}
```

### Type: `item`

Aciona quando player usa um item específico.

```json
{
  "id": "magic_teleport",
  "type": "item",
  "spriteId": 1800,
  "action": 4,
  "effects": {
    "teleportTo": { "x": 200, "y": 250, "z": 7 }
  }
}
```

---

## 🔐 Condições

| Condição | Tipo | Descrição |
|----------|------|-----------|
| `minLevel` | number | Nível mínimo do player |
| `minStorage` | number | Valor mínimo de storage |
| `storageKey` | string | Chave de storage para verificar |
| `requiredItems` | array | IDs de itens necessários `[1234, 5678]` |
| `distance` | number | Distância máxima (Chebyshev) |

### Exemplo: Múltiplas Condições

```json
"conditions": {
  "minLevel": 10,
  "requiredItems": [1234, 5678],
  "storageKey": "quest_phase",
  "minStorage": 2,
  "distance": 1
}
```

---

## ✨ Efeitos

| Efeito | Tipo | Descrição |
|--------|------|-----------|
| `teleportTo` | object | Teleporta para `{x, y, z}` |
| `floorChange` | number | Muda floor (+1 ou -1) |
| `damage` | object | Dano `{amount, type}` |
| `heal` | object | Cura `{amount}` |
| `setStorage` | object | Define storage `{key, value}` |
| `removeItem` | object | Remove item `{itemId, count}` |
| `spawnCreature` | string | Spawn creature ID |
| `playEffect` | string | Toca efeito visual |
| `playSound` | string | Toca som |

### Exemplo: Múltiplos Efeitos

```json
"effects": {
  "damage": { "amount": 25, "type": "fire" },
  "teleportTo": { "x": 100, "y": 100, "z": 7 },
  "setStorage": { "key": "trap_triggered", "value": 1 },
  "playEffect": "fire_explosion"
}
```

---

## 💬 Mensagens

| Mensagem | Descrição |
|----------|-----------|
| `success` | Exibida quando ação executa com sucesso |
| `conditionFailed` | Exibida quando condição não é satisfeita |

### Variáveis nas Mensagens

```json
"messages": {
  "success": "{player.name} ativou o teleport em {target.x}, {target.y}!"
}
```

| Variável | Substituição |
|----------|--------------|
| `{player.name}` | Nome do player |
| `{player.x}` | X do player |
| `{player.y}` | Y do player |
| `{target.x}` | X do alvo |
| `{target.y}` | Y do alvo |
| `{item.name}` | Nome do item |

---

## 🎪 Eventos Customizados

```json
"onTrigger": {
  "eventName": "questStarted",
  "eventData": {
    "questId": "main_quest_01",
    "stage": "start"
  }
}
```

### Ouvir Eventos

```javascript
// No seu código
window.addEventListener("action:questStarted", (e) => {
  console.log("Quest iniciada:", e.detail);
  // Abre UI de quest, etc
});

// Ou via loader
actionLoader.on("questStarted", (data) => {
  console.log("Quest:", data);
});
```

---

## 📚 Exemplos Práticos

### 1. Baú de Quest

```json
{
  "id": "quest_chest_01",
  "type": "position",
  "x": 150,
  "y": 200,
  "z": 7,
  "conditions": {
    "storageKey": "quest_chest_completed",
    "minStorage": 0
  },
  "effects": {
    "setStorage": { "key": "quest_chest_started", "value": 1 }
  },
  "messages": {
    "success": "Você encontrou o baú da quest!",
    "conditionFailed": "Você já abriu este baú."
  }
}
```

### 2. Armadilha de Dano

```json
{
  "id": "trap_fire_01",
  "type": "position",
  "x": 180,
  "y": 220,
  "z": 7,
  "effects": {
    "damage": { "amount": 25, "type": "fire" },
    "playEffect": "fire_hit"
  },
  "messages": {
    "success": "Armadilha de fogo! -25 HP"
  }
}
```

### 3. Santuário de Cura

```json
{
  "id": "healing_shrine_01",
  "type": "item",
  "spriteId": 8500,
  "action": 2,
  "conditions": {
    "minLevel": 5
  },
  "effects": {
    "heal": { "amount": 100 },
    "playEffect": "heal_shrine"
  },
  "messages": {
    "success": "Santuário curou suas feridas! +100 HP",
    "conditionFailed": "Você precisa do nível 5."
  }
}
```

### 4. Teleporte Mágico

```json
{
  "id": "magic_teleport_blue",
  "type": "item",
  "spriteId": 1800,
  "action": 4,
  "effects": {
    "teleportTo": { "x": 200, "y": 250, "z": 7 },
    "playEffect": "teleport_blue"
  },
  "messages": {
    "success": "Teleportado pela magia azul!"
  }
}
```

### 5. NPC com Shop

```json
{
  "id": "npc_merchant",
  "type": "item",
  "spriteId": 5010,
  "action": 6,
  "conditions": {
    "distance": 1
  },
  "onTrigger": {
    "eventName": "openShop",
    "eventData": {
      "npcId": "merchant_01",
      "shopType": "general"
    }
  },
  "messages": {
    "success": "Mercador: 'Olá! Deseja comprar ou vender?'"
  }
}
```

### 6. Alavanca que Spawn Monstro

```json
{
  "id": "lever_spawn_guard",
  "type": "item",
  "spriteId": 7000,
  "action": 2,
  "effects": {
    "spawnCreature": "guard_01",
    "setStorage": { "key": "lever_pulled", "value": 1 }
  },
  "messages": {
    "success": "Você puxou a alavanca! Um guarda apareceu!"
  }
}
```

### 7. Quest com Entrega de Itens

```json
{
  "id": "quest_delivery",
  "type": "position",
  "x": 300,
  "y": 400,
  "z": 7,
  "conditions": {
    "requiredItems": [1234, 5678],
    "minLevel": 10
  },
  "effects": {
    "removeItem": { "itemId": 1234, "count": 1 },
    "setStorage": { "key": "quest_delivered", "value": 1 },
    "teleportTo": { "x": 305, "y": 405, "z": 7 }
  },
  "messages": {
    "success": "Entrega realizada! Você foi teleportado para a sala secreta!",
    "conditionFailed": "Você precisa dos itens ou nível 10."
  }
}
```

### 8. Buff Temporário

```json
{
  "id": "buff_strength_shrine",
  "type": "item",
  "spriteId": 8600,
  "action": 2,
  "conditions": {
    "storageKey": "buff_strength_expires",
    "minStorage": 0
  },
  "effects": {
    "setStorage": { "key": "buff_strength_active", "value": 1 },
    "setStorage": { "key": "buff_strength_expires", "value": 300000 }
  },
  "messages": {
    "success": "Bênção de força! +50% ATK por 5 minutos."
  }
}
```

---

## 🔧 API do ActionConfigLoader

### Métodos Principais

```javascript
// Carregar de JSON
loader.loadFromJSON(config);

// Carregar de URL
await loader.loadFromURL("https://...");

// Registrar ação manual
loader.registerAction({ id: "my_action", type: "item", ... });

// Listar ações
const actions = loader.listActions();

// Remover ação
loader.unregisterAction("action_id");

// Limpar tudo
loader.clearAll();
```

### Event Listeners

```javascript
// Ouvir evento
loader.on("eventName", (data) => { ... });

// Parar de ouvir
loader.off("eventName", callback);
```

---

## 🎯 Casos de Uso

### ✅ Quests
- Trigger ao pisar em tile
- Entrega de itens
- Sequência de eventos

### ✅ Armadilhas
- Dano por piso
- Efeitos visuais
- Spawn de monstros

### ✅ NPCs
- Diálogos
- Shops
- Quests giver

### ✅ Puzzles
- Alavancas
- Portas
- Teleportes

### ✅ Buffs/Debuffs
- Santuários
- Poções no chão
- Áreas mágicas

---

## 📝 Dicas

1. **IDs únicos**: Sempre use IDs únicos para cada ação
2. **Teste condições**: Verifique se condições fazem sentido
3. **Mensagens claras**: Use mensagens descritivas
4. **Eventos para lógica complexa**: Use `onTrigger` para lógica customizada
5. **Hot reload**: Recarregue JSON sem restartar o jogo

---

## 🐛 Debug

```javascript
// Listar ações registradas
console.log(loader.listActions());

// Habilitar logs
window.DEBUG_ACTIONS = true;

// Testar ação manualmente
loader.registerAction({
  id: "test_action",
  type: "position",
  x: 100, y: 100, z: 7,
  messages: { success: "Teste!" }
});
```

---

## 📚 Arquivo de Exemplo

Veja `assets/action_configs.json` para exemplos completos!
