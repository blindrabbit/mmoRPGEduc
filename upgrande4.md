# Instruções Claude Code — Correções de Renderização (completo)

## Bugs confirmados nas 3 imagens + visibilidade entre andares

> Arquivos envolvidos:
> src/render/mapRenderer.js — classificação e ordem de draw
> src/render/worldRenderer.js — pipeline, y-sort, isOccluder
> src/core/floorVisibility.js — regras de visibilidade entre andares
>
> Execute um bloco por vez. Teste visualmente após cada um antes de continuar.

---

## CONTEXTO (cole antes de começar)

```
Projeto mmoRPGEduc — clone do Tibia em JS + Firebase.
Referência: OTClient tile.cpp e mapview.cpp (analisados na sessão).

Bugs confirmados por screenshots:
  Imagem 1: player por baixo da escada
  Imagem 2: POT renderizado inconsistentemente em relação à bancada
  Imagem 3: bancada cobre POT e parte do player ao mover para cima
  + Bug geral: criaturas visíveis em andares que não deveriam ser visíveis

Todos os bugs têm a mesma raiz: obstáculos (obstacles) sendo tratados
como "occluders" (vegetação) quando deveriam ser "bottom items" (mobiliário).
```

---

# BLOCO R1 — classifyItemOT: fallback por render_layer

```
ARQUIVO: src/render/mapRenderer.js

PROBLEMA: 224 items têm game.render_layer definido (0, 1, 2 ou 3) mas sem
flags booleanas (bank/bottom/top). Esses items caem no "return common" por
default. Exemplos: id=1638, id=1640 (obstacle gs=64, render_layer=2).

O campo render_layer do appearances_map segue a convenção OTClient:
  render_layer=0 → ground  (equivale a bank=True)
  render_layer=1 → bottom  (equivale a bottom=True, OnBottom)
  render_layer=2 → bottom  (também OnBottom no OTClient)
  render_layer=3 → top     (equivale a top=True, OnTop)

LOCALIZAR a função classifyItemOT (linha ~258). O trecho final é:

  // ThingFlagAttrOnTop — top ou topeffect flag
  if (top || topeffect) return "top";

  // Default: common item
  return "common";

SUBSTITUIR o "// Default: common item" por:

  // Fallback: render_layer quando flags booleanas não definem a categoria.
  // render_layer no appearances_map segue convenção OTClient:
  // 0=ground, 1=OnBottom, 2=OnBottom (layer2), 3=OnTop
  const renderLayerFallback = game.render_layer ?? game.layer ?? null;
  if (Number.isFinite(renderLayerFallback)) {
    if (renderLayerFallback === 0) {
      return game.category_type === "wall" ? "bottom" : "ground";
    }
    if (renderLayerFallback === 1 || renderLayerFallback === 2) return "bottom";
    if (renderLayerFallback === 3) return "top";
  }

  // Fallback final: obstacle não-walkable sem flags = bottom (OTClient ThingFlagAttrOnBottom)
  // No OTClient, qualquer item com ThingFlagAttrNotWalkable e sem flag especial
  // tem stackPriority=ON_BOTTOM (2) — é desenhado ANTES das creatures.
  const unpass = game.unpass ?? raw.unpass;
  const notWalkable = game.is_walkable === false || unpass;
  if (notWalkable && !bank && !clip) {
    const cat = game.category_type ?? "";
    if (cat === "obstacle" || cat === "furniture" || cat === "floor_decoration") {
      return "bottom";
    }
  }

  // Default: common item
  return "common";
```

---

# BLOCO R2 — Sort de common items: ordem REVERSA (OTClient reverse_view)

