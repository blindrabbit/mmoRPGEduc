# Instruções para Claude Code — mmoRPGEduc

## Análise de segurança, duplicatas e performance

> **Como usar:** Abra este arquivo no VS Code com o repositório `mmoRPGEduc` aberto.
> Cole cada bloco de instrução diretamente no chat do Claude Code (terminal integrado ou painel lateral).
> Execute **um bloco por vez**, na ordem apresentada. Aguarde a conclusão antes do próximo.

---

## CONTEXTO DO PROJETO

Antes de qualquer instrução, cole isto para o Claude Code entender o projeto:

```
Este é o projeto mmoRPGEduc — um clone educacional do Tibia em JavaScript + Firebase Realtime Database.

Arquitetura:
- worldEngine.html → validador central (será migrado para Node.js). É a ÚNICA fonte de verdade.
- rpg.html → cliente do jogador
- admin.html → painel GM
- src/core/ → núcleo compartilhado (Firebase, schema, eventos)
- src/gameplay/ → lógica de jogo (actionProcessor, combate, progressão)
- src/render/ → renderização (mapRenderer, worldRenderer)
- src/clients/ → código específico por interface
- md/firebase.rules.json → regras de segurança do Firebase Realtime Database

Princípio zero-trust: TODA ação do jogador deve passar pelo worldEngine antes de persistir no Firebase.
O cliente NUNCA escreve diretamente em coleções de estado de jogo (posição, HP, itens, etc.).
```

---

# BLOCO 1 — Firebase Rules: Autenticação obrigatória

```
Corrigir o arquivo md/firebase.rules.json.

PROBLEMA: As rules atuais permitem que qualquer pessoa na internet escreva em online_players,
players_data, player_actions, accounts, world_state e world_tiles sem estar autenticada.
Um atacante pode modificar HP, posição e inventário de qualquer jogador.

FAZER:

1. Em online_players/$playerId: substituir ".write": true por:
   ".write": "auth != null && auth.uid === $playerId"

2. Em players_data/$playerId: substituir ".write": true por:
   ".write": "auth != null && auth.uid === $playerId"

3. Em player_actions/$actionId: adicionar regra que garante que o playerId da ação
   corresponde ao auth.uid do requisitante:
   ".write": "auth != null && (!newData.child('playerId').exists() || newData.child('playerId').val() === auth.uid)"

4. Em world_entities/$monsterId: substituir ".write": true por:
   ".write": "auth != null"
   (apenas usuários autenticados podem escrever — o worldEngine usa firebase-admin que bypassa rules)

5. Em world_effects/$effectId: mesma regra — ".write": "auth != null"

6. Em world_fields/$fieldId: mesma regra — ".write": "auth != null"

7. Em world_state: substituir ".write": true por ".write": "auth != null"

8. Em monster_templates: substituir ".write": true por ".write": "auth != null"

9. Em world_tiles e world_tiles_data: substituir ".write": true por ".write": "auth != null"

10. Em accounts/$accountId: substituir ".write": true por:
    ".write": "auth != null && auth.uid === $accountId"
    Também bloquear campos sensíveis — adicionar validação explícita:
    "isAdmin": { ".validate": "false" }
    "isGM": { ".validate": "false" }
    "role": { ".validate": "newData.val() === 'player'" }

11. Adicionar no nó online_players/$playerId uma validação para impedir campos de bypass:
    "isAdmin": { ".validate": "false" }
    "isGM": { ".validate": "false" }
    "role": { ".validate": "false" }
    "appearance": {
      "isAdmin": { ".validate": "false" },
      "$other": { ".validate": true }
    }

12. Em world_items/$itemId: substituir ".write": true (se existir) por ".write": "auth != null"
    E adicionar validação explícita para bloquear o campo skipRangeCheck vindo de clientes:
    "skipRangeCheck": { ".validate": "false" }

Manter ".read": true em todos os nós que já tinham (o jogo precisa de leitura pública para funcionar).
Preservar todas as validações de tipo/range já existentes (x, y, z, hp, etc.) — apenas adicionar as novas.
```

---

# BLOCO 2 — Firebase Auth: Substituir login manual por Firebase Authentication

