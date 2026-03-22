# Instruções Claude Code — Parte 2

## Blocos 12, 13 e 14 + verificação do Bloco 4

> Continuação após os 11 blocos já aplicados com sucesso.
> Mesmo procedimento: cole o contexto primeiro, depois execute um bloco por vez.

---

## CONTEXTO (cole antes de começar)

```
Projeto mmoRPGEduc — clone educacional do Tibia em JavaScript + Firebase.
Os blocos 1 a 11 já foram aplicados. Agora vamos aplicar os 3 blocos restantes
e verificar um resíduo do bloco 4.

Arquitetura relevante para estes blocos:
- src/gameplay/actionProcessor.js — processa ações do worldEngine (tem o bug de BUFF/setTimeout)
- src/clients/world-engine/engine/worldTick.js — loop principal do servidor
- src/gameplay/gameCore.js — funções legado ainda usadas por worldRenderer e admin.html
- rpg.html — cliente do jogador (tem um dbSet direto que o bloco 4 pode ter deixado)
- src/server/worldEngine/WorldEngineServer.js — esqueleto para Node.js (não funcional)
- .gitignore — não existe ainda
```

---

# VERIFICAÇÃO DO BLOCO 4 (residual)

```
VERIFICAR se o seguinte trecho ainda existe em rpg.html (em torno da linha 2730):

  await dbSet(`world_items/${tempId}`, {
    ...extraFields,
    skipRangeCheck: true,
    ...
  });

SE o trecho ainda existir (não foi corrigido pelo bloco 4), aplicar esta correção:

Localizar o bloco inteiro que começa em:
  const tempId = `maptile_${coord.replace(/,/g, "_")}_${tileId}_${Date.now()}`;
  await dbSet(`world_items/${tempId}`, {

E termina em:
  await new Promise((resolve) => setTimeout(resolve, MAP_SYNC_GRACE_MS));
  payload = { ...payload, worldItemId: tempId, tileId };

SUBSTITUIR por:

  const tempId = `maptile_${coord.replace(/,/g, "_")}_${tileId}_${Date.now()}`;

  // Envia para o worldEngine validar distância e criar o item server-side
  const mapPickupActionId = `${uid}_map_tile_pickup_${Date.now()}`;
  await dbSet(`${PATHS.actions}/${mapPickupActionId}`, {
    id: mapPickupActionId,
    playerId: uid,
    type: "map_tile_pickup",
    coord,
    tileId,
    mapLayer,
    extraFields,
    ts: Date.now(),
    expiresAt: Date.now() + 5000,
  });

  // Aguarda o worldEngine processar e criar o world_item
  await new Promise((resolve) => setTimeout(resolve, MAP_SYNC_GRACE_MS + 50));
  payload = { ...payload, worldItemId: tempId, tileId };

SE o trecho NÃO existir mais (bloco 4 já foi aplicado corretamente), pular esta etapa.
```

---

# BLOCO 12 — BUFF/DEBUFF com setTimeout → sistema de expiração por tick

