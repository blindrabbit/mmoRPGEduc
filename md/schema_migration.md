# Migração de Schema (Firebase)

## Funções disponíveis

As funções estão em `core/db.js`:

- `previewSchemaMigration()`
- `runSchemaMigration({ dryRun })`

A migração normaliza os nós:

- `players_data`
- `online_players`
- `world_entities`
- `world_effects`
- `world_fields`

## Como executar (no navegador com o projeto aberto)

### 1) Pré-visualização (não grava nada)

```js
const db = await import("./core/db.js");
const preview = await db.previewSchemaMigration();
console.log(preview);
```

### 2) Executar de verdade

```js
const db = await import("./core/db.js");
const result = await db.runSchemaMigration({ dryRun: false });
console.log(result);
```

## Observações importantes

- A migração só escreve entidades que realmente mudaram.
- Campos extras de runtime (ex.: `lastMoveTime`, `dead`, `lastAiTick`, `cd*`) são preservados.
- `schemaVersion` é padronizado para versão atual nas entidades migradas.

---

# Revisão: o que do `config.js` poderia ir para `schema.js`

## Pode ir para `schema.js` (dados de forma/canonização da entidade)

- Defaults de entidade:
  - `player.speed` padrão
  - `player.stats` padrão (`hp`, `maxHp`, `mp`, `maxMp`, `atk`, `def`, `agi`, `level`)
  - `monster.speed` e stats base
  - `effect.effectDuration`, `effect.effectSpeed`, `field.tickRate`
- Normalizações canônicas de campos:
  - aliases de `appearance.outfitPack`
  - coerção de tipos e fallback de campos obrigatórios

## Deve ficar em `config.js` (regras de ambiente/cliente/UI)

- Render/UI/engine:
  - `TILE_SIZE`, `VIEW_WIDTH`, `VIEW_HEIGHT`, offsets, HUD, câmeras
- Regras de mundo e sessão:
  - `WORLD_SETTINGS.spawn`
  - `death.hpRecoveryMultiplier`, `respawnDelayPlayer`
- Configurações específicas de cliente/admin/world engine:
  - `RPG_ENGINE`, `WORLD_ENGINE`, `GM_ENGINE`, `ADMIN_ENGINE`
- Catálogo de classes (`PLAYER_CLASSES`):
  - é balanceamento de gameplay, não estrutura canônica

## Duplicidades atuais identificadas

- `defaultSpeed` no `config.js` e fallback de speed no `schema.js` (ambos em `120`).

## Recomendação prática

- Manter no `schema.js` apenas defaults estruturais de entidade.
- Manter no `config.js` comportamento de jogo e parâmetros de UI/engine.
- Quando o gameplay precisar sobrescrever defaults, passar explicitamente no momento de criar a entidade (`makePlayer`, `makeMonster`, etc.).