```
ARQUIVO: src/render/mapRenderer.js

PROBLEMA: No OTClient (tile.cpp linha 89), common items são desenhados em
ordem REVERSA da pilha (reverse_view). O item de layer mais alta é desenhado
PRIMEIRO (fica no fundo visual), o de layer mais baixa fica por CIMA.

Nosso sort usa tileLayer ASC para todos — o inverso do correto para common.

LOCALIZAR o sort dentro de _renderMainPass (linha ~1346):

        sortable.sort((a, b) => {
          // 1. renderLayer: ground(0) → border(1) → items(2) → top(3)
          const ar = Number(a?.renderLayer ?? 2);
          const br = Number(b?.renderLayer ?? 2);
          if (ar !== br) return ar - br;
          // 2. stackPosition (dentro do mesmo renderLayer): bottom(3) < common(5) < top(10)
          const as = Number(a?.stackPosition ?? 5);
          const bs = Number(b?.stackPosition ?? 5);
          if (as !== bs) return as - bs;
          // 3. tileLayer: ordem de empilhamento dentro do tile
          const atl = Number(a?.tileLayer ?? -1);
          const btl = Number(b?.tileLayer ?? -1);
          if (atl !== btl) return atl - btl;
          return Number(a?.spriteId ?? 0) - Number(b?.spriteId ?? 0);
        });

SUBSTITUIR por:

        sortable.sort((a, b) => {
          // 1. renderLayer: ground(0) → border(1) → bottom/common(2) → top(3)
          const ar = Number(a?.renderLayer ?? 2);
          const br = Number(b?.renderLayer ?? 2);
          if (ar !== br) return ar - br;

          // 2. stackPosition: bottom(3) antes de common(5), common antes de top(10)
          const as = Number(a?.stackPosition ?? 5);
          const bs = Number(b?.stackPosition ?? 5);
          if (as !== bs) return as - bs;

          // 3. tileLayer:
          //   • Bottom items → CRESCENTE (ordem de inserção normal)
          //   • Common items → DECRESCENTE (OTClient: reverse_view(m_things))
          //     O item inserido mais tarde (layer alta) vai para o fundo visual;
          //     o mais antigo (layer baixa) fica por cima — cobre outros common.
          const atl = Number(a?.tileLayer ?? -1);
          const btl = Number(b?.tileLayer ?? -1);
          if (atl !== btl) {
            const aIsCommon = a?.category === "common";
            const bIsCommon = b?.category === "common";
            if (aIsCommon && bIsCommon) return btl - atl; // DESC para common (OTClient reverse)
            return atl - btl;                              // ASC para bottom
          }

          return Number(a?.spriteId ?? 0) - Number(b?.spriteId ?? 0);
        });
```

---

# BLOCO R3 — isOccluder: remover "obstacle" dos occluders visuais

```
ARQUIVO: src/render/worldRenderer.js

PROBLEMA CENTRAL (causa dos bugs nas 3 imagens):
A lista _vegetationCategories inclui "obstacle". Isso faz bancadas, escadas
e qualquer furniture com category_type="obstacle" serem redesenhadas APÓS o
player pelo y-sort — cobrindo o player e o POT quando o player está ao sul.

No OTClient:
  • "obstacle" sem clip → bottom item → desenhado ANTES da creature → NUNCA occluder
  • "obstacle" com clip → groundBorder → desenhado no ground pass → NUNCA occluder
  • Só items com top=True (ThingFlagAttrOnTop) são redesenhados após creatures

Dados do mapa:
  • 51 obstacles SEM clip = furniture/bancadas = devem ser bottom
  • 15 obstacles COM clip = arbustos/pedras = são groundBorder
  • Nenhum dos dois grupos deve ser occluder

LOCALIZAR em worldRenderer.js (linha ~571):

  const _vegetationCategories = new Set([
    "tree",
    "vegetation",
    "flora",
    "foliage",
    "obstacle",
  ]);
  const isOccluder = (spriteMeta) => {
    const category = String(
      spriteMeta?.game?.category_type ?? "",
    ).toLowerCase();
    // Paredes e edifícios nunca cobrem criaturas (são bottom items)
    if (_wallCategories.has(category)) return false;
    // Vegetação/árvores/obstáculos sempre são occluders (são top items)
    if (_vegetationCategories.has(category)) return true;
    // Sprites altos (maiores que 1 tile) são occluders por default
    return (spriteMeta?.grid_size ?? TILE_SIZE) > TILE_SIZE;
  };

SUBSTITUIR por:

  // Categorias que são genuinamente top items (redesenhados APÓS o player)
  // Apenas vegetação real (copas de árvore) e top_decoration.
  // "obstacle" foi REMOVIDO: obstacles são bottom items no OTClient,
  // nunca occluders. Bancadas, escadas e furniture não cobrem o player.
  const _vegetationCategories = new Set([
    "tree",
    "vegetation",
    "flora",
    "foliage",
    "top_decoration",
  ]);
  const isOccluder = (spriteMeta) => {
    const game = spriteMeta?.game ?? {};
    const raw  = spriteMeta?.flags_raw ?? {};

    // Regra primária: ThingFlagAttrOnTop = único flag que faz um item cobrir creatures
    const hasTopFlag = game.top || raw.top || game.topeffect || raw.topeffect;
    if (hasTopFlag) return true;

    const category = String(game.category_type ?? "").toLowerCase();

    // Paredes, edifícios e obstacles são bottom items — NUNCA occluders
    if (_wallCategories.has(category)) return false;
    if (category === "obstacle" || category === "furniture") return false;

    // Vegetação visual (copas de árvore, top_decoration) → occluder
    if (_vegetationCategories.has(category)) return true;

    // Sprites visualmente altos (>1 tile) sem flags explícitas → occluder cauteloso
    // Aplica apenas para itens que não são floor_decoration ou items de chão
    if (category === "floor_decoration" || category === "ground") return false;
    return (spriteMeta?.grid_size ?? TILE_SIZE) > TILE_SIZE;
  };
```

