// =============================================================================
// monsterAI.js — mmoRPGGame
// Camada 3: Inteligência artificial dos monstros — lógica pura.
// REGRA: ZERO imports de Firebase, worldStore ou DOM.
//        Todas as funções recebem dados como parâmetro e retornam decisões.
//        O monsterManager lê estas decisões e aplica ao store/Firebase.
// Dependências: combatLogic.js (getDirectionFromDelta)
// =============================================================================

import { getDirectionFromDelta } from './combatLogic.js';
import { isPassableForMob, tileBlocksMissiles, tileBlocksSight } from '../core/collision.js';

// ---------------------------------------------------------------------------
// ADMIN_ID — ID reservado do GM, nunca alvo de monstros
// ---------------------------------------------------------------------------
const ADMIN_ID = 'GMADMIN';

// ---------------------------------------------------------------------------
// findTarget
// Encontra o jogador mais próximo dentro do alcance de agressão.
// Ignora o GM (ADMIN_ID) e jogadores em outro andar (z diferente).
//
// @param {object} mob     - entidade do monstro { x, y, z }
// @param {object} players - snapshot do store { [id]: playerData }
// @param {number} range   - alcance de aggro em tiles
// @returns {object|null}  - { ...playerData, id } ou null
// ---------------------------------------------------------------------------
export function findTarget(mob, players, range = 7) {
  let closest  = null;
  let minDist  = range;

  for (const pid in players) {
    const p = players[pid];
    if (!p || pid === ADMIN_ID)          continue;
    if ((p.z ?? 7) !== (mob.z ?? 7))    continue; // andar diferente

    const dist = Math.hypot(p.x - mob.x, p.y - mob.y);
    if (dist < minDist) {
      minDist  = dist;
      closest  = { ...p, id: pid };
    }
  }
  return closest;
}

// ---------------------------------------------------------------------------
// decideMove — moveTowards
// Calcula o próximo tile em direção a um destino (tx, ty).
// Retorna a decisão de movimento sem aplicar nada.
//
// @param {object} mob      - { x, y, z, direcao }
// @param {number} tx       - x alvo
// @param {number} ty       - y alvo
// @returns {{ nx, ny, direcao }} nova posição e direção
// ---------------------------------------------------------------------------
export function decideMoveTo(mob, tx, ty) {
  let nx  = Math.round(mob.x);
  let ny  = Math.round(mob.y);
  let dir = mob.direcao ?? 'frente';

  const dx = tx - nx;
  const dy = ty - ny;

  // Move no eixo de maior distância primeiro (pathfinding simples)
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx !== 0) {
      nx += Math.sign(dx);
      dir = getDirectionFromDelta(dx, 0);
    }
  } else {
    if (dy !== 0) {
      ny += Math.sign(dy);
      dir = getDirectionFromDelta(0, dy);
    }
  }

  return { nx, ny, direcao: dir };
}

// ---------------------------------------------------------------------------
// decideWander
// Decide um movimento aleatório (wandering) com 5% de chance de agir.
// Retorna null se o monstro decidir ficar parado.
//
// @param {object} mob - { x, y, z, direcao }
// @returns {{ nx, ny, direcao }|null}
// ---------------------------------------------------------------------------
export function decideWander(mob) {
  if (Math.random() > 0.05) return null; // 95% de chance de não mover

  const DIRS = [
    { dx:  1, dy:  0 },
    { dx: -1, dy:  0 },
    { dx:  0, dy:  1 },
    { dx:  0, dy: -1 },
  ];
  const m  = DIRS[Math.floor(Math.random() * DIRS.length)];
  const nx = Math.round(mob.x) + m.dx;
  const ny = Math.round(mob.y) + m.dy;

  return { nx, ny, direcao: getDirectionFromDelta(m.dx, m.dy) };
}

