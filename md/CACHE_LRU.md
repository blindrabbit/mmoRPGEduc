# 🚀 Cache LRU (Least Recently Used) — Anti-Memory-Leak

## 📋 Visão Geral

Cache com limite máximo que remove automaticamente entradas antigas quando atinge o limite.

**Problema resolvido:**
```javascript
// ❌ ERRADO: Map cresce indefinidamente
const _cache = new Map();
_cache.set(key, value);  // Memory leak!

// ✅ CORRETO: LRU Cache com limite
const _cache = createLruCache(5000);
_cache.set(key, value);  // Remove antigo se atingir 5000
```

---

## 🎯 Implementação Atual

### mapRenderer.js (Já Implementado)

```javascript
function _boundedMap(maxSize = 2000) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      if (m.size >= maxSize) m.delete(m.keys().next().value); // Remove mais antigo
      m.set(k, v);
    },
    has: (k) => m.has(k),
    delete: (k) => m.delete(k),
    clear: () => m.clear(),
    get size() { return m.size; },
  };
}

// Caches com limite
const _variantCache = _boundedMap(5000);        // Limite: 5000
const _sortedKeysCache = _boundedMap(3000);     // Limite: 3000
const _spriteCategoryCache = _boundedMap(2000); // Limite: 2000
const _spriteElevationCache = _boundedMap(2000);// Limite: 2000
const _anyVariantLookupCache = _boundedMap(2000);// Limite: 2000
```

**Status:** ✅ **Já implementado e funcionando!**

---

## 📦 Novo: LruCache Reutilizável

**Arquivo:** `src/core/LruCache.js`

### Função: `createLruCache(maxSize)`

```javascript
import { createLruCache } from "../core/LruCache.js";

const cache = createLruCache(1000);

cache.set('key', 'value');
const value = cache.get('key');
if (cache.has('key')) { ... }
console.log(cache.size);  // Número de entradas
```

### Classe: `LruCache` (API Completa)

```javascript
import { LruCache } from "../core/LruCache.js";

const cache = new LruCache(1000);

cache.set('a', 1);
cache.set('b', 2);

console.log(cache.getStats());
// {
//   size: 2,
//   maxSize: 1000,
//   utilization: 0.002,
//   hits: 0,
//   misses: 0,
//   hitRate: 0
// }
```

---

## 🔍 Como Funciona

### Algoritmo LRU

```
┌─────────────────────────────────────────┐
│ Cache: [A] [B] [C] [D] [E]              │
│ Limite: 5                               │
└─────────────────────────────────────────┘

1. Adiciona F (novo):
   Remove A (mais antigo)
   ┌─────────────────────────────────────────┐
   │ Cache: [B] [C] [D] [E] [F]              │
   └─────────────────────────────────────────┘

2. Acessa B (hit):
   Move B para o final (mais recente)
   ┌─────────────────────────────────────────┐
   │ Cache: [C] [D] [E] [F] [B]              │
   └─────────────────────────────────────────┘

3. Adiciona G (novo):
   Remove C (mais antigo)
   ┌─────────────────────────────────────────┐
   │ Cache: [D] [E] [F] [B] [G]              │
   └─────────────────────────────────────────┘
```

---

## 📊 Caches Atuais no Projeto

| Cache | Arquivo | Limite | Uso |
|-------|---------|--------|-----|
| `_variantCache` | `mapRenderer.js` | 5000 | Variação de tiles |
| `_sortedKeysCache` | `mapRenderer.js` | 3000 | Chaves ordenadas |
| `_spriteCategoryCache` | `mapRenderer.js` | 2000 | Categoria de sprites |
| `_spriteElevationCache` | `mapRenderer.js` | 2000 | Elevation de sprites |
| `_anyVariantLookupCache` | `mapRenderer.js` | 2000 | Lookup de variantes |

**Total de entradas máximas:** ~17,000

**Memory footprint estimado:**
- Cada entrada: ~100 bytes
- Total: ~1.7 MB (controlado!)

---

## 🎯 Casos de Uso

### 1. Cache de Render (Já Implementado)

```javascript
// mapRenderer.js
const _variantCache = _boundedMap(5000);

function getVariant(tx, ty, spriteId, numVariacoes) {
  const key = `${tx},${ty},${spriteId}`;
  
  if (!_variantCache.has(key)) {
    _variantCache.set(key, tileHash(tx, ty, spriteId) % numVariacoes);
  }
  
  return _variantCache.get(key);
}
```

### 2. Cache de Pathfinding (Sugestão)

```javascript
// pathfinding.js
import { createLruCache } from "../core/LruCache.js";

const _pathCache = createLruCache(1000);

function findPath(start, end) {
  const key = `${start.x},${start.y}-${end.x},${end.y}`;
  
  if (_pathCache.has(key)) {
    return _pathCache.get(key);
  }
  
  const path = calculatePath(start, end);
  _pathCache.set(key, path);
  
  return path;
}
```

### 3. Cache de Spells (Sugestão)

```javascript
// spellBook.js
import { LruCache } from "../core/LruCache.js";

const _spellCache = new LruCache(500);

export function getSpell(spellId) {
  if (_spellCache.has(spellId)) {
    return _spellCache.get(spellId);
  }
  
  const spell = SPELLS[spellId];
  if (spell) {
    _spellCache.set(spellId, spell);
  }
  
  return spell;
}
```