---

# BLOCO R4 — Visibilidade entre andares: calcFirstVisibleFloor

```
ARQUIVO: src/core/floorVisibility.js

CONTEXTO:
No OTClient, calcFirstVisibleFloor() examina tiles ao redor do player para
determinar se paredes/chão limitam a visão — dentro de uma casa (Z=7) com
teto sólido, o andar de baixo (Z=6) não é visível. Em campo aberto, todos
os andares 0-7 são visíveis.

NEXO atual: getVisibleFloors(7) retorna SEMPRE [7,6,5,4,3,2,1,0], sem
verificar se há cobertura. Criaturas e tiles de andares 0-6 aparecem
visíveis mesmo dentro de um edifício.

Distribuição de andares no mapa atual:
  Z=4-6: 2177 tiles (andares acima da superfície — prédios, plataformas)
  Z=7:   5912 tiles (superfície principal)
  Z=8-11: 18884 tiles (underground — cavernas, porões)

FAZER em src/core/floorVisibility.js:

1. Adicionar a função calcFirstVisibleFloor no final do arquivo.
   Esta função aceita o mapa e a posição da câmera, e retorna o primeiro
   andar visível baseado nos tiles ao redor (lógica fiel ao OTClient):

export function calcFirstVisibleFloor(cameraX, cameraY, cameraZ, map, nexoData, limits = FLOOR_LIMITS) {
  const oz = clampFloor(cameraZ, limits);

  // Underground: firstFloor limitado pelo range aware
  if (oz > limits.surfaceMax) {
    return Math.max(limits.min,
      oz - limits.undergroundDelta,
      limits.surfaceMax + 1
    );
  }

  // Superfície: começa assumindo que vê tudo (floor 0)
  let firstFloor = 0;

  // Verifica tiles ao redor (3x3) para detectar limites de visão
  // Replicando OTClient calcFirstVisibleFloor()
  for (let ix = -1; ix <= 1 && firstFloor < oz; ix++) {
    for (let iy = -1; iy <= 1 && firstFloor < oz; iy++) {
      const px = cameraX + ix;
      const py = cameraY + iy;

      // Só verifica posições cardinais e a central (não diagonais puras)
      const isCardinal = (ix === 0 || iy === 0);
      if (!isCardinal) continue;

      // Verificar andares acima da câmera em busca de tiles que limitam a visão
      // coveredUp: cada step sobe 1 andar E desloca +1 tile (x+1, y+1)
      // (replica Position::coveredUp do OTClient)
      let checkX = px;
      let checkY = py;
      let checkZ = oz;

      while (checkZ > firstFloor) {
        checkZ -= 1;
        checkX += 1;  // coveredUp: x++, y++, z--
        checkY += 1;

        const coord = `${checkX},${checkY},${checkZ}`;
        const tile = map?.[coord];
        if (!tile) continue;

        // Verifica se o tile limita a visão (tem chão ou parede opaca)
        if (_tileLimitsFloor(tile, nexoData)) {
          firstFloor = checkZ + 1;
          break;
        }
      }
    }
  }

  return Math.max(0, Math.min(firstFloor, oz));
}

2. Adicionar a função auxiliar _tileLimitsFloor (privada, sem export):

function _tileLimitsFloor(tileData, nexoData) {
  if (!tileData || !nexoData) return false;

  // Flatten items do tile
  let ids = [];
  if (Array.isArray(tileData)) {
    ids = tileData.map(it => typeof it === 'object' ? it.id : it);
  } else if (typeof tileData === 'object') {
    for (const key of Object.keys(tileData)) {
      if (!isNaN(Number(key))) {
        const layer = tileData[key];
        if (Array.isArray(layer)) {
          for (const it of layer) {
            ids.push(typeof it === 'object' ? it.id : it);
          }
        }
      }
    }
  }

  for (const id of ids) {
    if (!id) continue;
    const meta = nexoData[String(id)];
    if (!meta) continue;
    const game = meta.game ?? {};
    const raw  = meta.flags_raw ?? {};

    // Ground tile → limita visão (teto sólido)
    const bank  = game.bank  ?? raw.bank;
    const layer = game.layer ?? game.render_layer;
    if (bank || layer === 0) return true;

    // Bottom item com blockProjectile → limita visão (parede opaca)
    const bottom   = game.bottom   ?? raw.bottom;
    const noPassProj = game.block_projectile ?? raw.block_projectile ?? raw.blockProjectile;
    if (bottom && noPassProj) return true;
  }

  return false;
}

3. Exportar calcFirstVisibleFloor e atualizar getVisibleFloors para usá-la
   opcionalmente quando mapa e posição forem passados:

   A função getVisibleFloors existente NÃO muda — ela continua sendo usada
   para render de tiles (sempre mostra todos os andares possíveis).
   calcFirstVisibleFloor é usada APENAS para filtrar CRIATURAS visíveis.

FAZER em src/render/worldRenderer.js:

4. Importar calcFirstVisibleFloor:
   import { canSeeFloor, getVisibleFloors, calcFirstVisibleFloor } from "../core/floorVisibility.js";

5. Na função renderEntitiesFull (linha ~153), adicionar cálculo do firstFloor
   para filtrar criaturas de andares que não devem ser visíveis.
   Localizar o bloco de filter dos entities (linha ~188):

     .filter(([, ent]) => {
       if (!ent) return false;
       const entZRaw = Number(ent.z);
       const entZ = Number.isFinite(entZRaw) ? entZRaw : floorRef;
       if (showBodiesAcrossVisibleFloors) {
         if (!canSeeFloor(floorRef, entZ)) return false;
       } else if (entZ !== floorRef) {
         return false;
       }

   Adicionar ANTES do return false do canSeeFloor, após calcular entZ:

       // Calcular firstVisibleFloor baseado em tiles ao redor da câmera
       // Isso evita ver criaturas de andares cobertos por teto/paredes
       if (showBodiesAcrossVisibleFloors && map && mapData) {
         const camTileX = Math.floor(camX / TILE_SIZE + ctx.canvas.width / (2 * TILE_SIZE));
         const camTileY = Math.floor(camY / TILE_SIZE + ctx.canvas.height / (2 * TILE_SIZE));
         const firstVisible = calcFirstVisibleFloor(camTileX, camTileY, floorRef, map, mapData);
         if (entZ < firstVisible) return false;
       }
```