// ---------------------------------------------------------------------------
// _bresenham (interno)
// Itera os tiles INTERMEDIÁRIOS da linha entre (x0,y0) e (x1,y1).
// Chama checker(cx, cy) em cada tile; retorna false ao primeiro true do checker.
// ---------------------------------------------------------------------------
function _bresenham(x0, y0, x1, y1, checker) {
  let ddx = Math.abs(x1 - x0);
  let ddy = Math.abs(y1 - y0);
  let sx  = x0 < x1 ? 1 : -1;
  let sy  = y0 < y1 ? 1 : -1;
  let err = ddx - ddy;
  let cx  = x0;
  let cy  = y0;

  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -ddy) { err -= ddy; cx += sx; }
    if (e2 <  ddx) { err += ddx; cy += sy; }
    if (cx === x1 && cy === y1) break; // não verifica o tile destino
    if (checker(cx, cy)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// hasLineOfSight
// Linha de visão para aggro/targeting: verifica blocks_sight.
// Obstáculos (árvores, pedras) não bloqueiam visão — apenas paredes sólidas.
// ---------------------------------------------------------------------------
export function hasLineOfSight(x0, y0, x1, y1, z, worldTiles, nexoData) {
  return _bresenham(x0, y0, x1, y1,
    (cx, cy) => tileBlocksSight(cx, cy, z, worldTiles, nexoData));
}

// ---------------------------------------------------------------------------
// hasSpellLOS
// Linha de visão para projéteis e magias: verifica blocks_missiles.
// Obstáculos (category_type="obstacle") NÃO bloqueiam — magias passam por eles.
// Apenas paredes (category_type="wall", blocks_missiles=true) bloqueiam.
// ---------------------------------------------------------------------------
export function hasSpellLOS(x0, y0, x1, y1, z, worldTiles, nexoData) {
  return _bresenham(x0, y0, x1, y1,
    (cx, cy) => tileBlocksMissiles(cx, cy, z, worldTiles, nexoData));
}

// ---------------------------------------------------------------------------
// decideMoveBFS
// Encontra o próximo passo em direção a (tx, ty) usando BFS, contornando
// paredes. Ignora entidades no caminho (dinâmicas). Retorna null se não
// houver caminho dentro do raio máximo (→ modo wander).
//
// @param {object} mob
// @param {number} tx, ty     - coordenadas do alvo
// @param {number} z
// @param {object} map        - worldTiles
// @param {object} nexoData
// @returns {{ nx, ny, direcao }|null}
// ---------------------------------------------------------------------------
export function decideMoveBFS(mob, tx, ty, z, map, nexoData) {
  const sx = Math.round(mob.x);
  const sy = Math.round(mob.y);
  const gx = Math.round(tx);
  const gy = Math.round(ty);

  if (sx === gx && sy === gy) return null;

  const MAX_NODES = 250;
  const DIRS = [
    { dx:  1, dy:  0 },
    { dx: -1, dy:  0 },
    { dx:  0, dy:  1 },
    { dx:  0, dy: -1 },
  ];

  // { x, y, firstStep } — firstStep = {nx,ny,dx,dy} do 1º passo a partir da origem
  const queue    = [{ x: sx, y: sy, firstStep: null }];
  const visited  = new Set([`${sx},${sy}`]);
  let   expanded = 0;

  while (queue.length > 0 && expanded < MAX_NODES) {
    const { x, y, firstStep } = queue.shift();
    expanded++;

    for (const { dx, dy } of DIRS) {
      const nx  = x + dx;
      const ny  = y + dy;
      const key = `${nx},${ny}`;

      if (visited.has(key)) continue;
      visited.add(key);

      // Parede ou terreno impassável (água/lava/custo>=500) → ignora este ramo
      if (!isPassableForMob(nx, ny, z, map, nexoData)) continue;

      const step = firstStep ?? { nx, ny, dx, dy };

      if (nx === gx && ny === gy) {
        return { nx: step.nx, ny: step.ny, direcao: getDirectionFromDelta(step.dx, step.dy) };
      }

      queue.push({ x: nx, y: ny, firstStep: step });
    }
  }

  return null; // sem caminho → wander
}

// ---------------------------------------------------------------------------
// isTileBlocked
// Verifica se um tile está bloqueado por mapa, monstro ou jogador.
// Recebe todos os dados como parâmetro — não lê do store diretamente.
//
// @param {number} x
// @param {number} y
// @param {number} z
// @param {object} map      - { 'x,y,z': [...tileIds] }
// @param {object} monsters - snapshot do store
// @param {object} players  - snapshot do store
// @param {string} selfId   - ID da entidade que está se movendo (ignora a si mesma)
// @param {object} nexoData - metadados dos sprites para checar waypoints (opcional)
// @returns {boolean} true se bloqueado
// ---------------------------------------------------------------------------
export function isTileBlocked(x, y, z, map, monsters, players, selfId, nexoData) {
  // Tile não existe, não caminhável ou terreno impassável (água/lava) = bloqueado
  if (!isPassableForMob(x, y, z, map, nexoData)) return true;

  // Outro monstro na mesma posição
  for (const id in monsters) {
    if (id === selfId) continue;
    const m = monsters[id];
    if (Math.round(m.x) === x && Math.round(m.y) === y && (m.z ?? 7) === z) {
      return true;
    }
  }

  // Jogador na mesma posição
  for (const pid in players) {
    const p = players[pid];
    if (Math.round(p.x) === x && Math.round(p.y) === y && (p.z ?? 7) === z) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// getLookAtDirection
// Retorna a direção que o monstro deve olhar para encarar o alvo.
//
// @param {object} mob    - { x, y }
// @param {object} target - { x, y }
// @returns {string} direção canônica
// ---------------------------------------------------------------------------
export function getLookAtDirection(mob, target) {
  const dx = target.x - mob.x;
  const dy = target.y - mob.y;
  return getDirectionFromDelta(dx, dy);
}

// ---------------------------------------------------------------------------
// parseShape
// Converte uma shape de ataque em área (array de strings) para coordenadas
// relativas ao monstro, levando em conta a direção que ele está olhando.
//
// Shape example:
//   [ "..X..", "..M..", "..X.." ]
//   M = posição do monstro, X = tile afetado
//
// @param {string[]} shape    - linhas da shape
// @param {string}   direcao  - direção atual do monstro
// @returns {[number, number][]} array de [relX, relY] relativos ao monstro
// ---------------------------------------------------------------------------
export function parseShape(shape, direcao) {
  let monsterPos = { r: 0, c: 0 };
  const coords   = [];

  // Localiza o 'M' (posição do monstro) na shape
  shape.forEach((row, r) => {
    const c = row.indexOf('M');
    if (c !== -1) monsterPos = { r, c };
  });

  // Coleta posições 'X' e calcula relativas
  shape.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== 'X') continue;
      const relR = r - monsterPos.r;
      const relC = c - monsterPos.c;

      // Rotaciona conforme a direção do monstro
      switch (direcao) {
        case 'frente':       coords.push([ relC,  -relR]); break;
        case 'costas':       coords.push([-relC,   relR]); break;
        case 'lado':         coords.push([-relR,   relC]); break; // direita
        case 'lado-esquerdo':coords.push([ relR,  -relC]); break;
        default:             coords.push([ relC,  -relR]);
      }
    }
  });

  return coords;
}

