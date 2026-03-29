# Fix — Player aparece sobre os arbustos

## O que está acontecendo

O player caminha por cima dos arbustos em vez de ficarem cobertos por eles.

---

## Por que isso aconteceu agora

O fix **B1** (sessão anterior) corrigiu o bug "arbusto abaixo da borda de grama" movendo
arbustos de `"groundBorder"` para `"bottom"` dentro de `classifyItemOT()`:

```js
// src/render/mapRenderer.js — classifyItemOT()
if (clip && !bottom) {
  if (unpassForClip) return "bottom"; // ← fix B1
  return "groundBorder";
}
```

O fix foi correto para a **ordem de draw**: arbustos agora ficam no main pass, após as
bordas de grama. Mas criou um problema novo: como são `"bottom"` e o fix **R3** garante
que `obstacle`/`furniture` nunca são occluders, a função `isOccluder()` passou a retornar
`false` para eles — e o y-sort deixou de redesenhá-los após o player.

### Fluxo atual (com o bug)

```
Ground pass:   [grama] [borda de grama]
Main pass:     [arbusto (bottom)] → [player] → y-sort redesenha occluders
isOccluder(arbusto) = false   ← arbusto não é redesenhado
Resultado:     player aparece NA FRENTE do arbusto ← BUG
```

### Fluxo esperado

```
Ground pass:   [grama] [borda de grama]
Main pass:     [arbusto (bottom)] → [player] → y-sort redesenha occluders
isOccluder(arbusto) = true    ← arbusto redesenhado APÓS player
Resultado:     arbusto cobre o player ← correto
```

---

## A distinção que precisa ser feita

| Item           | flags                     | Deve cobrir player?        | isOccluder |
| -------------- | ------------------------- | -------------------------- | ---------- |
| Arbusto/moita  | `clip=True + unpass=True` | **Sim** — vegetação visual | `true`     |
| Borda de grama | `clip=True` (sem unpass)  | Não — detalhe de chão      | `false`    |
| Bancada        | `bottom=True` (sem clip)  | Não — mobiliário           | `false`    |
| Parede         | `category=wall`           | Não — bottom item          | `false`    |

A distinção é simples: **`clip` identifica vegetação**, `bottom` sem `clip` identifica
mobiliário/paredes. O fix R3 removeu `"obstacle"` dos occluders para bancadas —
mas arbustos são `obstacle + clip`, e bancadas são `obstacle` sem `clip`.
A verificação `clip + unpass` distingue os dois casos sem interferir no R3.

---

## O fix

**Arquivo:** `src/render/worldRenderer.js`

**Localizar** a função `isOccluder` (linha ~578). Trecho atual:

```js
const isOccluder = (spriteMeta) => {
  const game = spriteMeta?.game ?? {};
  const raw = spriteMeta?.flags_raw ?? {};

  // Regra primária (OTClient): ThingFlagAttrOnTop = único flag que faz item cobrir creature
  const hasTopFlag = game.top || raw.top || game.topeffect || raw.topeffect;
  if (hasTopFlag) return true;

  const category = String(game.category_type ?? "").toLowerCase();

  // Paredes, edifícios, obstacles e furniture são bottom items — NUNCA occluders
  if (_wallCategories.has(category)) return false;
  if (category === "obstacle" || category === "furniture") return false; // ← linha-chave

  // Vegetação visual e top_decoration → occluder
  if (_vegetationCategories.has(category)) return true;

  // floor_decoration e ground nunca cobrem o player
  if (
    category === "floor_decoration" ||
    category === "ground" ||
    category === "ground_border"
  )
    return false;

  // Sprites visualmente altos (>1 tile) sem categoria explícita → occluder cauteloso
  return (spriteMeta?.grid_size ?? TILE_SIZE) > TILE_SIZE;
};
```

**Substituir** pelo trecho abaixo — única mudança é adicionar o bloco
`clip + unpass → true` **antes** do check de `"obstacle"/"furniture"`:

```js
const isOccluder = (spriteMeta) => {
  const game = spriteMeta?.game ?? {};
  const raw = spriteMeta?.flags_raw ?? {};

  // Regra primária (OTClient): ThingFlagAttrOnTop = único flag que faz item cobrir creature
  const hasTopFlag = game.top || raw.top || game.topeffect || raw.topeffect;
  if (hasTopFlag) return true;

  // Arbustos e moitas bloqueantes: clip=True + unpass=True → occluder visual.
  // clip identifica vegetação (ThingFlagAttrGroundBorder no OTClient).
  // unpass garante que é um obstáculo físico, não apenas um detalhe de chão.
  // Deve vir ANTES do check de "obstacle"/"furniture" para distinguir
  // arbustos (obstacle+clip+unpass) de bancadas (obstacle/furniture, sem clip).
  const hasClip = game.clip ?? raw.clip;
  const hasUnpass = game.unpass ?? raw.unpass;
  if (hasClip && hasUnpass) return true;

  const category = String(game.category_type ?? "").toLowerCase();

  // Paredes, edifícios, obstacles e furniture são bottom items — NUNCA occluders
  if (_wallCategories.has(category)) return false;
  if (category === "obstacle" || category === "furniture") return false;

  // Vegetação visual e top_decoration → occluder
  if (_vegetationCategories.has(category)) return true;

  // floor_decoration e ground nunca cobrem o player
  if (
    category === "floor_decoration" ||
    category === "ground" ||
    category === "ground_border"
  )
    return false;

  // Sprites visualmente altos (>1 tile) sem categoria explícita → occluder cauteloso
  return (spriteMeta?.grid_size ?? TILE_SIZE) > TILE_SIZE;
};
```

---

## Verificação após aplicar

```bash
# Confirmar que o bloco foi adicionado:
grep -n "hasClip.*hasUnpass\|clip.*unpass.*true" src/render/worldRenderer.js
# Esperado: 1 ocorrência
```

No browser, testar:

1. Mover o player para dentro de um cluster de arbustos → arbustos devem cobri-lo
2. Mover o player ao lado de uma bancada → bancada NÃO deve cobri-lo (fix R3 mantido)
3. Mover o player ao lado de um arbusto solto sem unpass (borda de grama) → não cobre
4. Mover o player ao lado de uma árvore com `top=True` → copa cobre ✓ (não muda)

---

## Por que não afeta bancadas

Bancadas (`id=3614`, `1638`, etc.) têm `clip=None` — a condição `hasClip && hasUnpass`
é `false` para elas. O fix passa para a linha `category === "obstacle" → false`, que as
mantém sem cobertura.

```
Arbusto id=4637: clip=True,  unpass=True  → hasClip && hasUnpass = TRUE  → occluder ✓
Bancada id=3614: clip=None,  unpass=True  → hasClip && hasUnpass = FALSE → não-occluder ✓
Borda   id=4446: clip=True,  unpass=None  → hasClip && hasUnpass = FALSE → não-occluder ✓
Parede  id=1294: clip=None,  bottom=True  → cai no check _wallCategories  → não-occluder ✓
```

---

## Contexto histórico das mudanças

| Fix          | O que fez                          | Consequência                                                   |
| ------------ | ---------------------------------- | -------------------------------------------------------------- |
| R3           | Removeu `"obstacle"` dos occluders | Bancadas param de cobrir o player ✓                            |
| B1           | `clip+unpass → "bottom"`           | Arbustos ficam acima das bordas ✓, mas saem do occluder path ✗ |
| **Este fix** | `clip+unpass → isOccluder=true`    | Arbustos voltam a cobrir o player ✓, bancadas não afetadas ✓   |

O fix B1 continua necessário — ele resolve a ordem dentro do ground/main pass.
Este fix adiciona a cobertura visual por cima do player via y-sort.
Os dois coexistem sem conflito.