---

# BLOCO R5 — UNIFIED_RENDER_OPTIONS: ajustar comportamento padrão

```
ARQUIVO: src/core/config.js

CONTEXTO:
Com os fixes R1-R4 aplicados, o comportamento padrão pode ser ajustado
para ser mais fiel ao Tibia original.

LOCALIZAR UNIFIED_RENDER_OPTIONS (linha ~67):

export const UNIFIED_RENDER_OPTIONS = Object.freeze({
  showHP: true,
  showName: true,
  renderMode: "high",
  entitiesOnTop: true,
  mapTallBeforeEntities: false,
  upperFloorsBeforeEntities: true,
  topDecorBeforeEntities: false,
  labelsSameFloorOnly: true,
  showBodiesAcrossVisibleFloors: true,
  useFrontOcclusionSort: true,
  showUpperFloors: true,
  showTopDecor: true,
});

NENHUMA MUDANÇA obrigatória aqui — os valores padrão são corretos.
Porém, documentar o comportamento de cada opção relevante nos comentários:

export const UNIFIED_RENDER_OPTIONS = Object.freeze({
  showHP: true,
  showName: true,
  renderMode: "high",
  entitiesOnTop: true,
  mapTallBeforeEntities: false,
  upperFloorsBeforeEntities: true,
  topDecorBeforeEntities: false,
  labelsSameFloorOnly: true,

  // true = criaturas de andares adjacentes visíveis com offset isométrico (Tibia original)
  // false = apenas criaturas do andar ativo (mais simples, menos fiel)
  showBodiesAcrossVisibleFloors: true,

  // true = y-sort ativo: tiles ao sul do player são redesenhados após o player
  // Necessário para árvores/vegetação (top items) cobrirem o player corretamente
  useFrontOcclusionSort: true,

  // true = andares superiores (Z<activeZ) renderizados sobre o andar ativo
  // Necessário para telhados de prédios aparecerem quando player está dentro
  showUpperFloors: true,

  // true = items com category=top (copas de árvore) redesenhados após player
  showTopDecor: true,
});
```

