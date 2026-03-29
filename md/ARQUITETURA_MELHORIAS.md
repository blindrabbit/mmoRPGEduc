# 🚀 Melhorias de Arquitetura Implementadas

## 📋 Visão Geral

Implementações inspiradas em Canary/OTClient para melhorar performance, manutenção e debug.

---

## 1. ✅ Action Schema Validation

**Arquivo:** `src/core/actionSchema.js`

**Descrição:** Camada de validação de ações inspirada em `ProtocolGame::parse*()` do Canary.

**Benefícios:**
- ✅ Valida campos obrigatórios antes de processar
- ✅ Valida tipos de dados e limites
- ✅ Previne ações malformadas
- ✅ Erros claros com campo específico

**Uso:**
```javascript
import { validateAction } from "../core/actionSchema.js";

const validation = validateAction(action, player);
if (!validation.ok) {
  console.error(validation.error);  // Rejeita
  return;
}
```

**Documentação:** `ACTION_SCHEMA.md`

---

## 2. ✅ CooldownManager Centralizado

**Arquivo:** `src/core/CooldownManager.js`

**Descrição:** Gerenciador centralizado de cooldowns com limpeza automática.

**Benefícios:**
- ✅ Único lugar para gerenciar cooldowns
- ✅ Limpeza automática no tick (evita memory leak)
- ✅ Suporte a cooldowns globais e individuais
- ✅ API para obter tempo restante/decorrido

**Uso:**
```javascript
import { cooldownManager } from "../core/CooldownManager.js";

// Verificar
if (cooldownManager.isOnCooldown(playerId, "basicAttack")) {
  return;  // Está em cooldown
}

// Definir
cooldownManager.setCooldown(playerId, "basicAttack", 1000);

// Limpar no tick
cooldownManager.tick(Date.now());
```

**Migração:**
```javascript
// Antes (em actionProcessor.js)
if (_isOnCooldown(playerId, "basicAttack")) return;
_setCooldown(playerId, "basicAttack", 1000);

// Depois
if (cooldownManager.isOnCooldown(playerId, "basicAttack")) return;
cooldownManager.setCooldown(playerId, "basicAttack", 1000);
```

---

## 3. ✅ Logger com Níveis

**Arquivo:** `src/core/logger.js`

**Descrição:** Sistema de logs com níveis e prefixos automáticos.

**Níveis:**
- `error` (0) — Sempre mostra
- `warn` (1) — Avisos
- `info` (2) — Informações (padrão)
- `debug` (3) — Debug
- `trace` (4) — Detalhado

**Benefícios:**
- ✅ Controle granular do que mostrar
- ✅ Prefixo automático: `[RPG][INFO]`
- ✅ Ativa debug no browser: `window.RPG_DEBUG = true`
- ✅ Substitui `console.log` poluído

**Uso:**
```javascript
import { logger } from "../core/logger.js";

logger.error("Erro crítico");  // [RPG][ERROR] Erro crítico
logger.warn("Aviso");           // [RPG][WARN] Aviso
logger.info("Info");            // [RPG][INFO] Info
logger.debug("Debug");          // Só mostra se nível >= debug
logger.trace("Trace");          // Só mostra se nível >= trace

// Com contexto
logger.log("Combat", "debug", "Dano:", damage);
// [RPG][Combat][DEBUG] Dano: 50

// Grupos
logger.group("Startup", () => {
  logger.info("Iniciando...");
  logger.info("Concluído!");
});

// Performance
logger.time("loadMap");
// ... código ...
logger.timeEnd("loadMap");  // [RPG][TIME] loadMap: 234.56ms
```

**Debug no Browser:**
```javascript
// No console do browser:
window.RPGLogger.setLevel('debug');  // Ativa debug
window.RPGLogger.setLevel('warn');   // Só mostra warnings e erros
```

---

## 4. ✅ Cleanup de Watchers Firebase

**Arquivo:** `src/core/worldStore.js`

**Descrição:** Função `destroyWorldStore()` para cancelar listeners e evitar memory leak.

**Benefícios:**
- ✅ Cancela 6 watchers Firebase
- ✅ Limpa estado global
- ✅ Previne memory leak em hot-reload
- ✅ Permite reinicialização segura

**Uso:**
```javascript
import { initWorldStore, destroyWorldStore } from "../core/worldStore.js";

// Inicializa
initWorldStore();

// ... usa ...

// Limpa (ex: trocar de tela, hot-reload)
destroyWorldStore();

// Pode reinicializar depois
initWorldStore();
```

**O que é limpo:**
- ✅ Watchers de monsters
- ✅ Watchers de players
- ✅ Watchers de effects
- ✅ Watchers de fields
- ✅ Watchers de chat
- ✅ Watchers de monsterTemplates
- ✅ Estado interno (state, maps, etc)

---

## 📊 Comparação: Antes vs Depois

### Cooldowns

| Antes | Depois |
|-------|--------|
| Espalhados em `_isOnCooldown`, `_setCooldown` | Centralizados em `CooldownManager` |
| Sem limpeza automática | Limpeza no tick (anti-memory-leak) |
| Apenas individuais | Individuais + globais |
| Sem API de tempo restante | `getRemainingCooldown()`, `getElapsedCooldown()` |