// ---------------------------------------------------------------------------
// selectAttack
// Escolhe qual ataque disponível o monstro vai usar com base em:
// - distância ao alvo
// - cooldown disponível (lido dos campos cdXxx do mob)
//
// @param {object}   mob      - estado atual do monstro (inclui campos cdXxx)
// @param {object[]} attacks  - lista de ataques do template
// @param {number}   dist     - distância atual ao alvo
// @param {number}   now      - timestamp atual
// @returns {object|null}     - ataque escolhido ou null
// ---------------------------------------------------------------------------
export function selectAttack(mob, attacks, dist, now) {
  const available = attacks.filter(atk => dist <= (atk.range ?? 1) + 0.5);
  if (available.length === 0) return null;

  // Filtra pelo cooldown — chave dinâmica: cd + nome normalizado
  const ready = available.filter(atk => {
    const cdKey = 'cd' + atk.name.replace(/[^a-zA-Z0-9]/g, '');
    return (now - (mob[cdKey] ?? 0)) >= (atk.cooldown ?? 1500);
  });

  if (ready.length === 0) return null;

  const parseChance = (atk) => {
    const raw = Number(atk?.chance ?? 1);
    if (!Number.isFinite(raw)) return 1;
    if (raw > 1) return Math.max(0, Math.min(1, raw / 100));
    return Math.max(0, Math.min(1, raw));
  };

  // chance por ataque (proc no turno): se não procou, não executa
  const procReady = ready.filter((atk) => Math.random() <= parseChance(atk));
  if (procReady.length === 0) return null;

  // Se mais de um procou, escolhe ponderado pela própria chance configurada
  const totalWeight = procReady.reduce((acc, atk) => acc + parseChance(atk), 0);
  if (totalWeight <= 0) return null;

  let roll = Math.random() * totalWeight;
  for (const atk of procReady) {
    roll -= parseChance(atk);
    if (roll <= 0) return atk;
  }

  return procReady[procReady.length - 1] ?? null;
}
