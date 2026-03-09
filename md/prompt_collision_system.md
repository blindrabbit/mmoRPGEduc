# Prompt — Motor de Colisão e Projéteis (Nexo Map Engine)

Preciso que você atualize o motor de jogo para implementar corretamente dois sistemas:
**colisão de movimento** (player e monstros) e **colisão de projéteis/magias** (arqueiros e casters).

Os dados de cada tile vêm do arquivo `nexo_data.json`. Cada item tem um campo `game`
com as propriedades pré-computadas, e o mapa compacto (`mapa_compacto.json`) representa
cada posição como `"x,y,z": [ground_id, item_id_1, item_id_2, ...]`.

---

## SISTEMA 1 — Colisão de Movimento

### Quais flags impedem movimento

A única propriedade que importa é:

```js
item.game.is_walkable === false
```

Se **qualquer item** na pilha do tile tiver `is_walkable: false`, o tile inteiro bloqueia
movimento de players e monstros. Não existe exceção.

**Origem desta flag no pipeline:**
`is_walkable = NOT (flags_raw.unpassable === true)`

### Casos concretos no mapa

| Situação | `is_walkable` | O que fazer |
|---|---|---|
| Parede, pedra, árvore, caixa | `false` | Bloquear movimento completamente |
| Tile de chão normal (grama, pedra) | `true` | Permitir movimento |
| **Água / lava** | `true` | ⚠️ Ver regra de custo abaixo |
| Decoração no chão (tapete, flor) | `true` | Permitir movimento |
| Item coletável no chão | `true` | Permitir movimento |

### Água e terrenos de alto custo (caso especial)

Água e lava são tiles de **chão (`bank` presente) mas com custo altíssimo**. Eles NÃO
têm `unpassable`, portanto `is_walkable` aparece como `true`. O bloqueio é feito pelo
custo de pathfinding, não por colisão direta.

Use `movement_cost` para isso:

```js
// Threshold: criaturas normais não entram em tiles com custo >= 500
// (água profunda, lava, abismo)
const IMPASSABLE_COST_THRESHOLD = 500;

function canEntityEnterTile(tileItems, entity) {
  // 1. Verificar colisão física direta
  const physicallyBlocked = tileItems.some(item => !item.game.is_walkable);
  if (physicallyBlocked) return false;

  // 2. Verificar custo de terreno (água, lama, lava)
  const groundItem = tileItems[0]; // índice 0 = sempre o ground
  if (groundItem && groundItem.game.movement_cost >= IMPASSABLE_COST_THRESHOLD) {
    // Apenas entidades com capacidade especial podem entrar (ex: summon aquático)
    return entity.canWalkOnHighCostTerrain ?? false;
  }

  return true;
}
```

**Distribuição real de `movement_cost` no dataset:**
- `0` → não é chão (objeto de mapa)
- `1` → tiles especiais de chão (120 tiles) — tratar como impassable para IA
- `50–200` → chão normal com custo variado (grama=100, terreno difícil=150–200)
- `500–1200` → água profunda, lava, abismo — impassable para criaturas normais

### Função de verificação de movimento

```js
function tileBlocksMovement(tileItems) {
  return tileItems.some(item => !item.game.is_walkable);
}

function getTileMovementCost(tileItems) {
  // O custo do terreno vem do item ground (índice 0 da pilha do tile)
  const ground = tileItems[0];
  if (!ground) return Infinity;
  const cost = ground.game.movement_cost;
  if (cost === 0) return Infinity; // não é ground tile
  return cost;
}
```

---

## SISTEMA 2 — Colisão de Projéteis e Magias (Arqueiros)

### Quais flags bloqueiam projéteis

```js
item.game.blocks_missiles === true
```

**Origem:** `blocks_missiles = (flags_raw.block_missile === true)`

### ATENÇÃO — comportamento real dos dados

No dataset deste jogo, `block_missile` é **raro** (~49 itens no total). Isso significa:

- **Paredes, árvores, pedras, caixas** → `block_missile: false` por padrão
- **Projéteis passam sobre a maioria dos obstáculos** por design
- Apenas ~24 itens específicos (garrafas, vasos, recipientes) e ~25 objetos interativos
  têm `block_missile: true`

Isso é intencional: no estilo de jogo inspirado em Tibia, flechas e magias passam por
cima de árvores e obstáculos baixos.

### Linha de visão (para targeting)

```js
item.game.blocks_sight === true
// blocks_sight = (unpassable AND block_missile)
```

`blocks_sight` é ainda mais restrito — apenas quando o objeto bloqueia tanto o
movimento quanto os projéteis. Use para determinar se o arqueiro "enxerga" o alvo.

### Os 3 checks separados

```js
// Pode o player/monstro entrar no tile?
function tileBlocksMovement(tileItems) {
  return tileItems.some(item => !item.game.is_walkable);
}

// A flecha/projétil atravessa este tile?
function tileBlocksProjectile(tileItems) {
  return tileItems.some(item => item.game.blocks_missiles);
}

// O arqueiro consegue enxergar (linha de visão) para este tile?
function tileBlocksSight(tileItems) {
  return tileItems.some(item => item.game.blocks_sight);
}
```

### Algoritmo de linha de visão para arqueiros

Para verificar se o arqueiro em `(ax, ay)` pode atacar o alvo em `(bx, by)`:

```js
function hasLineOfSight(ax, ay, bx, by, z, getItemsAtTile) {
  // Traçar linha de Bresenham entre os dois pontos
  const points = bresenhamLine(ax, ay, bx, by);

  // Ignorar o tile de origem e o tile do alvo na verificação
  for (let i = 1; i < points.length - 1; i++) {
    const { x, y } = points[i];
    const tileItems = getItemsAtTile(x, y, z);

    if (tileBlocksSight(tileItems)) {
      return false; // linha de visão bloqueada
    }
  }
  return true;
}

// Para projétil (flecha voando) — verificação mais restrita
function projectileCanReach(ax, ay, bx, by, z, getItemsAtTile) {
  const points = bresenhamLine(ax, ay, bx, by);

  for (let i = 1; i < points.length - 1; i++) {
    const { x, y } = points[i];
    const tileItems = getItemsAtTile(x, y, z);

    if (tileBlocksProjectile(tileItems)) {
      return false; // projétil bloqueado
    }
  }
  return true;
}
```

---

## Estrutura de dados do tile no runtime

O mapa compacto (`mapa_compacto.json`) tem o formato:
```json
{ "128,130,7": [4526, 1234, 5678] }
```

- Índice `[0]` → sempre o `ground_id` (tile de chão)
- Índices `[1..n]` → itens empilhados no tile

Para montar os itens resolvidos em runtime:

```js
function getItemsAtTile(x, y, z) {
  const key = `${x},${y},${z}`;
  const stack = compactMap[key];
  if (!stack) return [];
  return stack.map(id => nexoData[String(id)]).filter(Boolean);
}
```

---

## Resumo rápido — o que verificar por situação

| Situação no jogo | Check |
|---|---|
| Player tenta mover para tile | `tileBlocksMovement(items)` |
| Monstro fazendo pathfinding | `tileBlocksMovement(items)` + `getTileMovementCost(items)` |
| Flecha do arqueiro voando | `tileBlocksProjectile(items)` em cada tile intermediário |
| Mago mirando spell no alvo | `hasLineOfSight(...)` com `tileBlocksSight(items)` |
| Entidade entrando em água | `movement_cost >= 500` no ground item |