```
PROBLEMA: O sistema atual armazena senhas em plaintext no Firebase (campo "pass" em accounts/).
Isso expõe as credenciais de todos os jogadores a qualquer pessoa com acesso ao banco.
Além disso, não há token de autenticação real — qualquer um pode forjar um userId.

FAZER em src/core/firebaseClient.js:

1. Adicionar imports do Firebase Auth:
   import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
            signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";

2. Exportar a instância auth:
   export const auth = getAuth(app);

3. Exportar funções de auth:
   export async function authSignIn(email, password) {
     const cred = await signInWithEmailAndPassword(auth, email, password);
     return cred.user;
   }
   export async function authSignOut() {
     return signOut(auth);
   }
   export function onAuthChange(callback) {
     return onAuthStateChanged(auth, callback);
   }
   export function getCurrentUser() {
     return auth.currentUser;
   }

FAZER em rpg.html:

4. Substituir o bloco de login que usa findAccountByEmail + account.pass por:
   - Importar authSignIn, onAuthChange de ./src/core/firebaseClient.js
   - No submit do auth-form, chamar authSignIn(email, pass) em vez de findAccountByEmail
   - O uid do jogador passa a ser user.uid (do Firebase Auth) em vez de account.uuid
   - Manter a busca em players_data/ pelo uid para carregar personagens
   - Remover a comparação account.pass !== pass

5. Onde atualmente é definido: const uid = _currentAccount.uuid
   Substituir por: const uid = auth.currentUser?.uid

FAZER em admin.html:

6. Adicionar verificação de autenticação no boot:
   - Importar onAuthChange, getCurrentUser de ./src/core/firebaseClient.js
   - Antes de inicializar o engine, verificar if (!getCurrentUser()) { /* redirecionar para login */ return; }
   - Adicionar um overlay de login simples (email + senha) antes do painel GM aparecer
   - Adicionar verificação se o usuário tem role de admin em players_data/{uid}/role === "admin"
   - Se não for admin, mostrar mensagem de acesso negado

NOTA: NÃO remover o nó accounts/ do Firebase ainda — manter compatibilidade.
Apenas parar de armazenar e comparar senhas no cliente. O Firebase Auth cuida disso.
```

---

# BLOCO 3 — Zero-Trust: Mover movimentação para o worldEngine

```
PROBLEMA CRÍTICO: handlePlayerSync em src/gameplay/playerManager.js escreve a posição
do jogador DIRETAMENTE no Firebase sem nenhuma validação do worldEngine.
Isso permite speed hack, teleporte e atravessar paredes.

FAZER:

1. Em src/core/db.js, adicionar a função watchPlayerActions se ainda não existir,
   e garantir que existe deletePlayerAction(actionId) e deletePlayerActions(ids[]).

2. Em src/gameplay/actionProcessor.js, adicionar o case "move" no switch de _dispatch:

   case "move":
     return _processMove(normalizedAction, player, now);

3. Implementar a função _processMove em src/gameplay/actionProcessor.js:

   async function _processMove(action, player, now) {
     const { playerId, x, y, z, direcao } = action;

     // Validação de cooldown de movimento (evita speed hack)
     const speedMs = Math.max(100, Math.floor(40000 / (player.speed ?? 120)));
     if (_isOnCooldown(playerId, "move")) return;
     _setCooldown(playerId, "move", speedMs);

     // Validação: movimento máximo de 1 tile por vez
     const dx = Math.abs(x - (player.x ?? 0));
     const dy = Math.abs(y - (player.y ?? 0));
     if (dx > 1 || dy > 1) {
       pushLog("error", `[${player.name}] movimento inválido: delta (${dx},${dy})`);
       return;
     }

     // Validação: mesmo floor (z)
     if (z !== undefined && Math.abs(z - (player.z ?? 7)) > 1) {
       pushLog("error", `[${player.name}] mudança de andar inválida`);
       return;
     }

     // Persiste a nova posição atomicamente
     await batchWrite({
       [`${PATHS.playerData(playerId)}/x`]: x,
       [`${PATHS.playerData(playerId)}/y`]: y,
       [`${PATHS.playerData(playerId)}/z`]: z ?? player.z ?? 7,
       [`${PATHS.playerData(playerId)}/direcao`]: direcao ?? "frente",
       [`${PATHS.player(playerId)}/x`]: x,
       [`${PATHS.player(playerId)}/y`]: y,
       [`${PATHS.player(playerId)}/z`]: z ?? player.z ?? 7,
       [`${PATHS.player(playerId)}/direcao`]: direcao ?? "frente",
       [`${PATHS.player(playerId)}/lastMoveTime`]: now,
     });
   }

4. Em rpg.html, localizar o callback onPlayerMove (linha ~3346) e substituir o
   handlePlayerSync direto por um envio de ação via player_actions:

   onPlayerMove: async (nx, ny, nz, dir) => {
     if (nx !== myPos.x || ny !== myPos.y || dir !== myPos.direcao) {
       // Optimistic update local (UI responsiva)
       myPos.oldX = myPos.x; myPos.oldY = myPos.y;
       myPos.x = nx; myPos.y = ny; myPos.z = nz; myPos.direcao = dir;
       myPos.lastMoveTime = Date.now();

       // Enviar para validação pelo worldEngine
       const actionId = `${uid}_move_${Date.now()}`;
       await dbSet(`${PATHS.actions}/${actionId}`, {
         id: actionId, playerId: uid, type: "move",
         x: nx, y: ny, z: nz, direcao: dir,
         ts: Date.now(), expiresAt: Date.now() + 5000,
       });

       pushLog("rpg", "move", `${myPos.name} → ${nx},${ny} [${dir}]`);
     }
   }

5. Em src/gameplay/playerManager.js, marcar a função handlePlayerSync como @deprecated
   e adicionar um comentário explicando que ela deve ser usada APENAS pelo worldEngine,
   nunca diretamente pelo cliente.
```

