# Fix — Teleporte ao clicar múltiplas vezes (Walk Sequencing)

## Diagnóstico

**Raiz do problema:** cada chamada a `executeWalkTo()` cria uma closure `nextStep` com
um `setTimeout` recursivo independente. Nenhuma referência é guardada e não existe
mecanismo de cancelamento. Com dois cliques rápidos, duas closures rodam em paralelo,
cada uma chamando `onPlayerMove` com coordenadas de paths diferentes. O Firebase recebe
dois streams de `move` actions intercalados, e o worldEngine aprova passos válidos de
ambos em ordem imprevisível — resultado: o player teleporta.

**Comparação com o OTClient:** quando você clica em B durante um walk para A,
`autoWalk(B)` começa zerando `m_autoWalkDestination`, cancelando o evento agendado
`m_autoWalkContinueEvent` e limpando o deque `m_preWalks`. O callback assíncrono
do pathfinder verifica `m_autoWalkDestination != result->destination` e descarta o
resultado de A. Nenhuma closure do walk anterior sobrevive.

---

## O que muda e onde

| Arquivo                                      | Mudança                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/clients/shared/initRPGPlayerActions.js` | Adicionar `_walkGeneration` no escopo de `setupRPGInputHandler`; modificar `executeWalkTo`; modificar `handleClick` |
| `rpg.html`                                   | No callback `watchPlayerData`, registrar posição confirmada em `myPos._serverX/Y/Z`                                 |

---

## Arquivo 1 — `src/clients/shared/initRPGPlayerActions.js`

### Passo 1 — Adicionar variável de geração no `setupRPGInputHandler`

**Localizar** este bloco (começa por volta da linha 179):

```js
function setupRPGInputHandler({
  canvas,
  player,
  worldState,
  actionSystem,
  pathFinder,
  onPlayerMove,
  onPlayerAction,
}) {
  // Flag para detectar se veio de um drag
  let _wasDragging = false;
  let _dragTimeout = null;
  let _dragOrigin = null; // Posição onde o drag começou
  let _dragTarget = null; // Posição do tile sob o mouse no pointerdown
```

**Substituir** pelo bloco abaixo (adiciona as duas variáveis de walk no final do bloco de
declarações de estado):

```js
function setupRPGInputHandler({
  canvas,
  player,
  worldState,
  actionSystem,
  pathFinder,
  onPlayerMove,
  onPlayerAction,
}) {
  // Flag para detectar se veio de um drag
  let _wasDragging = false;
  let _dragTimeout = null;
  let _dragOrigin = null; // Posição onde o drag começou
  let _dragTarget = null; // Posição do tile sob o mouse no pointerdown

  // Walk sequencing — token de cancelamento (padrão OTClient m_autoWalkDestination).
  // Incrementado a cada novo walk. Cada closure nextStep aborta se a geração mudou.
  let _walkGeneration = 0;
```

---

### Passo 2 — Modificar `handleClick` para cancelar walk anterior

**Localizar** este trecho exato dentro de `handleClick` (por volta da linha 308):

```js
// Executa ação
if (action === PlayerAction.AUTOWALK_HIGHLIGHT || action === 4) {
  // Move para o tile clicado (ou origem do drag)
  executeWalkTo(
    player,
    targetTile,
    pathFinder,
    onPlayerMove,
    undefined,
    worldState,
  );
}
```

**Substituir** pelo bloco abaixo:

```js
// Executa ação
if (action === PlayerAction.AUTOWALK_HIGHLIGHT || action === 4) {
  // Incrementa a geração ANTES de iniciar o walk.
  // Isso invalida todas as closures nextStep de walks anteriores.
  // Equivalente ao reset de m_autoWalkDestination do OTClient.
  _walkGeneration++;
  executeWalkTo(
    player,
    targetTile,
    pathFinder,
    onPlayerMove,
    undefined,
    worldState,
    _walkGeneration,
  );
}
```

---

### Passo 3 — Modificar `executeWalkTo` para usar o token de cancelamento

**Localizar** a função completa (por volta da linha 413):

```js
function executeWalkTo(
  player,
  targetTile,
  pathFinder,
  onPlayerMove,
  onComplete,
  worldState,
) {
  const start = { x: player.x, y: player.y, z: player.z };
  const goal = targetTile;

  // Encontra caminho
  const result = pathFinder.findPath(start, goal);

  if (!result || result.path.length === 0) {
    logger.warn("[RPG PathFinder] Sem caminho para", goal);
    return;
  }

  // Segue o caminho passo a passo — começa em 1 para pular o nó de origem
  let stepIndex = 1;

  function nextStep() {
    if (stepIndex >= result.path.length) {
      logger.debug("[RPG Autowalk] Concluso!");
      // Callback ao finalizar
      if (onComplete) onComplete();
      return;
    }

    const nextPos = result.path[stepIndex];
    const direction = getDirectionFromDelta(
      nextPos.x - result.path[stepIndex - 1].x,
      nextPos.y - result.path[stepIndex - 1].y,
    );

    // Move player
    onPlayerMove(nextPos.x, nextPos.y, nextPos.z, direction);

    // Verifica efeito de tile (teleporte ou escada)
    const effect = resolveStepOnEffects(
      nextPos.x,
      nextPos.y,
      nextPos.z,
      worldState,
    );
    if (effect?.type === "teleport") {
      onPlayerMove(effect.dest.x, effect.dest.y, effect.dest.z, direction);
      logger.debug(
        `[TileEffects] Teleporte → (${effect.dest.x},${effect.dest.y},${effect.dest.z})`,
      );
      if (onComplete) onComplete();
      return; // interrompe o autowalk
    }
    if (effect?.type === "floor_change") {
      onPlayerMove(effect.newX, effect.newY, effect.newZ, direction);
      logger.debug(`[TileEffects] Mudança de andar → Z=${effect.newZ}`);
      if (onComplete) onComplete();
      return; // interrompe o autowalk
    }

    stepIndex++;

    // Próximo passo após delay
    const speed = player.speed ?? 100;
    const stepDuration = calculateStepDuration(speed);
    setTimeout(nextStep, stepDuration);
  }

  nextStep();
}
```

**Substituir** pela versão abaixo (mudanças: novo parâmetro `generation`; `start` usa
posição confirmada pelo servidor quando disponível; `nextStep` aborta se a geração mudou):

```js
function executeWalkTo(
  player,
  targetTile,
  pathFinder,
  onPlayerMove,
  onComplete,
  worldState,
  generation,
) {
  // Captura a geração desta closure. Se _walkGeneration mudar antes do próximo
  // setTimeout disparar, nextStep aborta silenciosamente.
  // Equivalente ao check m_autoWalkDestination != result->destination do OTClient.
  const myGeneration = generation ?? 0;

  // Usa a posição confirmada pelo servidor como origem do path quando disponível.
  // Evita calcular path a partir de uma posição optimista ainda não confirmada.
  // player._serverX/Y/Z é atualizado pelo watchPlayerData no rpg.html.
  const serverX = player._serverX ?? player.x;
  const serverY = player._serverY ?? player.y;
  const serverZ = player._serverZ ?? player.z;
  const start = { x: serverX, y: serverY, z: serverZ };
  const goal = targetTile;

  // Encontra caminho
  const result = pathFinder.findPath(start, goal);

  if (!result || result.path.length === 0) {
    logger.warn("[RPG PathFinder] Sem caminho para", goal);
    return;
  }

  // Segue o caminho passo a passo — começa em 1 para pular o nó de origem
  let stepIndex = 1;

  function nextStep() {
    // Aborta se outro clique iniciou um walk mais novo.
    // O incremento de _walkGeneration em handleClick é o mecanismo de cancelamento.
    if (
      typeof generation === "number" &&
      player._walkGeneration !== undefined &&
      player._walkGeneration !== myGeneration
    ) {
      logger.debug(
        "[RPG Autowalk] Walk cancelado — geração inválida:",
        myGeneration,
      );
      return;
    }

    if (stepIndex >= result.path.length) {
      logger.debug("[RPG Autowalk] Concluído!");
      if (onComplete) onComplete();
      return;
    }

    const nextPos = result.path[stepIndex];
    const direction = getDirectionFromDelta(
      nextPos.x - result.path[stepIndex - 1].x,
      nextPos.y - result.path[stepIndex - 1].y,
    );

    // Move player
    onPlayerMove(nextPos.x, nextPos.y, nextPos.z, direction);

    // Verifica efeito de tile (teleporte ou escada)
    const effect = resolveStepOnEffects(
      nextPos.x,
      nextPos.y,
      nextPos.z,
      worldState,
    );
    if (effect?.type === "teleport") {
      onPlayerMove(effect.dest.x, effect.dest.y, effect.dest.z, direction);
      logger.debug(
        `[TileEffects] Teleporte → (${effect.dest.x},${effect.dest.y},${effect.dest.z})`,
      );
      if (onComplete) onComplete();
      return;
    }
    if (effect?.type === "floor_change") {
      onPlayerMove(effect.newX, effect.newY, effect.newZ, direction);
      logger.debug(`[TileEffects] Mudança de andar → Z=${effect.newZ}`);
      if (onComplete) onComplete();
      return;
    }

    stepIndex++;

    const speed = player.speed ?? 100;
    const stepDuration = calculateStepDuration(speed);
    setTimeout(nextStep, stepDuration);
  }

  nextStep();
}
```

---

### Passo 4 — Propagar `_walkGeneration` para o objeto `player`

O check dentro de `nextStep` usa `player._walkGeneration` para comparar com a geração
capturada. Isso funciona porque `player` é passado por referência — quando
`_walkGeneration` é incrementado em `handleClick`, o valor precisa ser espelhado no
objeto `player` para que o `nextStep` de qualquer closure possa ler o valor atual.

**Localizar** o mesmo bloco do Passo 2, logo após a linha que incrementa `_walkGeneration`:

```js
      _walkGeneration++;
      executeWalkTo(
```

**Substituir** por:

```js
      _walkGeneration++;
      player._walkGeneration = _walkGeneration; // espelha no objeto para nextStep ler
      executeWalkTo(
```

---

## Arquivo 2 — `rpg.html`

### Passo 5 — Registrar posição confirmada pelo servidor

O `watchPlayerData` é o listener que recebe atualizações depois que o worldEngine
confirma a posição do player no Firebase. É o equivalente do `getServerPosition()` do
OTClient. Precisamos registrar essa posição em campos separados (`_serverX/Y/Z`) para
que `executeWalkTo` use como origem do path em vez da posição optimista.

**Localizar** este trecho dentro do callback `watchPlayerData` (por volta da linha 3199):

```js
if (serverData.appearance)
  myPos.appearance = _normalizeAppearance(serverData.appearance);
myPos.x = _numOr(serverData.x, myPos.x);
myPos.y = _numOr(serverData.y, myPos.y);
myPos.z = _numOr(serverData.z, myPos.z);
```

**Substituir** por:

```js
if (serverData.appearance)
  myPos.appearance = _normalizeAppearance(serverData.appearance);
myPos.x = _numOr(serverData.x, myPos.x);
myPos.y = _numOr(serverData.y, myPos.y);
myPos.z = _numOr(serverData.z, myPos.z);
// Registra posição confirmada pelo servidor — usada por executeWalkTo
// como origem do path (equivalente ao getServerPosition() do OTClient).
// Evita calcular path a partir de posições optimistas não confirmadas.
myPos._serverX = myPos.x;
myPos._serverY = myPos.y;
myPos._serverZ = myPos.z;
```

---

## Resumo das mudanças

```
initRPGPlayerActions.js
  setupRPGInputHandler()
    + let _walkGeneration = 0               ← novo estado
  handleClick()
    + _walkGeneration++                     ← cancela walk anterior
    + player._walkGeneration = _walkGeneration
    + passa _walkGeneration para executeWalkTo
  executeWalkTo()
    + parâmetro generation
    + usa player._serverX/Y/Z como start    ← posição confirmada
    + nextStep() checa player._walkGeneration !== myGeneration  ← aborta

rpg.html
  watchPlayerData callback
    + myPos._serverX = myPos.x              ← espelha posição confirmada
    + myPos._serverY = myPos.y
    + myPos._serverZ = myPos.z
```

---

## Por que os outros dois `executeWalkTo` não precisam do token

O `executeWalkTo` das linhas 118 e 518 são chamados por `handleItemOutOfReach` e
`executeFloorChange` respectivamente — não por clique direto do usuário. Eles têm
callbacks `onComplete` que executam a ação real (mover item, mudar andar) após o walk
terminar. Incluí-los no mesmo sistema de geração funcionaria, mas o comportamento
esperado é diferente: se o player clica numa escada e depois clica em outro tile, o
walk de proximidade da escada deve ser cancelado normalmente pelo `_walkGeneration++`
do novo clique — isso já acontece com o fix acima porque o incremento em `handleClick`
invalida qualquer closure ativa, incluindo a do `executeFloorChange`.

---

## Teste após aplicar

1. **Múltiplos cliques rápidos** em posições diferentes → player deve seguir apenas o
   último destino, sem teleportar.
2. **Clique durante walk em andamento** → walk atual para imediatamente, novo path
   calculado a partir da posição atual (ou da última confirmada pelo servidor).
3. **Clique em item fora de alcance** → player caminha até o item normalmente; clicar
   em outro tile durante esse walk cancela a aproximação.
4. **Subir/descer escada** → walk de proximidade segue normalmente; clicar em outro
   tile durante a aproximação à escada cancela e inicia walk para o novo destino.
