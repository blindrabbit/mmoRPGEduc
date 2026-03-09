# Render Compatibility Guide — Pipeline v11

> Baseado nos arquivos reais: `atlas_ground_01.json`, `atlas_items_02.json`,
> `map_data.json`, `map_compacto.json`

---

## Schema Real dos Arquivos

### `atlas_ground_01.json` / `atlas_items_02.json`

```jsonc
{
  "atlas_name": "atlas_ground",   // categoria string (não usar como chave de lookup)
  "atlas_index": 1,               // ← chave numérica para carregar o PNG correto
  "filename": "atlas_ground_01.png",
  "width": 4096,
  "height": 4096,
  "actual_height": 34,            // altura real usada (resto é preto)
  "variants": {
    "103": {                      // item ID como string
      "0": { "x": 0,   "y": 0, "w": 32, "h": 32 },
      "1": { "x": 34,  "y": 0, "w": 32, "h": 32 },
      ...
      "11": { "x": 374, "y": 0, "w": 32, "h": 32 }
    }
  }
}
```

**Nota crítica:** As coordenadas reais `x,y,w,h` estão no atlas JSON, não no
`map_data.json`. O `map_data.variants` tem apenas `atlas_index` como referência
para saber qual PNG carregar.

### `map_data.json` — campos usados no renderer

```jsonc
{
  "103": {
    "game": {
      "render_layer": 0,          // 0=ground  1=bottom  2=common  3=top
      "height_elevation": null,   // int ou null
      "is_walkable": true,
      "is_stackable": false,
      "movement_cost": 250
    },
    "flags_raw": {
      "bank": { "waypoints": 250 },   // ground
      "shift": { "x": 8, "y": 8 }    // deslocamento visual extra (opcional)
    },
    "pattern":      { "width": 4, "height": 3, "depth": 1, "layers": 1 },
    "bounding_box": { "x": 0, "y": 0, "width": 32, "height": 32 },
    "grid_size":    32,
    "variants": {
      "0": { "atlas_index": 1, "atlas_name": "atlas_ground", ... }
    }
  }
}
```

### `map_compacto.json` — estrutura de tile

```jsonc
{
  "93,106,7": {
    "0": [{ "id": 103, "count": 1, "action_id": null, "unique_id": null }],
    "1": [{ "id": 2320, "count": 1, "action_id": null, "unique_id": null }],
    "2": [{ "id": 9517, "count": 1, "action_id": null, "unique_id": null }],
    "3": [{ "id": 3031, "count": 1, "action_id": null, "unique_id": null }],
  },
}
```

Layers: `"0"` = ground, `"1"` = bottom, `"2"` = common, `"3"` = top.
Layers ausentes simplesmente não aparecem no objeto do tile.

---

## Como Carregar os Atlases

```javascript
// atlases: Map<atlas_index, { img: HTMLImageElement, variants: Object }>
async function loadAtlases(atlasJsonPaths, assetDir) {
  const atlases = new Map();
  for (const jsonPath of atlasJsonPaths) {
    const meta = await fetch(jsonPath).then((r) => r.json());
    const img = await loadImage(`${assetDir}/${meta.filename}`);
    atlases.set(meta.atlas_index, { img, variants: meta.variants });
  }
  return atlases;
}
```

---

## Lookup de Variante

A chave de variante é sempre um **número inteiro como string** (`"0"`, `"1"`, `"11"`, etc.):

```javascript
// Para grounds/borders com pattern > 1: key = patY * patW + patX
function getVariantKey(itemData, tileX, tileY) {
  const patW = itemData.pattern?.width ?? 1;
  const patH = itemData.pattern?.height ?? 1;
  if (patW === 1 && patH === 1) return "0";
  return String((tileY % patH) * patW + (tileX % patW));
}

// Lookup completo: retorna { img, x, y, w, h } ou null
function getSprite(itemId, variantKey, atlases, mapData) {
  const item = mapData[String(itemId)];
  if (!item) return null;

  // atlas_index vem do map_data
  const varRef = item.variants?.[variantKey] ?? item.variants?.["0"];
  if (!varRef) return null;

  const atlas = atlases.get(varRef.atlas_index);
  if (!atlas) return null;

  // Coordenadas reais vêm do atlas JSON
  const coords =
    atlas.variants[String(itemId)]?.[variantKey] ??
    atlas.variants[String(itemId)]?.["0"];
  if (!coords) return null;

  return { img: atlas.img, ...coords }; // { img, x, y, w, h }
}
```

---

## Fórmula de Posicionamento — A Correção Central

O renderer usa **ancoragem bottom-right**: `(screenX, screenY)` é o canto
inferior-direito do tile de destino. O deslocamento é calculado a partir do
tamanho real do sprite no atlas (`w`, `h`):

```javascript
function drawItem(
  ctx,
  screenX,
  screenY,
  itemId,
  variantKey,
  atlases,
  mapData,
  elevation = 0,
) {
  const sprite = getSprite(itemId, variantKey, atlases, mapData);
  if (!sprite) return 0;

  const item = mapData[String(itemId)];
  const shift = item.flags_raw?.shift ?? { x: 0, y: 0 };

  // ─── FÓRMULA ───────────────────────────────────────────────────
  // sprite.w > 32 → sprite ocupa tile(s) à esquerda: deslocar X em -(w-32)
  // sprite.h > 32 → sprite ocupa tile(s) acima:      deslocar Y em -(h-32)
  // shift.x/y     → deslocamento visual extra do item (flag shift)
  // elevation     → acumulador de elevação do tile (apenas layers 1 e 2)
  // ───────────────────────────────────────────────────────────────
  const drawX = screenX - (sprite.w - 32) - (shift.x ?? 0);
  const drawY = screenY - (sprite.h - 32) - (shift.y ?? 0) - elevation;

  ctx.drawImage(
    sprite.img,
    sprite.x,
    sprite.y,
    sprite.w,
    sprite.h,
    drawX,
    drawY,
    sprite.w,
    sprite.h,
  );

  return item.game?.height_elevation ?? 0;
}
```