---

# BLOCO 4 — Zero-Trust: Remover dbSet de world_items do cliente

```
PROBLEMA: Em rpg.html (linha ~2730) e em src/clients/world-engine/boot/initializer.js (linha ~799),
o cliente faz dbSet("world_items/...") diretamente no Firebase para converter tiles do mapa em itens.
Isso bypassa completamente o worldEngine e permite duplicação de itens.

FAZER:

1. Em src/gameplay/actionProcessor.js, adicionar o case "map_tile_pickup" no switch de _dispatch:

   case "map_tile_pickup":
     return _processMapTilePickup(normalizedAction, player, now);

2. Implementar _processMapTilePickup:

   async function _processMapTilePickup(action, player, now) {
     const { playerId, coord, tileId, mapLayer } = action;
     if (!coord || !tileId || mapLayer == null) return;

     const [tx, ty, tz] = String(coord).split(",").map(Number);
     if (isNaN(tx) || isNaN(ty) || isNaN(tz)) return;

     // Valida distância (player deve estar adjacente ao tile)
     const dist = Math.max(Math.abs(tx - player.x), Math.abs(ty - player.y));
     if (dist > 1 || tz !== player.z) {
       pushLog("error", `[${player.name}] tentou pegar tile fora de alcance`);
       return;
     }

     const tempId = `maptile_${String(coord).replace(/,/g, "_")}_${tileId}_${now}`;
     await batchWrite({
       [`world_items/${tempId}`]: {
         id: tempId, tileId: Number(tileId),
         x: tx, y: ty, z: tz,
         type: "material", quantity: 1, stackable: false,
         fromMap: true, sourceCoord: coord,
         sourceLayer: Number(mapLayer), sourceTileId: Number(tileId),
         skipRangeCheck: false,
         expiresAt: now + 60_000,
       },
     });
   }

3. No rpg.html, localizar os dois blocos que fazem dbSet("world_items/...") e substituir por:

   // Em vez de: await dbSet(`world_items/${tempId}`, { ... })
   // Usar:
   const actionId = `${uid}_map_tile_pickup_${Date.now()}`;
   await dbSet(`${PATHS.actions}/${actionId}`, {
     id: actionId, playerId: uid, type: "map_tile_pickup",
     coord, tileId, mapLayer,
     ts: Date.now(), expiresAt: Date.now() + 5000,
   });
   // Aguardar o worldEngine processar antes de continuar
   await new Promise(resolve => setTimeout(resolve, 150));

4. No src/clients/world-engine/boot/initializer.js, fazer o mesmo — substituir o dbSet direto
   pelo envio de ação via player_actions.

5. No firebase.rules.json, confirmar que world_items tem a validação:
   "skipRangeCheck": { ".validate": "false" }
   (adicionada no Bloco 1 — verificar se foi aplicada)
```

---

# BLOCO 5 — Zero-Trust: Implementar toggle_door e change_floor no actionProcessor