```
PROBLEMA: Em src/gameplay/actionProcessor.js, existem dois setTimeout (linhas ~524 e ~552)
que revertem buffs/debuffs após a duração da magia. Se o worldEngine for reiniciado ou
recarregado durante esse tempo, os timers desaparecem e os buffs ficam permanentes
(ou seja, um jogador pode ter +100 de força para sempre após um crash).

FAZER em src/gameplay/actionProcessor.js:

─── PASSO 1: Adicionar o Map de buffs ativos ───
Logo após as declarações de _cooldowns e _queuedActions no topo do arquivo
(após "const _queuedActions = new Map();"), adicionar:

  // Rastreia buffs/debuffs ativos para expiração via tick (evita setTimeout perdido em crash)
  const _activeBuffs = new Map();
  // key: `${playerId}:${spellId}:${targetId}`, value: { expiresAt, stat, originalValue, targetType, targetId }

─── PASSO 2: Substituir o primeiro setTimeout (buff em si mesmo) ───
Localizar o trecho (dentro do bloco "if (isSelf)"):

  setTimeout(async () => {
    await batchWrite({
      [`${PATHS.playerDataStats(playerId)}/${stat}`]: current,
      [`${PATHS.playerStats(playerId)}/${stat}`]: current,
    });
  }, spell.duration ?? 5000);

SUBSTITUIR por:

  // Registra buff para expiração no próximo tick que passar do prazo
  _activeBuffs.set(`${playerId}:${spellId}:self`, {
    expiresAt: (now ?? Date.now()) + (spell.duration ?? 5000),
    stat,
    originalValue: current,
    targetType: "player",
    targetId: playerId,
  });

─── PASSO 3: Substituir o segundo setTimeout (buff em monstro) ───
Localizar o trecho (dentro do bloco "else", após "if (spell.effectId)..."):

  setTimeout(async () => {
    await batchWrite({
      [`world_entities/${targetId}/stats/${stat}`]: current,
    });
  }, spell.duration ?? 5000);

SUBSTITUIR por:

  _activeBuffs.set(`${playerId}:${spellId}:${targetId}`, {
    expiresAt: (now ?? Date.now()) + (spell.duration ?? 5000),
    stat,
    originalValue: current,
    targetType: "monster",
    targetId,
  });

─── PASSO 4: Exportar a função tickExpiredBuffs ───
Adicionar esta função ANTES da função _spellFx (no final do arquivo, antes do último helper):

  export async function tickExpiredBuffs(now = Date.now()) {
    if (_activeBuffs.size === 0) return;

    for (const [key, buff] of _activeBuffs.entries()) {
      if (now < buff.expiresAt) continue;
      _activeBuffs.delete(key);

      const updates = {};
      if (buff.targetType === "player") {
        updates[`${PATHS.playerDataStats(buff.targetId)}/${buff.stat}`] = buff.originalValue;
        updates[`${PATHS.playerStats(buff.targetId)}/${buff.stat}`]     = buff.originalValue;
      } else {
        updates[`world_entities/${buff.targetId}/stats/${buff.stat}`] = buff.originalValue;
      }

      if (Object.keys(updates).length > 0) {
        await batchWrite(updates).catch((e) =>
          console.error("[tickExpiredBuffs] Erro ao reverter buff:", e)
        );
      }
    }
  }

─── PASSO 5: Chamar tickExpiredBuffs no worldTick ───
Em src/clients/world-engine/engine/worldTick.js:

1. Adicionar o import no topo (junto com enqueueAction, processAction, flushQueuedActions):
   import {
     enqueueAction,
     processAction,
     flushQueuedActions,
     tickExpiredBuffs,
   } from "../../../gameplay/actionProcessor.js";

2. No método _tick(), dentro do bloco "if (allowCombat)", logo após o await flushQueuedActions:

   const processedActionIds = await flushQueuedActions(now);
   await deletePlayerActions(processedActionIds);
   await tickExpiredBuffs(now);   // ← adicionar esta linha
```

---

# BLOCO 13 — Limpeza de código morto e organização