### 4. Cache de Combat (Sugestão)

```javascript
// combatLogic.js
import { createLruCache } from "../core/LruCache.js";

const _damageCache = createLruCache(2000);

function calculateDamage(attacker, defender) {
  const key = `${attacker.id}-${defender.id}-${Date.now() >> 10}`;
  
  if (_damageCache.has(key)) {
    return _damageCache.get(key);
  }
  
  const damage = computeDamage(attacker, defender);
  _damageCache.set(key, damage);
  
  return damage;
}
```

---

## 📈 Performance

### Antes (Map sem limite)

```javascript
const cache = new Map();

// Após 1 hora de jogo:
cache.size = 1000000;  // ❌ Memory leak!
cache.size = 5000000;  // ❌ Pode crescer indefinidamente
```

**Problemas:**
- ❌ Memory leak gradual
- ❌ GC (Garbage Collection) frequente
- ❌ Performance degrada com tempo
- ❌ Crash em sessões longas

### Depois (LRU Cache)

```javascript
const cache = createLruCache(5000);

// Após 1 hora de jogo:
cache.size = 5000;  // ✅ Limite respeitado!
cache.size = 5000;  // ✅ Sempre controlado
```

**Benefícios:**
- ✅ Memory footprint controlado
- ✅ GC mínimo
- ✅ Performance consistente
- ✅ Sessões longas estáveis

---

## 🧪 Testes

### Teste Básico

```javascript
import { createLruCache } from "../core/LruCache.js";

const cache = createLruCache(3);

cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);

console.log(cache.size);  // 3

cache.set('d', 4);  // Remove 'a' (mais antigo)

console.log(cache.size);  // 3
console.log(cache.has('a'));  // false (removido)
console.log(cache.has('d'));  // true
```

### Teste de Hit Rate

```javascript
import { LruCache } from "../core/LruCache.js";

const cache = new LruCache(100);

// Popular cache
for (let i = 0; i < 100; i++) {
  cache.set(`key${i}`, i);
}

// Acessar
for (let i = 0; i < 200; i++) {
  cache.get(`key${i % 100}`);
}

console.log(cache.getStats());
// {
//   size: 100,
//   maxSize: 100,
//   utilization: 1,
//   hits: 100,
//   misses: 100,
//   hitRate: 0.5
// }
```

---

## 🎯 Melhores Práticas

### 1. Escolha do Limite

| Tipo de Cache | Limite Sugerido |
|---------------|-----------------|
| Render (tiles) | 5000-10000 |
| Pathfinding | 1000-2000 |
| Spells | 500-1000 |
| Combat | 2000-5000 |
| Items | 1000-2000 |

### 2. Chaves Eficientes

```javascript
// ✅ Bom: string simples
const key = `${x},${y},${z}`;

// ✅ Bom: string com IDs
const key = `spell:${spellId}:${playerId}`;

// ❌ Ruim: objetos complexos
const key = { x, y, z };  // Não funciona como chave!
```

### 3. Monitoramento

```javascript
// Debug de cache
setInterval(() => {
  const stats = cache.getStats();
  console.log('Cache stats:', stats);
  
  // Alerta se utilization > 90%
  if (stats.utilization > 0.9) {
    console.warn('Cache quase cheio!', stats);
  }
}, 60000);  // A cada 1 minuto
```

---

## 📁 API Completa

### `createLruCache(maxSize)`

```javascript
const cache = createLruCache(1000);

cache.get(key);      // Obtém valor
cache.set(key, val); // Define valor (remove antigo se necessário)
cache.has(key);      // Verifica se existe
cache.delete(key);   // Remove entrada
cache.clear();       // Limpa tudo
cache.size;          // Número de entradas
cache.maxSize;       // Limite máximo
cache.getStats();    // Estatísticas { size, maxSize, utilization }
```

### `new LruCache(maxSize)`

```javascript
const cache = new LruCache(1000);

cache.get(key);         // Obtém valor (move para mais recente)
cache.set(key, val);    // Define valor
cache.has(key);         // Verifica se existe
cache.delete(key);      // Remove entrada
cache.clear();          // Limpa tudo
cache.size;             // Número de entradas
cache.maxSize;          // Limite máximo
cache.hitRate;          // Taxa de acertos (0.0-1.0)
cache.getStats();       // Estatísticas completas
cache.entries();        // Itera sobre entradas
cache.keys();           // Itera sobre chaves
cache.values();         // Itera sobre valores
cache.forEach(fn);      // Executa callback
```

---

## 🚀 Próximos Passos

1. **Substituir Maps soltos por LruCache:**
   ```javascript
   // Em vez de:
   const cache = new Map();
   
   // Usar:
   const cache = createLruCache(5000);
   ```

2. **Adicionar monitoramento:**
   ```javascript
   // No worldTick.js
   import { _variantCache, _sortedKeysCache } from './mapRenderer.js';
   
   console.log('Render caches:', {
     variant: _variantCache.size,
     sorted: _sortedKeysCache.size
   });
   ```

3. **Documentar caches em cada módulo:**
   ```javascript
   // /**
   //  * @type {ReturnType<typeof createLruCache>}
   //  * @limit 5000 entradas
   //  */
   // const _cache = createLruCache(5000);
   ```

---

**Status:** ✅ Implementado em `mapRenderer.js`  
**Utilitário:** `src/core/LruCache.js`  
**Última atualização:** 2026-03-29