```
PROBLEMA: As ações toggle_door e change_floor são geradas pelo cliente mas NÃO têm
case no switch do actionProcessor.js — elas caem no default (console.warn) e são
descartadas. O resultado: portas abrem/fecham localmente mas nunca persistem no servidor.

FAZER em src/gameplay/actionProcessor.js:

1. No switch de _dispatch, adicionar os novos cases:
   case "toggle_door":
     return _processToggleDoor(normalizedAction, player, now);
   case "change_floor":
     return _processChangeFloor(normalizedAction, player, now);

2. Implementar _processToggleDoor:

   async function _processToggleDoor(action, player, now) {
     const { playerId, target, fromId, toId } = action;
     if (!target || fromId == null || toId == null) return;

     // Valida distância (player deve estar adjacente à porta)
     const dist = Math.max(Math.abs(target.x - player.x), Math.abs(target.y - player.y));
     if (dist > 1 || target.z !== player.z) {
       pushLog("error", `[${player.name}] porta fora de alcance`);
       return;
     }

     // Cooldown para evitar spam
     if (_isOnCooldown(playerId, "toggle_door")) return;
     _setCooldown(playerId, "toggle_door", 500);

     // Persiste a troca no mapa (world_tiles)
     const { x, y, z } = target;
     const cx = Math.floor(x / 10);
     const cy = Math.floor(y / 10);
     const chunkPath = `world_tiles/${z}/${cx},${cy}`;

     const chunkData = await batchWrite({
       // Não temos acesso direto ao tile aqui, então emitimos evento para o
       // worldEngine aplicar no próximo tick via worldState.map
     });

     // Emite evento para todos os clientes atualizarem o tile
     worldEvents.emit(EVENT_TYPES.DOOR_TOGGLED, {
       x, y, z, fromId, toId, playerId, timestamp: now,
     });

     pushLog("system", `[${player.name}] ${fromId === action.fromId ? "abriu" : "fechou"} porta em ${x},${y}`);
   }

3. Implementar _processChangeFloor:

   async function _processChangeFloor(action, player, now) {
     const { playerId, fromZ, toZ } = action;
     if (fromZ == null || toZ == null) return;

     // Valida que é um delta de exatamente 1 andar
     if (Math.abs(toZ - fromZ) !== 1) {
       pushLog("error", `[${player.name}] mudança de andar inválida: ${fromZ} → ${toZ}`);
       return;
     }

     // Cooldown
     if (_isOnCooldown(playerId, "change_floor")) return;
     _setCooldown(playerId, "change_floor", 600);

     // Persiste nova posição com novo Z
     await batchWrite({
       [`${PATHS.playerData(playerId)}/z`]: toZ,
       [`${PATHS.player(playerId)}/z`]: toZ,
       [`${PATHS.player(playerId)}/lastMoveTime`]: now,
     });

     pushLog("system", `[${player.name}] mudou de andar: Z${fromZ} → Z${toZ}`);
   }

4. No firebase.rules.json, adicionar em player_actions:
   "type": { ".validate": "newData.isString() && newData.val().matches(/^(attack|spell|move|item|map_tile_pickup|toggle_door|change_floor|allocateStat)$/)" }
   (substitui a validação atual que só aceita attack|spell)
```

---

# BLOCO 6 — Zero-Trust: Corrigir actionConfigLoader (dano/cura/teleporte sem persistência)

```
PROBLEMA: Os métodos applyDamage, applyHeal e teleportTo em src/core/actionConfigLoader.js
modificam apenas o objeto player em memória. Nunca chamam batchWrite nem handlePlayerSync.
Isso faz com que as recompensas educacionais (notas, frequência) sejam perdidas no reload.

FAZER em src/core/actionConfigLoader.js:

1. Adicionar imports no topo do arquivo:
   import { batchWrite, PATHS } from "./db.js";
   import { worldEvents, EVENT_TYPES } from "./events.js";

2. Substituir o método applyDamage por uma versão que persiste:

   applyDamage(player, amount, type) {
     const currentHp = player.stats?.hp ?? 100;
     const newHp = Math.max(0, currentHp - amount);
     if (player.stats) player.stats.hp = newHp;

     // Persistir no Firebase se tiver playerId
     if (player.id) {
       batchWrite({
         [`${PATHS.playerDataStats(player.id)}/hp`]: newHp,
         [`${PATHS.playerStats(player.id)}/hp`]: newHp,
       }).catch(err => console.error("[ActionEffect] Erro ao salvar dano:", err));
     }

     worldEvents.emit(EVENT_TYPES.DAMAGE_TAKEN, { playerId: player.id, amount, type, newHp });
   }

3. Substituir o método applyHeal por uma versão que persiste:

   applyHeal(player, amount) {
     const currentHp = player.stats?.hp ?? 100;
     const maxHp = player.stats?.maxHp ?? 100;
     const newHp = Math.min(maxHp, currentHp + amount);
     if (player.stats) player.stats.hp = newHp;

     if (player.id) {
       batchWrite({
         [`${PATHS.playerDataStats(player.id)}/hp`]: newHp,
         [`${PATHS.playerStats(player.id)}/hp`]: newHp,
       }).catch(err => console.error("[ActionEffect] Erro ao salvar cura:", err));
     }

     worldEvents.emit(EVENT_TYPES.HEAL_RECEIVED, { playerId: player.id, amount, newHp });
   }

4. Substituir o bloco teleportTo no método applyEffects por uma versão que persiste:

   if (effects.teleportTo) {
     const { x, y, z } = effects.teleportTo;
     player.x = x; player.y = y; player.z = z ?? player.z;

     if (player.id) {
       batchWrite({
         [`${PATHS.playerData(player.id)}/x`]: x,
         [`${PATHS.playerData(player.id)}/y`]: y,
         [`${PATHS.playerData(player.id)}/z`]: z ?? player.z,
         [`${PATHS.player(player.id)}/x`]: x,
         [`${PATHS.player(player.id)}/y`]: y,
         [`${PATHS.player(player.id)}/z`]: z ?? player.z,
       }).catch(err => console.error("[ActionEffect] Erro ao salvar teleporte:", err));
     }
   }

5. Fazer o mesmo para o bloco floorChange:

   if (effects.floorChange) {
     const newZ = (player.z ?? 7) + effects.floorChange;
     player.z = newZ;

     if (player.id) {
       batchWrite({
         [`${PATHS.playerData(player.id)}/z`]: newZ,
         [`${PATHS.player(player.id)}/z`]: newZ,
       }).catch(err => console.error("[ActionEffect] Erro ao salvar floorChange:", err));
     }
   }
```

