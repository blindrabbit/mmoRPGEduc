# Atualização do Motor de Renderização — Nexo Map Engine

## Contexto

O pipeline de assets do jogo foi atualizado. Cada item do mapa agora carrega um bloco
`game` com propriedades semânticas pré-computadas, além do bloco `flags_raw` original.
O motor de renderização e o sistema de colisão precisam ser adaptados para consumir
esses dados.

---

## Estrutura do JSON de item (nexo_data.json / appearances_mapa.json)

Cada entrada de item agora tem o seguinte formato:

```json
{
  "id": 1234,
  "name": "oak tree",
  "pattern": { "width": 2, "height": 2, "depth": 1, "layers": 1 },
  "grid_size": 32,
  "is_animated": false,
  "animation": null,
  "variants": {
    "0": { "x": 128, "y": 0, "w": 32, "h": 32 },
    "1": { "x": 160, "y": 0, "w": 32, "h": 32 }
  },
  "flags_raw": { "unpassable": true, "top": true },
  "game": {
    "category_type":   "obstacle",
    "render_layer":    3,
    "is_walkable":     false,
    "blocks_missiles": false,
    "blocks_sight":    false,
    "is_movable":      false,
    "is_pickupable":   false,
    "is_container":    false,
    "is_stackable":    false,
    "emits_light":     false,
    "light_intensity": null,
    "light_color":     null,
    "movement_cost":   0,
    "is_liquid_pool":  false,
    "is_liquid_cont":  false,
    "is_writable":     false,
    "is_usable":       false,
    "has_height":      false,
    "height_elevation": null,
    "hang_direction":  null
  }
}
```

O mapa compacto (`mapa_compacto.json`) é um objeto onde cada chave é `"x,y,z"` e o
valor é um array de IDs: `[ground_id, item_id_1, item_id_2, ...]`.
O índice 0 é sempre o chão (ground). Os demais são itens empilhados no tile.

---

## Propriedade: `category_type`

Use como discriminador principal para decidir comportamento de cada item.

| Valor               | Descrição                                           | Comportamento esperado |
|---------------------|-----------------------------------------------------|------------------------|
| `ground`            | Tile de chão navegável                              | Sempre render_layer=0; aceita pathfinding |
| `floor_decoration`  | Decoração no chão (tapetes, manchas, etc.)          | render_layer=1; não bloqueia |
| `obstacle`          | Árvore, pedra, objeto fixo                          | Bloqueia movimento; **magias passam** |
| `wall`              | Parede sólida                                       | Bloqueia movimento **e** projéteis |
| `blocking_item`     | Item coletável que bloqueia temporariamente         | Bloqueia movimento; pode ser removido |
| `top_decoration`    | Copa de árvore, telhado                             | render_layer=3; renderiza **sobre** o player |
| `decoration`        | Objeto decorativo passável                          | Não bloqueia nada |
| `container`         | Baú, bag, etc.                                      | Abrível; pode ter inventário |
| `item`              | Item coletável no chão                              | Interagível; coletável |
| `usable_object`     | Objeto com interação (alavanca, altar, etc.)        | Dispara evento de uso |
| `writable_object`   | Livro, placa, pergaminho                            | Abre UI de leitura/escrita |
| `light_source`      | Tocha, lâmpada                                      | Aplica halo de luz ao redor |
| `corpse`            | Cadáver de criatura ou player                       | Abrível (loot); decai com tempo |
| `liquid_pool`       | Poça de líquido no chão                             | Efeito visual; pode causar dano/status |

---

## Propriedade: `render_layer`

Define a ordem de desenho **dentro de um mesmo tile**. Renderize os itens do tile
em ordem crescente de `render_layer`:

```
0 → ground         (chão — sempre primeiro)
1 → floor_decoration
2 → objetos normais, criaturas, player
3 → top_decoration (copa de árvore, telhado — sempre por cima do player)
```

**Regra crítica para `render_layer = 3`:** esses sprites devem ser desenhados numa
passagem separada, **após** desenhar todas as criaturas e o player do tile.
Isso garante que a copa da árvore cubra o personagem quando ele passa por baixo.

---