### Logs

| Antes | Depois |
|-------|--------|
| 154 `console.log` ativos | `logger.info()`, `logger.debug()` |
| Sem prefixo | Prefixo automático: `[RPG][INFO]` |
| Sem controle de nível | 5 níveis: error, warn, info, debug, trace |
| Polui em produção | Controle via `logger.setLevel()` |

### Watchers

| Antes | Depois |
|-------|--------|
| Sem cleanup | `destroyWorldStore()` cancela tudo |
| Memory leak em hot-reload | Limpeza completa |
| Não podia reinicializar | `init()` → `destroy()` → `init()` seguro |

---

## 🎯 Como Migrar

### 1. Cooldowns

**Em `actionProcessor.js`:**

```javascript
// Importar
import { cooldownManager } from "../core/CooldownManager.js";

// Substituir
if (_isOnCooldown(playerId, "basicAttack")) return;
_setCooldown(playerId, "basicAttack", 1000);

// Por
if (cooldownManager.isOnCooldown(playerId, "basicAttack")) return;
cooldownManager.setCooldown(playerId, "basicAttack", 1000);
```

**No `worldTick.js`:**

```javascript
// Adicionar no _tick()
cooldownManager.tick(now);
```

### 2. Logs

**Em todo o código:**

```javascript
// Importar
import { logger } from "../core/logger.js";

// Substituir
console.log("Movimento:", x, y);
// Por
logger.debug("Movimento:", x, y);

// Ou
logger.log("Movement", "info", `Player moveu para ${x},${y}`);
```

**Remover logs de produção:**

```javascript
// Em loops de movimento
// Antes:
console.log("Moving:", x, y);  // ❌ Polui

// Depois:
logger.trace("Moving:", x, y);  // ✅ Só mostra em debug
```

### 3. Watchers

**Em `rpg.html`, `admin.html`, `worldEngine.html`:**

```javascript
// No cleanup (ex: antes de trocar de tela)
import { destroyWorldStore } from "../core/worldStore.js";

// Cancela watchers
destroyWorldStore();

// Pode reinicializar depois
initWorldStore();
```

---

## 📁 Arquivos Criados

| Arquivo | Descrição |
|---------|-----------|
| `src/core/actionSchema.js` | Schema validation de ações |
| `src/core/CooldownManager.js` | Gerenciador de cooldowns |
| `src/core/logger.js` | Logger com níveis |
| `ACTION_SCHEMA.md` | Documentação de Action Schema |
| `ARQUITETURA_MELHORIAS.md` | Este documento |

---

## 🧪 Testes

### CooldownManager

```javascript
import { cooldownManager } from "../core/CooldownManager.js";

// Testar
const now = Date.now();

// Definir cooldown
cooldownManager.setCooldown("player1", "test", 1000, now);

// Verificar (deve estar em cooldown)
console.assert(cooldownManager.isOnCooldown("player1", "test", now));

// Verificar depois de expirar (não deve estar em cooldown)
console.assert(!cooldownManager.isOnCooldown("player1", "test", now + 1000));

// Limpar
cooldownManager.tick(now + 1000);
console.assert(cooldownManager.getStats().individual === 0);
```

### Logger

```javascript
import { logger, LEVELS } from "../core/logger.js";

// Testar níveis
logger.setLevel('debug');
logger.debug("Deve mostrar");
logger.trace("Não deve mostrar");

logger.setLevel('trace');
logger.trace("Agora mostra");

// Testar contexto
logger.log("Test", "info", "Mensagem com contexto");
// [RPG][Test][INFO] Mensagem com contexto
```

### Watchers

```javascript
import { initWorldStore, destroyWorldStore } from "../core/worldStore.js";

// Testar
initWorldStore();
console.log("Watchers ativos");

destroyWorldStore();
console.log("Watchers cancelados");

initWorldStore();
console.log("Watchers reinicializados");
```

---

## 📊 Performance

### Antes

- 154 `console.log` em loops → **Lento em produção**
- Cooldowns sem limpeza → **Memory leak gradual**
- Watchers sem cleanup → **Memory leak em hot-reload**

### Depois

- Logger com níveis → **Só mostra o necessário**
- CooldownManager.tick() → **Limpeza automática**
- destroyWorldStore() → **Cleanup completo**

**Ganho estimado:**
- Logs em produção: **-90%** (só error/warn)
- Memory leak cooldowns: **0** (limpeza no tick)
- Memory leak watchers: **0** (cleanup explícito)

---

## 🚀 Próximas Melhorias

1. **Pathfinding Otimizado**
   - A* com cache de caminho
   - Reutilizar cálculos para NPCs

2. **Cache de Spells**
   - `getSpell()` com cache
   - Evitar recriar objetos

3. **Pool de Objetos**
   - Reutilizar objetos de efeito
   - Evitar GC frequente

4. **Web Workers**
   - Pathfinding em worker separado
   - Não bloquear render

---

**Status:** ✅ Melhorias implementadas  
**Última atualização:** 2026-03-29