---

# BLOCO 7 — Duplicatas: Consolidar funções duplicadas

```
PROBLEMA: Existem 6 funções com o mesmo nome em arquivos diferentes.
A mais perigosa é isTileWalkable, que tem assinaturas DIFERENTES nos dois arquivos
e pode causar bug silencioso se alguém importar a errada.

FAZER:

1. REMOVER isTileWalkable de src/gameplay/combatLogic.js (linha ~300).
   A versão canônica é src/core/collision.js — ela recebe (x, y, z, worldTiles, nexoData).
   Verificar se combatLogic.js usa internamente a sua própria versão e, se sim,
   substituir os usos pela import de collision.js:
   import { isTileWalkable } from "../core/collision.js";

2. REMOVER calculateStepDuration de src/clients/shared/initRPGPlayerActions.js (linha ~736).
   Ela é idêntica à de src/gameplay/gameCore.js. Substituir por import:
   import { calculateStepDuration } from "../../gameplay/gameCore.js";

3. REMOVER getDirectionFromDelta de src/clients/shared/initRPGPlayerActions.js (linha ~725).
   Ela é idêntica à de src/gameplay/combatLogic.js. Substituir por import:
   import { getDirectionFromDelta } from "../../gameplay/combatLogic.js";

4. REMOVER getActionCursor de src/clients/shared/initRPGPlayerActions.js (linha ~744).
   A versão canônica é src/core/playerAction.js. Substituir por import:
   import { getActionCursor } from "../../core/playerAction.js";

5. REMOVER a função clamp de src/core/db.js.
   Substituir os usos internos de clamp(value, min, max) em db.js por:
   Math.max(min, Math.min(max, value))
   (é uma one-liner, não precisa de import de outro arquivo)

6. Renomear _setCooldown de src/gameplay/spellEngine.js para _setSpellCooldown
   para evitar conflito de nome com a função homônima em actionProcessor.js.
   Atualizar os usos internos em spellEngine.js.

7. Após cada remoção, verificar que não há outros arquivos que importavam
   a versão removida (fazer grep pelo nome da função + nome do arquivo removido).
```

---

# BLOCO 8 — Memory Leak: Adicionar cleanup ao worldStore