---

# BLOCO R6 — Verificação e smoke test completo

```
Após aplicar todos os blocos anteriores (R1-R5), testar:

── TESTE 1: Bancada não cobre mais o player ──
  Mover o player para o tile de uma bancada (obstacle, gs=64).
  ANTES (bug): bancada redesenhada pelo y-sort → cobre parte do player
  DEPOIS (correto): bancada é bottom item → desenhada ANTES do player → player por cima

── TESTE 2: Escada não cobre o player ──
  Mover o player adjacente à escada de mão.
  ANTES (bug): escada aparece por cima do player
  DEPOIS (correto): player aparece por cima da escada

── TESTE 3: POT (world_item) consistente ──
  Colocar um item no chão próximo a uma bancada.
  ANTES (bug): POT some por baixo da bancada ao mover o player
  DEPOIS (correto): POT sempre aparece acima do chão, bancada sempre abaixo do player

── TESTE 4: Árvores continuam cobrindo o player ──
  Mover o player para o tile de uma árvore ou arbusto.
  DEVE continuar: copa da árvore (se houver top item) cobre o player ✓
  Arbustos (obstacle com clip → groundBorder após fix R1) aparecem antes do player ✓

── TESTE 5: Criaturas em andares diferentes ──
  Ficar em Z=7 com monstro em Z=6 (andar acima — dentro de prédio).
  Com fix R4: monstro em Z=6 não deve aparecer se há teto entre os andares.
  Sem fix R4 (se não implementado): monstro aparece com offset isométrico (comportamento anterior).

── VERIFICAÇÃO COM GREP ──

  # Confirmar que obstacle não está mais em _vegetationCategories:
  grep -n "obstacle" src/render/worldRenderer.js
  # Esperado: apenas comentário explicando a remoção

  # Confirmar sort DESC para common:
  grep -n "DECRESCENTE\|DESC.*common\|btl - atl" src/render/mapRenderer.js
  # Esperado: a linha do sort com btl - atl

  # Confirmar fallback de render_layer em classifyItemOT:
  grep -n "renderLayerFallback\|render_layer.*fallback\|notWalkable.*bottom" src/render/mapRenderer.js
  # Esperado: pelo menos 2 ocorrências

  # Confirmar calcFirstVisibleFloor exportada:
  grep -n "export function calcFirstVisibleFloor" src/core/floorVisibility.js
  # Esperado: 1 ocorrência
```

---

## Referência: OTClient vs NEXO após todos os fixes

| Comportamento            | OTClient (correto)                               | NEXO antes                                          | NEXO depois                                          |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| Bancada não cobre player | bottom item → DrawOrder::THIRD antes de creature | obstacle → occluder → redesenha após player         | obstacle → bottom → não é occluder                   |
| Escada não cobre player  | bottom item com floor_change → DrawOrder::THIRD  | sem flags → common → pode virar occluder            | unpass+obstacle → bottom                             |
| POT consistente ao mover | common item → desenhado entre bottom e creature  | varia com y-sort por ser "obstacle" em tile vizinho | bottom itens estáveis, common items corretos         |
| Arbustos cobrem player   | groundBorder (clip) → DrawOrder::SECOND          | obstacle+clip → occluder → redesenha após player    | com fix R1: clip+sem bottom → groundBorder (correto) |
| Criaturas em andares     | calcFirstVisibleFloor usa tiles ao redor         | sempre mostra ±2 andares sem verificar cobertura    | calcFirstVisibleFloor verifica tiles (fix R4)        |

## Nota sobre "obstacle" com clip (arbustos/pedras)

Com o fix R1, obstacles COM clip (ids 439, 441, 447, 4633-4644) passam a ser
classificados como "groundBorder" pelo classifyItemOT (a regra `clip && !bottom`
é verificada ANTES do fallback de render_layer). Isso é correto:
OTClient: clip flag = ThingFlagAttrGroundBorder = DrawOrder::SECOND
Resultado: arbustos aparecem entre ground e bottom items, antes do player ✓