```
FAZER as seguintes limpezas cirúrgicas:

─── 1. Criar .gitignore na raiz do projeto ───
Criar o arquivo .gitignore na raiz (mesma pasta de rpg.html e worldEngine.html) com:

  # Windows
  desktop.ini
  Thumbs.db
  ehthumbs.db

  # macOS
  .DS_Store
  .AppleDouble
  .LSOverride

  # Node
  node_modules/
  npm-debug.log*

  # Build
  dist/
  build/

  # Secrets
  src/core/firebase.config.js

  # Editor
  .vscode/settings.json
  *.suo
  *.user

─── 2. Documentar WorldEngineServer.js como esqueleto ───
Em src/server/worldEngine/WorldEngineServer.js, substituir o bloco de comentário inicial
(as primeiras ~15 linhas de comentários) por:

  /**
   * WorldEngineServer.js — ESQUELETO PARA MIGRAÇÃO (NÃO FUNCIONAL)
   *
   * Status: aguardando Fase 3 do roadmap (migração do worldEngine.html → Node.js)
   *
   * Para ativar quando a migração for iniciada:
   *   1. npm install firebase-admin express ws
   *   2. Criar src/core/firebase.admin.config.js com as credenciais do service account
   *   3. Descomentar os imports abaixo
   *   4. Substituir WorkerBridge por WebSocket server
   *
   * A lógica de jogo (WorldEngineCore) já é compartilhada com o cliente —
   * a migração não requer reescrever regras de gameplay.
   */

─── 3. Limpar comentários de imports removidos ───
Em src/gameplay/gameCore.js, remover estas duas linhas (são ruído — o import já foi removido):
  // FASE IMEDIATA: re-export de firebaseClient REMOVIDO.
  // ❌ REMOVIDO: export { dbWatch as monitorFirebase } from './firebaseClient.js'

Em src/gameplay/monsterManager.js, se existir alguma linha com "// ❌ import", removê-la.
Em src/gameplay/playerManager.js, se existir alguma linha com "// ❌ import", removê-la.

─── 4. Adicionar @deprecated nas funções legado de gameCore.js ───
As funções drawMap, processRenderFrame e renderGameFrame são usadas apenas por worldRenderer.js
e admin.html. Adicionar JSDoc acima de cada uma:

Antes de "export function drawMap(":
  /**
   * @deprecated Usar diretamente worldRenderer.js para novo código.
   * Mantida para compatibilidade com admin.html e rpg.html legados.
   */

Antes de "export function processRenderFrame(":
  /**
   * @deprecated Mantida para compatibilidade. Nova arquitetura usa WorldRenderer.renderFrame().
   */

Antes de "export function renderGameFrame(":
  /**
   * @deprecated Mantida para compatibilidade. Nova arquitetura usa WorldRenderer.renderFrame().
   */

─── 5. Marcar combatEngine.applyDamage como deprecated ───
Em src/gameplay/combatEngine.js, localizar a função applyDamage e adicionar JSDoc antes dela:
  /**
   * @deprecated Use combatService.applyPlayerDamage() para novo código.
   * Mantida apenas para compatibilidade com admin.html.
   */

─── 6. Documentar handlePlayerSync como server-only ───
Em src/gameplay/playerManager.js, localizar a função handlePlayerSync e adicionar JSDoc:
  /**
   * Sincroniza posição do player no Firebase.
   *
   * ATENÇÃO: Esta função deve ser chamada APENAS pelo worldEngine (actionProcessor._processMove).
   * O cliente (rpg.html) não deve chamá-la diretamente — use player_actions com type:"move".
   *
   * @param {string} charId
   * @param {Object} myPos
   */
```

---

# BLOCO 14 — Verificação final completa

```
Executar estas verificações em sequência. Para cada uma, reportar o resultado.

─── 1. Zero-Trust: Sem escritas diretas de estado no cliente ───
Executar no terminal:

  grep -rn "await dbSet\|await dbUpdate\|await batchWrite" rpg.html admin.html src/clients/

Resultado ACEITÁVEL (falsos positivos esperados):
  - rpg.html: imports de dbSet (linha de import, não de uso)
  - rpg.html: dbSet para player_actions (envio de intenção — OK)
  - admin.html: qualquer uso (admin tem permissão privilegiada)
  - src/clients/world-engine/: writeShim → player_actions (OK)

Resultado NÃO ACEITÁVEL (precisa corrigir):
  - Qualquer "dbSet(`world_items/..."  fora de player_actions
  - Qualquer "batchWrite" em src/clients/ ou em rpg.html