```
PROBLEMA: src/core/worldStore.js registra 6 watchers Firebase em initWorldStore()
mas não existe nenhuma função para cancelá-los. Em hot-reload ou reconexão,
os listeners acumulam e cada snapshot do Firebase é processado N vezes.

FAZER em src/core/worldStore.js:

1. Criar um array para guardar os unsubs no topo do módulo (junto com as outras variáveis de estado):
   const _watchers = [];

2. Em initWorldStore(), capturar os retornos dos watchers:
   _watchers.push(watchMonsters((data) => { ... }));
   _watchers.push(watchPlayers((data) => { ... }));
   _watchers.push(watchEffectsChildren({ onAdd: ..., onRemove: ..., onChange: ... }));
   _watchers.push(watchFields((data) => { ... }));
   _watchers.push(watchMonsterTemplates((data) => { ... }));
   _watchers.push(watchChat((msg) => { ... }));

3. Exportar uma função destroyWorldStore():
   export function destroyWorldStore() {
     _watchers.forEach(unsub => { try { unsub(); } catch(e) {} });
     _watchers.length = 0;
     initialized = false;
     state.monsters = {};
     state.players = {};
     state.effects = {};
     state.fields = {};
     state.chat = [];
   }

4. Em src/clients/world-engine/engine/worldTick.js, no método stop() da classe WorldTick,
   adicionar chamada ao destroyWorldStore:
   import { destroyWorldStore } from "../../../core/worldStore.js";
   stop() {
     if (this._timer) clearInterval(this._timer);
     this._timer = null;
     destroyWorldStore();
   }

5. Verificar se dbWatchChildren em src/core/firebaseClient.js já retorna um unsub
   que cancela todos os child listeners — se não, corrigir para retornar:
   return () => unsubs.forEach(u => u());
   (provavelmente já está correto, só confirmar)
```

---

# BLOCO 9 — Memory Leak: Limitar tamanho dos caches de render

```
PROBLEMA: src/render/mapRenderer.js mantém 5 Maps de cache sem limite de tamanho.
Em sessões longas em mapas grandes, esses Maps crescem indefinidamente consumindo RAM.

FAZER em src/render/mapRenderer.js:

1. Criar uma função utilitária de LRU simples no topo do arquivo (após os imports):

   function _boundedMap(maxSize = 2000) {
     const m = new Map();
     return {
       get: (k) => m.get(k),
       set: (k, v) => {
         if (m.size >= maxSize) m.delete(m.keys().next().value);
         m.set(k, v);
       },
       has: (k) => m.has(k),
       delete: (k) => m.delete(k),
       clear: () => m.clear(),
       get size() { return m.size; },
     };
   }

2. Substituir as declarações dos caches:
   // De:
   const _variantCache = new Map();
   const _sortedKeysCache = new Map();
   const _spriteCategoryCache = new Map();
   const _spriteElevationCache = new Map();
   const _anyVariantLookupCache = new Map();

   // Para:
   const _variantCache = _boundedMap(5000);
   const _sortedKeysCache = _boundedMap(3000);
   const _spriteCategoryCache = _boundedMap(2000);
   const _spriteElevationCache = _boundedMap(2000);
   const _anyVariantLookupCache = _boundedMap(2000);

3. Exportar uma função clearRenderCaches() para uso em troca de mapa:
   export function clearRenderCaches() {
     _variantCache.clear();
     _sortedKeysCache.clear();
     _spriteCategoryCache.clear();
     _spriteElevationCache.clear();
     _anyVariantLookupCache.clear();
   }
```

---

# BLOCO 10 — Performance: Sistema de debug flags (desativar console.log)

```
PROBLEMA: Existem 154 console.log ativos no projeto, incluindo 29 dentro do handler
de movimento (initRPGPlayerActions.js). Em produção isso degrada performance
e polui o console, dificultando diagnóstico de erros reais.

FAZER:

1. Criar o arquivo src/core/logger.js:

   // logger.js — sistema de log com níveis e flag de debug
   const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

   const _config = {
     level: typeof window !== "undefined" && window.RPG_DEBUG ? "debug" : "warn",
     prefix: "[RPG]",
   };

   function _log(level, ...args) {
     if (LEVELS[level] > LEVELS[_config.level]) return;
     const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
     fn(`${_config.prefix}[${level.toUpperCase()}]`, ...args);
   }

   export const logger = {
     error: (...a) => _log("error", ...a),
     warn:  (...a) => _log("warn", ...a),
     info:  (...a) => _log("info", ...a),
     debug: (...a) => _log("debug", ...a),
     setLevel: (l) => { _config.level = l; },
   };

   // Ativar debug no console do browser: window.RPG_DEBUG = true; location.reload();

2. Em src/clients/shared/initRPGPlayerActions.js, substituir TODOS os console.log por:
   import { logger } from "../../core/logger.js";
   // console.log("...") → logger.debug("...")
   // console.warn("...") → logger.warn("...")
   Prioridade: os 29 console.log dentro de handleClick, handlePointerDown, handlePointerUp,
   executeWalkTo e nextStep são os mais críticos pois disparam a cada movimento.

3. Em src/clients/world-engine/boot/initPlayerActions.js, mesmo procedimento (19 console.log).

4. Em src/core/actionConfigLoader.js, mesmo procedimento (16 console.log).

5. Em src/clients/world-engine/boot/assetLoader.js, mesmo procedimento (11 console.log).

6. Para os demais arquivos (monsterManager, defaultActions, progressionSystem, etc.),
   substituir console.log por logger.debug e console.warn por logger.warn.

7. Em rpg.html, adicionar no início do script principal:
   window.RPG_DEBUG = false; // Mude para true no console para ativar logs de debug
```

