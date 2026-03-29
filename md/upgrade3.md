# Instruções Claude Code — Correções de Renderização

## Player aparecendo por baixo de bancadas e escadas

> Execute um bloco por vez. Após cada bloco, recarregue o jogo e observe a posição
> visual do player em relação a mobiliário e obstáculos.

---

## CONTEXTO (cole antes de começar)

```
Projeto mmoRPGEduc — clone do Tibia em JS + Firebase.
Arquivo central: src/render/mapRenderer.js (1499 linhas)
Arquivo de render de entidades: src/render/worldRenderer.js

BUG: o player aparece visualmente por baixo de bancadas (obstacles com gs=64)
e da escada de mão. O OTClient usa uma ordem de draw específica que difere
da nossa implementação em 3 pontos críticos.

Referência: OTClient tile.cpp (src/client/tile.cpp no zip do otclient-main)
```

---

# BLOCO R1 — classifyItemOT: adicionar fallback de render_layer

```
PROBLEMA: Alguns items no appearances_map.json têm render_layer definido mas
NÃO têm as flags booleanas (bank, bottom, top). Isso ocorre em 224 items.
Exemplo: id=1638 (obstacle gs=64) tem render_layer=2 mas bottom=null.
classifyItemOT() ignora render_layer → classifica como "common" → o item
aparece DEPOIS do player ao invés de antes.

Mapeamento correto (OTClient ThingAttr):
  render_layer=0 → ground  (equivale a bank=True)
  render_layer=1 → bottom  (equivale a bottom=True)
  render_layer=2 → bottom  (também OnBottom no OTClient)
  render_layer=3 → top     (equivale a top=True)

ARQUIVO: src/render/mapRenderer.js

LOCALIZAR a função classifyItemOT (linha ~258). Ela termina assim:

  // Default: common item
  return "common";

SUBSTITUIR a linha "return \"common\";" por:

  // Fallback: usar render_layer quando flags booleanas não definem a categoria.
  // render_layer no appearances_map segue convenção OTClient:
  // 0=ground, 1=bottom, 2=bottom (OnBottom layer2), 3=top
  const renderLayerFallback = game.render_layer ?? game.layer ?? null;
  if (renderLayerFallback === 0) {
    if (game.category_type === "wall") return "bottom";
    return "ground";
  }
  if (renderLayerFallback === 1 || renderLayerFallback === 2) return "bottom";
  if (renderLayerFallback === 3) return "top";

  // Default: common item
  return "common";

RESULTADO ESPERADO:
  - id=1638 (render_layer=2, obstacle gs=64) → bottom → desenhado ANTES do player
  - id=1640 (render_layer=2, obstacle gs=64) → bottom → desenhado ANTES do player
  - id=7144 (render_layer=3, top_decoration) → top → desenhado APÓS o player
  - 136 items com render_layer=1 passam a ser bottom corretamente
```

---

# BLOCO R2 — Sort de common items: inverter tileLayer para ordem REVERSA

```
PROBLEMA: No OTClient (tile.cpp linha 89-93), common items são desenhados
em ordem REVERSA da pilha m_things:

  for (auto& item : std::ranges::REVERSE_view(m_things)) {
    if (!item->isCommon()) continue;
    drawThing(item, dest, flags, drawElevation);
  }

Isso significa: o item inserido MAIS RECENTEMENTE (layer mais alta) é desenhado
PRIMEIRO (fica no fundo visual). O item mais antigo (layer mais baixa) fica
visualmente por CIMA — cobrindo o player conforme esperado.

NOSSO sort atual usa tileLayer CRESCENTE (ASC) para todos os items:
  return atl - btl;  // tileLayer ASC → layer0 fica no fundo, layer2 por cima

Para common items, isso está INVERTIDO em relação ao OTClient.

ARQUIVO: src/render/mapRenderer.js

LOCALIZAR o sort dentro de _renderMainPass (linha ~1347). O sort atual é:

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

SUBSTITUIR POR:

        sortable.sort((a, b) => {
          // 1. renderLayer: ground(0) → border(1) → bottom/common(2) → top(3)
          const ar = Number(a?.renderLayer ?? 2);
          const br = Number(b?.renderLayer ?? 2);
          if (ar !== br) return ar - br;

          // 2. stackPosition: bottom(3) antes de common(5)
          const as = Number(a?.stackPosition ?? 5);
          const bs = Number(b?.stackPosition ?? 5);
          if (as !== bs) return as - bs;

          // 3. tileLayer: OTClient usa REVERSE_view para common items
          //    → layer mais alta inserida PRIMEIRO no draw = fica no FUNDO visual
          //    → layer mais baixa inserida POR ÚLTIMO = fica por CIMA (cobre player)
          //    Bottom items mantêm ordem crescente (são paredes/mobiliário fixo).
          const atl = Number(a?.tileLayer ?? -1);
          const btl = Number(b?.tileLayer ?? -1);
          if (atl !== btl) {
            const isCommonA = a?.category === "common";
            const isCommonB = b?.category === "common";
            if (isCommonA && isCommonB) return btl - atl; // DECRESCENTE para common (OTClient reverse)
            return atl - btl; // CRESCENTE para bottom (ordem normal)
          }

          return Number(a?.spriteId ?? 0) - Number(b?.spriteId ?? 0);
        });

RESULTADO ESPERADO:
  - Tile com layer0=chão + layer1=escada(common) + layer2=item(common):
    Antes: layer1 desenhado, depois layer2 (layer2 por cima)
    Depois: layer2 desenhado primeiro (fundo), layer1 por cima (correto)
  - Bancada (bottom) sempre desenhada ANTES do player (não muda — já estava correto)
```

---

# BLOCO R3 — classifyItemOT: obstacle com unpass e sem flags = bottom