─── 2. Duplicatas: Confirmar que isTileWalkable tem apenas uma definição ───

  grep -rn "^export function isTileWalkable" src/

Esperado: exatamente 1 resultado (em src/core/collision.js)
Se aparecer src/gameplay/combatLogic.js também → o bloco 7 não foi aplicado completamente

─── 3. Buff/setTimeout: Confirmar que não há mais setTimeout para reverter buffs ───

  grep -n "setTimeout" src/gameplay/actionProcessor.js

Esperado: 0 resultados (após bloco 12)
Se aparecer → bloco 12 ainda não foi aplicado

─── 4. Memory Leak: Confirmar que destroyWorldStore existe ───

  grep -n "export function destroyWorldStore\|destroyWorldStore()" src/core/worldStore.js

Esperado: pelo menos 2 resultados (definição + chamada no cleanup dos watchers)

─── 5. Cache: Confirmar que _boundedMap está sendo usado ───

  grep -n "_boundedMap\|new Map()" src/render/mapRenderer.js | head -20

Esperado: as 5 linhas de cache devem usar _boundedMap(), não new Map()

─── 6. Logger: Confirmar que initRPGPlayerActions não tem mais console.log ───

  grep -c "console\.log" src/clients/shared/initRPGPlayerActions.js

Esperado: 0

─── 7. Pointer Events: Confirmar que não há listeners no document ───

  grep -n "document.addEventListener.*pointerdown\|document.addEventListener.*pointerup" \
    src/clients/shared/initRPGPlayerActions.js

Esperado: 0 resultados

─── 8. Auth: Confirmar que admin.html tem verificação de autenticação ───

  grep -n "getCurrentUser\|onAuthChange\|authSignIn\|firebase.*auth" admin.html | head -10

Esperado: pelo menos 3 ocorrências

─── 9. Firebase Rules: Confirmar que os campos de bypass estão bloqueados ───

  grep -n "isAdmin\|isGM\|skipRangeCheck" md/firebase.rules.json

Esperado: pelo menos 3 ocorrências com ".validate": "false"

─── 10. .gitignore: Confirmar que foi criado e inclui firebase.config.js ───

  cat .gitignore | grep firebase

Esperado: src/core/firebase.config.js aparece no .gitignore
CRÍTICO: o arquivo firebase.config.js com as credenciais reais NUNCA deve ser commitado.

─── 11. GAME SMOKE TEST ───
Depois das verificações acima, testar manualmente:
  a) Abrir rpg.html no browser → login funciona via Firebase Auth
  b) Mover o personagem → outros jogadores veem o movimento
  c) Abrir/fechar uma porta → recarregar a página → porta deve estar no mesmo estado
  d) Abrir admin.html sem estar logado → deve exigir autenticação
  e) No console do browser: window.RPG_DEBUG = true → deve aparecer logs de debug
  f) No console do browser: window.RPG_DEBUG = false → logs de debug somem

─── 12. RELATÓRIO FINAL ───
Após todas as verificações, listar:
  - Quantos itens passaram ✓
  - Quantos itens precisam de correção adicional ✗
  - Para cada ✗, qual o arquivo e linha exata
```

---

## ORDEM DE EXECUÇÃO

1. Verificação do Bloco 4 (residual) → só aplica se o dbSet ainda existir
2. Bloco 12 (BUFF/setTimeout)
3. Bloco 13 (limpeza)
4. Bloco 14 (verificação final) → executa por último, reporta o resultado

## NOTA SOBRE firebase.config.js

Se o arquivo `src/core/firebase.config.js` com as credenciais reais já existe no repositório,
executar imediatamente após criar o .gitignore:

git rm --cached src/core/firebase.config.js
git commit -m "chore: remover firebase.config.js do tracking (credenciais)"

Isso remove o arquivo do histórico de tracking sem deletá-lo do disco.
As credenciais permanecem locais e não serão mais commitadas.