---

# BLOCO 11 — Performance: Corrigir duplo registro de eventos de pointer

```
PROBLEMA: Em src/clients/shared/initRPGPlayerActions.js, os eventos pointerdown e
pointerup são registrados tanto no document quanto no canvas (capturing phase).
Isso faz cada clique disparar o handler DUAS VEZES.

FAZER em src/clients/shared/initRPGPlayerActions.js:

1. Localizar a função setupRPGInputHandler.
   Encontrar os 4 addEventListener de pointerdown/pointerup:
   document.addEventListener("pointerdown", handlePointerDown, true);
   document.addEventListener("pointerup", handlePointerUp, true);
   canvas.addEventListener("pointerdown", handlePointerDown, true);
   canvas.addEventListener("pointerup", handlePointerUp, true);

2. REMOVER os dois registros no document (manter apenas os do canvas):
   // REMOVER estas linhas:
   // document.addEventListener("pointerdown", handlePointerDown, true);
   // document.addEventListener("pointerup", handlePointerUp, true);

3. Na função cleanupRPGPlayerActions, REMOVER as chamadas de removeEventListener
   correspondentes ao document (as que foram removidas no passo 2).

4. Verificar se a funcionalidade de drag ainda funciona corretamente após a mudança
   (o drag usa a classe "item-dragging" no body, que não depende dos listeners do document).
```

---

# BLOCO 12 — Performance: Corrigir BUFF/DEBUFF que usa setTimeout para reverter

```
PROBLEMA: Em src/gameplay/actionProcessor.js, a função _processSpell para magias
do tipo BUFF usa setTimeout para reverter o efeito após a duração.
Se o worldEngine for reiniciado durante esse tempo, o timer some e o buff fica permanente.

FAZER em src/gameplay/actionProcessor.js:

1. Adicionar um Map para rastrear buffs ativos no topo do arquivo:
   const _activeBuffs = new Map(); // key: `${playerId}:${spellId}`, value: { expiresAt, stat, delta, playerId, targetType, targetId }

2. No case SPELL_TYPE.BUFF de _processSpell, substituir o setTimeout por:

   // Em vez de setTimeout, registrar o buff no Map com timestamp de expiração
   const buffKey = `${playerId}:${spellId}:${isSelf ? "self" : targetId}`;
   _activeBuffs.set(buffKey, {
     expiresAt: now + (spell.duration ?? 5000),
     stat, delta: -delta, // delta negativo para reverter
     playerId: isSelf ? playerId : null,
     targetType: isSelf ? "player" : "monster",
     targetId: isSelf ? playerId : targetId,
   });

3. No método _tick() da classe WorldTick em src/clients/world-engine/engine/worldTick.js,
   adicionar chamada para processar buffs expirados:
   import { tickExpiredBuffs } from "../../../gameplay/actionProcessor.js";
   // No _tick():
   await tickExpiredBuffs(now);

4. Exportar a função tickExpiredBuffs em actionProcessor.js:

   export async function tickExpiredBuffs(now) {
     for (const [key, buff] of _activeBuffs.entries()) {
       if (now < buff.expiresAt) continue;
       _activeBuffs.delete(key);

       const updates = {};
       if (buff.targetType === "player") {
         const player = getPlayers()?.[buff.targetId];
         if (!player) continue;
         const current = player.stats?.[buff.stat] ?? 0;
         const reverted = current + buff.delta;
         updates[`${PATHS.playerDataStats(buff.targetId)}/${buff.stat}`] = reverted;
         updates[`${PATHS.playerStats(buff.targetId)}/${buff.stat}`] = reverted;
       } else {
         const monsters = getMonsters();
         const mob = monsters?.[buff.targetId];
         if (!mob) continue;
         const current = mob.stats?.[buff.stat] ?? 0;
         updates[`world_entities/${buff.targetId}/stats/${buff.stat}`] = current + buff.delta;
       }
       if (Object.keys(updates).length > 0) await batchWrite(updates);
     }
   }
```

---

# BLOCO 13 — Limpeza: Remover/documentar código morto