### Deslocamentos reais dos itens problemáticos

|  ID  | Sprite w×h | drawX offset | drawY offset | Causa do bug                                        |
| :--: | :--------: | :----------: | :----------: | :-------------------------------------------------- |
| 1951 |   32×64    |      0       |   **−32**    | Escada renderizando 1 tile acima — faltava offset Y |
| 2931 |   32×64    |      0       |   **−32**    | Tocha renderizando 1 tile acima                     |
| 2320 |   32×64    |      0       |   **−32**    | Bancada renderizando 1 tile acima                   |
| 9517 |   64×32    |   **−32**    |      0       | Detalhe de parede renderizando 1 tile à esquerda    |

Todos os bugs são causados pelo mesmo problema: **o renderer não subtraía
`(sprite.w - 32)` e `(sprite.h - 32)` da posição de draw**. Para sprites 32×64
o erro era só no Y (−32), para 64×32 só no X (−32).

---

## Dois Loops de Render Obrigatórios

O OTClient usa **dois passes separados** para toda a viewport. Isso garante que
o chão de todos os tiles apareça antes de qualquer item ou criatura:

```javascript
function renderViewport(
  ctx,
  visibleTileKeys,
  mapCompacto,
  mapData,
  atlases,
  camera,
) {
  // ── PASSO 1: Ground + GroundBorders de TODOS os tiles ──────────
  for (const key of visibleTileKeys) {
    const tile = mapCompacto[key];
    if (!tile) continue;
    const [tx, ty] = key.split(",").map(Number);
    const { sx, sy } = tileToScreen(tx, ty, camera);

    // Ground (layer "0")
    for (const item of tile["0"] ?? []) {
      const vk = getVariantKey(mapData[item.id], tx, ty);
      drawItem(ctx, sx, sy, item.id, vk, atlases, mapData, 0);
    }

    // GroundBorders: layer "1" com flags_raw.clip === true
    for (const item of tile["1"] ?? []) {
      const meta = mapData[String(item.id)];
      if (!meta?.flags_raw?.clip) continue;
      const vk = getVariantKey(meta, tx, ty);
      drawItem(ctx, sx, sy, item.id, vk, atlases, mapData, 0);
    }
  }

  // ── PASSO 2: Bottom → Common → Top de TODOS os tiles ───────────
  for (const key of visibleTileKeys) {
    const tile = mapCompacto[key];
    if (!tile) continue;
    const [tx, ty] = key.split(",").map(Number);
    const { sx, sy } = tileToScreen(tx, ty, camera);
    let elevation = 0;

    // Bottom items: layer "1" sem clip (paredes, escadas, bancadas)
    for (const item of tile["1"] ?? []) {
      const meta = mapData[String(item.id)];
      if (meta?.flags_raw?.clip) continue; // já foi no passo 1
      elevation += drawItem(
        ctx,
        sx,
        sy,
        item.id,
        "0",
        atlases,
        mapData,
        elevation,
      );
    }

    // Common items: layer "2"
    for (const item of tile["2"] ?? []) {
      elevation += drawItem(
        ctx,
        sx,
        sy,
        item.id,
        "0",
        atlases,
        mapData,
        elevation,
      );
    }

    // Top items: layer "3" — NÃO usam elevation
    for (const item of tile["3"] ?? []) {
      drawItem(ctx, sx, sy, item.id, "0", atlases, mapData, 0);
    }
  }
}
```

---

## Stackables com Variante por Quantidade

Itens com `is_stackable === true` e `pattern.width === 4, pattern.height === 2`
precisam de `variantKey` calculado pela quantidade:

```javascript
function getStackableVariantKey(count) {
  if (count <= 1) return "0";
  if (count === 2) return "1";
  if (count === 3) return "2";
  if (count <= 9) return "3";
  if (count <= 24) return "4";
  if (count <= 49) return "5";
  if (count <= 99) return "6";
  return "7";
}
```

---

## Checklist de Correção

- [ ] `drawX = screenX - (sprite.w - 32) - (shift.x ?? 0)`
- [ ] `drawY = screenY - (sprite.h - 32) - (shift.y ?? 0) - elevation`
- [ ] Sprites `32×64` → apenas Y desloca −32 (escadas, tochas, bancadas)
- [ ] Sprites `64×32` → apenas X desloca −32 (detalhes de parede horizontais)
- [ ] Sprites `64×64` → X e Y deslocam −32 (itens grandes)
- [ ] `shift.x/y` do `flags_raw` é somado **após** o offset de tamanho do atlas
- [ ] `elevation` **não** é aplicado em top items (layer `"3"`)
- [ ] `elevation` acumula em bottom (layer `"1"` não-clip) + common (layer `"2"`)
- [ ] GroundBorders (`flags_raw.clip === true`) renderizados no **Passo 1**
- [ ] Variantes de ground/border calculadas por posição: `(y % patH) * patW + (x % patW)`
- [ ] Atlas indexado por `atlas_index` (int), **não** por `atlas_name` (string)
- [ ] Coordenadas `x,y,w,h` lidas do **atlas JSON**, não do `map_data.variants`