```
PROBLEMA RESIDUAL: Items com category_type="obstacle" e unpass=True mas SEM
nenhuma flag de posicionamento (bottom=null, top=null, bank=null, render_layer=null)
são classificados como "common" pelo classifyItemOT.

No OTClient, qualquer item com ThingFlagAttrNotWalkable (unpass) que não seja
ground ou groundBorder é inserido na pilha com stackPriority=ON_BOTTOM (2),
colocado ANTES das creatures na ordem de draw.

IDs afetados no mapa: qualquer obstacle sem flags explícitas.

ARQUIVO: src/render/mapRenderer.js

LOCALIZAR o início da função classifyItemOT (linha ~258):

function classifyItemOT(metadata) {
  if (!metadata) return "common";

  const game = metadata.game || {};
  const raw = metadata.flags_raw || {};

ADICIONAR logo após a checagem do return "top" (antes do bloco de fallback de render_layer):

  // Obstacle com unpass (não-walkable) sem flags explícitas = OnBottom no OTClient.
  // No OTClient: ThingFlagAttrNotWalkable items ficam em stackPriority=ON_BOTTOM (2).
  // Aplica apenas se item não tem bank, clip, top (não deve substituir classificações explícitas).
  const unpass = game.unpass ?? raw.unpass;
  const notWalkable = game.is_walkable === false || unpass;
  if (notWalkable && !bank && !clip && !bottom && !top && !topeffect) {
    const cat = game.category_type ?? "";
    // Só aplicar para obstáculos visuais (não para items de chão invisíveis)
    if (cat === "obstacle" || cat === "furniture" || cat === "floor_decoration") {
      return "bottom";
    }
  }

  // Fallback render_layer (adicionado no BLOCO R1)...

RESULTADO ESPERADO:
  - Qualquer obstacle com unpass=True e sem flags → bottom → desenhado antes do player
  - Escadas, mesas, armários sem flags explícitas passam a ser bottom
```

---

# BLOCO R4 — Verificação visual e smoke test

```
Após aplicar R1, R2 e R3, verificar visualmente no browser:

1. ABRIR o worldEngine.html ou rpg.html com um personagem no mapa

2. CENÁRIO 1 — Player e bancada:
   Mover o player para um tile adjacente a uma bancada (obstacle gs=64).
   ESPERADO: bancada aparece NA FRENTE do player (player por baixo da bancada).
   INCORRETO (bug atual): player aparece POR CIMA da bancada.

3. CENÁRIO 2 — Player e escada de mão:
   Mover o player para o mesmo tile ou adjacente à escada.
   ESPERADO: escada aparece na frente do player quando player está atrás dela.
   INCORRETO (bug atual): player sobrepõe a escada.

4. CENÁRIO 3 — Paredes:
   Mover o player atrás de uma parede (wall, category_type="wall").
   ESPERADO: parede cobre o player (comportamento já estava correto — não deve regredir).

5. CENÁRIO 4 — Árvores / vegetação:
   Mover o player atrás de uma árvore.
   ESPERADO: copa da árvore cobre o player (top item — já estava correto via y-sort).

DEPURAÇÃO SE ALGO REGREDIR:

Para inspecionar a categoria de um item específico, adicionar temporariamente
no console do browser:

  // Cole no console do worldEngine.html:
  const meta = window.assets?.mapData?.['ID_DO_ITEM'];
  console.log('game:', meta?.game);
  console.log('raw:', meta?.flags_raw);
  console.log('render_layer:', meta?.game?.render_layer);
  // A categoria esperada deve ser: bottom (para obstáculos)

CONFIRMAÇÃO COM GREP:

  grep -n "return \"bottom\"\|return \"common\"\|render_layer\|renderLayerFallback\|unpass.*bottom\|obstacle.*bottom" \
    src/render/mapRenderer.js | head -20

  Esperado após os 3 blocos:
    - classifyItemOT tem 3 novos blocos de return antes do return "common"
    - sort tem comentário "DECRESCENTE para common (OTClient reverse)"
```

---

## MAPA DOS BUGS vs CÓDIGO OTClient

| Bug                          | OTClient (tile.cpp)                    | NEXO (antes)                            | NEXO (depois)                        |
| ---------------------------- | -------------------------------------- | --------------------------------------- | ------------------------------------ |
| render_layer ignorado        | ThingFlagAttr lida diretamente do .dat | classifyItemOT ignora game.render_layer | fallback por render_layer adicionado |
| Common items ordem invertida | `reverse_view(m_things)` para common   | sort tileLayer ASC                      | sort tileLayer DESC para common      |
| Obstacle sem flags = common  | stackPriority=ON_BOTTOM (unpass)       | classifica como common                  | obstacle+unpass → bottom             |

## NOTA SOBRE ITENS SEM METADADOS

IDs como 1450, 1451, 1452 existem no mapa mas retornam objeto vazio do
appearances_map. Esses são items cujo sprite não foi exportado para o
master_index. Eles serão renderizados sem categoria → aparecem como common.
Isso é um problema de dados (pipeline de exportação), não de código.
Para corrigir: re-exportar o appearances_map incluindo esses IDs.

Em src/render/worldRenderer.js, localizar \_vegetationCategories:
const \_vegetationCategories = new Set([
"tree", "vegetation", "flora", "foliage", "obstacle",
]);

Substituir por:
const \_vegetationCategories = new Set([
"tree", "vegetation", "flora", "foliage",
// "obstacle" REMOVIDO: obstacles com bottom=True são bottom items no OTClient,
// nunca occluders. Bancadas, escadas e mobiliário não devem cobrir o player.
// Apenas vegetação real (árvores, arbustos) deve ser redesenhada após o player.
]);