```
PROBLEMA: Existem arquivos e funções sem uso real que aumentam o tamanho do projeto
e confundem quem lê o código.

FAZER:

1. Em src/server/worldEngine/WorldEngineServer.js:
   Adicionar no topo do arquivo um comentário de status claro:
   /**
    * ESQUELETO — Não funcional ainda.
    * Este arquivo é a preparação para a migração do worldEngine.html para Node.js.
    * Para ativar: descomentar os imports de firebase-admin, express, ws
    * e executar: npm install firebase-admin express ws
    * Status: aguardando migração do worldEngine.html (Fase 3 do roadmap)
    */

2. Em src/gameplay/combatEngine.js:
   A função applyDamage está marcada como "legado/admin" — adicionar @deprecated:
   /**
    * @deprecated Use combatService.applyPlayerDamage() para novo código.
    * Mantida apenas para compatibilidade com admin.html.
    */

3. Em src/gameplay/gameCore.js:
   As funções drawMap, processRenderFrame e renderGameFrame estão marcadas como "legado".
   Verificar se ainda são importadas em algum lugar.
   Se não forem usadas, adicionar @deprecated em cada uma.
   Se forem usadas apenas por admin.html, documentar isso no JSDoc.

4. Remover os arquivos desktop.ini do repositório — são arquivos gerados pelo Windows Explorer
   que não pertencem a um repositório de código:
   Criar/atualizar .gitignore na raiz com:
   desktop.ini
   Thumbs.db
   .DS_Store

5. Em src/gameplay/playerManager.js:
   Remover comentários de imports removidos (linhas com "// ❌ REMOVIDO:") —
   eles já foram removidos e os comentários só poluem o arquivo.
   Fazer o mesmo em src/gameplay/gameCore.js e src/gameplay/monsterManager.js.
```

---

# BLOCO 14 — Verificação final

```
Após aplicar todos os blocos anteriores, executar esta verificação final:

1. SECURITY CHECK — confirmar que não existe mais nenhum acesso direto ao Firebase
   de fora do worldEngine/actionProcessor:

   grep -rn "dbSet\|dbUpdate\|batchWrite\|set(ref\|update(ref" src/clients/ rpg.html admin.html

   O resultado esperado são APENAS:
   - Leituras (dbGet, dbWatch) — OK para o cliente
   - O worldEngineShim em initializer.js (que envia para player_actions — OK)
   - Zero chamadas diretas de escrita de estado de jogo

2. DUPLICATE CHECK — confirmar que não existe mais isTileWalkable duplicado:

   grep -rn "export function isTileWalkable\|export const isTileWalkable" src/

   Resultado esperado: apenas uma ocorrência (em src/core/collision.js)

3. CONSOLE CHECK — confirmar que os console.log foram substituídos nos arquivos críticos:

   grep -c "console\.log" src/clients/shared/initRPGPlayerActions.js

   Resultado esperado: 0 (ou próximo de 0, apenas console.error para erros críticos)

4. WATCHER LEAK CHECK — confirmar que destroyWorldStore existe:

   grep -n "destroyWorldStore" src/core/worldStore.js

   Resultado esperado: pelo menos 2 ocorrências (definição + export)

5. AUTH CHECK — confirmar que admin.html tem verificação de auth:

   grep -n "getCurrentUser\|onAuthChange\|auth\." admin.html

   Resultado esperado: pelo menos 3 ocorrências

6. Testar o jogo no browser e confirmar que:
   - Login funciona via Firebase Auth
   - Movimento sincroniza corretamente para outros jogadores
   - Portas abrem/fecham e persistem após reload
   - Itens do mapa podem ser coletados
   - Admin.html exige login antes de mostrar o painel
```

---

## NOTAS IMPORTANTES PARA O CLAUDE CODE

- **Não reescreva arquivos inteiros** — use edits cirúrgicos. Cada bloco afeta apenas os trechos descritos.
- **Preserve imports existentes** — apenas adicione os novos quando indicado.
- **Após cada bloco**, teste no browser se o jogo ainda carrega antes de passar ao próximo.
- **Firebase Rules** (Bloco 1) devem ser aplicadas no Console do Firebase, não apenas no arquivo local.
- **Firebase Auth** (Bloco 2) requer que o projeto tenha Authentication habilitado no Console Firebase com o provider Email/Senha ativo.
- A **ordem dos blocos importa**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14.
- Os Blocos 7–13 podem ser executados em qualquer ordem entre si, mas devem vir depois dos Blocos 1–6.