## Propriedade: `movement_cost`

- `0` → não é tile de chão; ignorar para pathfinding.
- `> 0` → custo de movimento para o pathfinder (A* ou similar).
  Valores maiores = tiles mais lentos (lama, neve, etc.).
  Valor típico de grama/pedra: 100–200.

Usar junto com `is_walkable`:
```js
function canWalk(item) {
  return item.game.is_walkable;
}
function pathCost(item) {
  return item.game.movement_cost > 0 ? item.game.movement_cost : Infinity;
}
```

---

## Propriedades de colisão

```
is_walkable      → false = player/monstro não pode entrar no tile
blocks_missiles  → true  = projéteis e magias são bloqueados
blocks_sight     → true  = linha de visão bloqueada (targeting de spells)
```

**Importante:** neste dataset, `blocks_missiles` é `true` em apenas ~49 itens.
A grande maioria dos obstáculos (`obstacle`, árvores, pedras) tem `blocks_missiles: false`,
ou seja, magias e projéteis passam por cima deles — comportamento correto.

Lógica de verificação de colisão por tipo de interação:

```js
// Movimento de personagem/monstro
function tileBlocksMovement(tileItems) {
  return tileItems.some(item => !item.game.is_walkable);
}

// Projétil (flecha, magia direta)
function tileBlocksProjectile(tileItems) {
  return tileItems.some(item => item.game.blocks_missiles);
}

// Linha de visão para targeting (AoE, spells que precisam de LOS)
function tileBlocksSight(tileItems) {
  return tileItems.some(item => item.game.blocks_sight);
}
```

---

## Iluminação dinâmica

Se `emits_light: true`:
- `light_intensity` → raio/intensidade do halo (valor raw do .dat)
- `light_color` → cor em formato numérico do cliente Tibia

```js
if (item.game.emits_light) {
  renderLightHalo(item, item.game.light_intensity, item.game.light_color);
}
```

---

## Sprites com variações (`variants`)

Itens com `pattern.depth > 1` ou múltiplos sprites têm múltiplas chaves em `variants`.
A seleção de variante depende da posição no tile (padrão X/Y do mapa):

```js
// Seleção de variante por posição do tile (para items com pattern width/height > 1)
function getVariantKey(item, tileX, tileY) {
  const pw = item.pattern.width;
  const ph = item.pattern.height;
  const vx = tileX % pw;
  const vy = tileY % ph;
  return String(vx + vy * pw);
}

const variant = item.variants[getVariantKey(item, tile.x, tile.y)] ?? item.variants["0"];
// variant = { x, y, w, h } — coordenadas no atlas (nexo_atlas.png)
```

---

## Animação

Se `is_animated: true`, o campo `animation` contém:

```json
{
  "loop_type": 0,
  "synchronized": false,
  "phases": [
    { "d": 150 },
    { "d": 200 }
  ]
}
```

- `loop_type`: `-1` = ping-pong, `0` = infinito, `1` = contado (usar `loop_count`)
- `phases[i].d` = duração em ms do frame `i`
- A variante animada usa as keys `"0"`, `"1"`, `"2"`, ... em `variants`
- Se `synchronized: true`, todos os itens do mesmo tipo no mapa devem estar no
  mesmo frame (usar timer global, não por instância)

---

## Resumo das mudanças no motor

1. **Carregar `game.*` em vez de ler `flags_raw` diretamente** — as propriedades já
   estão pré-computadas e normalizadas.

2. **Ordem de renderização por tile:**
   - Passo 1: desenhar itens com `render_layer` 0, 1, 2 (chão → decoração → objetos)
   - Passo 2: desenhar criaturas e player
   - Passo 3: desenhar itens com `render_layer = 3` (top_decoration)

3. **Sistema de colisão:** usar `is_walkable`, `blocks_missiles`, `blocks_sight`
   separadamente conforme o tipo de interação.

4. **Pathfinding:** usar `movement_cost` como peso da aresta; ignorar tiles com
   `movement_cost = 0` ou `is_walkable = false`.

5. **`category_type`** como switch principal para lógica de interação (clique,
   coleta, uso, abertura de container, etc.).
