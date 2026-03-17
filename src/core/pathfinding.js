// ═══════════════════════════════════════════════════════════════
// pathfinding.js — Algoritmo A* para pathfinding no mapa
// Inspirado no sistema AutoWalk do Tibia Canary
// ═══════════════════════════════════════════════════════════════

import { TILE_SIZE } from "../core/config.js";

/**
 * @typedef {Object} Position
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} PathNode
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} g - Custo do caminho desde o início
 * @property {number} h - Heurística até o destino
 * @property {number} f - g + h
 * @property {PathNode|null} parent - Nó anterior no caminho
 * @property {string} key - Chave única "x,y,z"
 */

/**
 * Direções possíveis (8 direções + diagonais)
 * Baseado no protocolo do Tibia Canary (protocolgame.cpp parseAutoWalk)
 */
export const DIRECTIONS = {
  NORTH: 3,
  NORTHEAST: 2,
  EAST: 1,
  SOUTHEAST: 8,
  SOUTH: 7,
  SOUTHWEST: 6,
  WEST: 5,
  NORTHWEST: 4,
};

/**
 * Delta de movimento para cada direção
 */
export const DIRECTION_DELTA = {
  [DIRECTIONS.NORTH]: { dx: 0, dy: -1 },
  [DIRECTIONS.NORTHEAST]: { dx: 1, dy: -1 },
  [DIRECTIONS.EAST]: { dx: 1, dy: 0 },
  [DIRECTIONS.SOUTHEAST]: { dx: 1, dy: 1 },
  [DIRECTIONS.SOUTH]: { dx: 0, dy: 1 },
  [DIRECTIONS.SOUTHWEST]: { dx: -1, dy: 1 },
  [DIRECTIONS.WEST]: { dx: -1, dy: 0 },
  [DIRECTIONS.NORTHWEST]: { dx: -1, dy: -1 },
};

/**
 * Nome das direções em texto
 */
export const DIRECTION_NAME = {
  [DIRECTIONS.NORTH]: "NORTH",
  [DIRECTIONS.NORTHEAST]: "NORTHEAST",
  [DIRECTIONS.EAST]: "EAST",
  [DIRECTIONS.SOUTHEAST]: "SOUTHEAST",
  [DIRECTIONS.SOUTH]: "SOUTH",
  [DIRECTIONS.SOUTHWEST]: "SOUTHWEST",
  [DIRECTIONS.WEST]: "WEST",
  [DIRECTIONS.NORTHWEST]: "NORTHWEST",
};

/**
 * Classe para gerenciar o pathfinding
 */
export class PathFinder {
  /**
   * @param {Object} options
   * @param {Function} options.isWalkable - (x, y, z) => boolean
   * @param {Function} options.getTileCost - (x, y, z) => number (opcional)
   */
  constructor(options = {}) {
    this.isWalkable = options.isWalkable || (() => true);
    this.getTileCost = options.getTileCost || (() => 1);
    this.allowDiagonal = options.allowDiagonal !== false;
    this.diagonalCost = options.diagonalCost || 1.414; // √2
  }

  /**
   * Encontra caminho usando A* (A-star)
   * @param {Position} start - Posição inicial
   * @param {Position} goal - Posição final
   * @returns {Object|null} { path: Position[], directions: number[], distance: number }
   */
  findPath(start, goal) {
    if (!start || !goal) return null;

    // Mesma posição
    if (start.x === goal.x && start.y === goal.y && start.z === goal.z) {
      return { path: [], directions: [], distance: 0 };
    }

    // Floors diferentes - precisa mudar de andar primeiro
    if (start.z !== goal.z) {
      return this.findPathWithFloorChange(start, goal);
    }

    const openSet = [];
    const closedSet = new Set();
    const nodeMap = new Map();

    // Nó inicial
    const startNode = {
      x: start.x,
      y: start.y,
      z: start.z,
      g: 0,
      h: this.heuristic(start, goal),
      parent: null,
      key: this.posKey(start),
    };
    startNode.f = startNode.g + startNode.h;

    openSet.push(startNode);
    nodeMap.set(startNode.key, startNode);

    while (openSet.length > 0) {
      // Pega nó com menor f
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift();

      // Chegou no destino
      if (current.x === goal.x && current.y === goal.y) {
        return this.reconstructPath(current);
      }

      closedSet.add(current.key);

      // Verifica vizinhos
      const neighbors = this.getNeighbors(current, goal);

      for (const neighbor of neighbors) {
        if (closedSet.has(neighbor.key)) continue;

        // Verifica se é walkable
        if (!this.isWalkable(neighbor.x, neighbor.y, neighbor.z)) {
          continue;
        }

        const existingNode = nodeMap.get(neighbor.key);
        const tentativeG = current.g + neighbor.cost;

        if (!existingNode) {
          // Novo nó
          neighbor.g = tentativeG;
          neighbor.h = this.heuristic(neighbor, goal);
          neighbor.f = neighbor.g + neighbor.h;
          neighbor.parent = current;

          openSet.push(neighbor);
          nodeMap.set(neighbor.key, neighbor);
        } else if (tentativeG < existingNode.g) {
          // Caminho melhor encontrado
          existingNode.g = tentativeG;
          existingNode.f = existingNode.g + existingNode.h;
          existingNode.parent = current;
        }
      }
    }

    // Sem caminho encontrado
    return null;
  }

  /**
   * Heurística: distância de Manhattan (2D)
   */
  heuristic(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx + dy;
  }

  /**
   * Chave única para posição
   */
  posKey(pos) {
    return `${pos.x},${pos.y},${pos.z}`;
  }

  /**
   * Pega vizinhos de um nó
   */
  getNeighbors(node, goal) {
    const neighbors = [];
    const z = node.z;

    // 4 direções cardeais
    const cardinalDirs = [
      DIRECTIONS.NORTH,
      DIRECTIONS.EAST,
      DIRECTIONS.SOUTH,
      DIRECTIONS.WEST,
    ];

    for (const dir of cardinalDirs) {
      const { dx, dy } = DIRECTION_DELTA[dir];
      neighbors.push({
        x: node.x + dx,
        y: node.y + dy,
        z: z,
        cost: 1,
        direction: dir,
        key: `${node.x + dx},${node.y + dy},${z}`,
      });
    }

    // Direções diagonais (se permitido)
    if (this.allowDiagonal) {
      const diagonalDirs = [
        DIRECTIONS.NORTHEAST,
        DIRECTIONS.SOUTHEAST,
        DIRECTIONS.SOUTHWEST,
        DIRECTIONS.NORTHWEST,
      ];

      for (const dir of diagonalDirs) {
        const { dx, dy } = DIRECTION_DELTA[dir];
        neighbors.push({
          x: node.x + dx,
          y: node.y + dy,
          z: z,
          cost: this.diagonalCost,
          direction: dir,
          key: `${node.x + dx},${node.y + dy},${z}`,
        });
      }
    }

    return neighbors;
  }

  /**
   * Reconstroi caminho a partir do nó final
   */
  reconstructPath(endNode) {
    const path = [];
    const directions = [];
    let current = endNode;

    while (current.parent) {
      path.unshift({ x: current.x, y: current.y, z: current.z });
      if (current.direction != null) {
        directions.unshift(current.direction);
      }
      current = current.parent;
    }

    // Adiciona posição inicial
    path.unshift({ x: current.x, y: current.y, z: current.z });

    return {
      path,
      directions,
      distance: endNode.g,
    };
  }

  /**
   * Pathfinding com mudança de floor (escadas, rampas)
   * @param {Position} start
   * @param {Position} goal
   * @returns {Object|null}
   */
  findPathWithFloorChange(start, goal) {
    // Estratégia simplificada:
    // 1. Encontra caminho até escada mais próxima
    // 2. Muda floor
    // 3. Encontra caminho do outro lado da escada até o goal

    // TODO: Implementar busca por escadas/rampas no mapa
    // Por enquanto, retorna caminho direto se floors forem adjacentes

    if (Math.abs(start.z - goal.z) > 1) {
      console.warn("[PathFinder] Floors muito distantes:", start.z, "->", goal.z);
      return null;
    }

    // Retorna caminho até posição atual + mudança de floor
    return {
      path: [{ ...start }],
      directions: [],
      distance: 0,
      floorChange: {
        from: start.z,
        to: goal.z,
        at: { x: start.x, y: start.y },
      },
    };
  }

  /**
   * Encontra caminho até tile adjacente ao target
   * Usado para PLAYER_ACTION_AUTOWALK_HIGHLIGHT
   * @param {Position} start
   * @param {Position} target
   * @returns {Object|null}
   */
  findPathToAdjacent(start, target) {
    // Tiles adjacentes ao target
    const adjacentPositions = [
      { x: target.x - 1, y: target.y - 1, z: target.z }, // NW
      { x: target.x, y: target.y - 1, z: target.z },     // N
      { x: target.x + 1, y: target.y - 1, z: target.z }, // NE
      { x: target.x - 1, y: target.y, z: target.z },     // W
      { x: target.x + 1, y: target.y, z: target.z },     // E
      { x: target.x - 1, y: target.y + 1, z: target.z }, // SW
      { x: target.x, y: target.y + 1, z: target.z },     // S
      { x: target.x + 1, y: target.y + 1, z: target.z }, // SE
    ];

    let bestPath = null;
    let bestDistance = Infinity;

    for (const adj of adjacentPositions) {
      // Verifica se é walkable
      if (!this.isWalkable(adj.x, adj.y, adj.z)) continue;

      const result = this.findPath(start, adj);
      if (result && result.distance < bestDistance) {
        bestPath = result;
        bestDistance = result.distance;
      }
    }

    if (bestPath) {
      bestPath.adjacentTo = target;
    }

    return bestPath;
  }
}

/**
 * Converte direções em lista de passos para o protocolo
 * @param {number[]} directions - Array de DIRECTIONS
 * @returns {number[]} Bytes para enviar ao servidor
 */
export function directionsToBytes(directions) {
  return directions.map((dir) => {
    // Já está no formato correto (1-8)
    return dir;
  });
}

/**
 * Cria PathFinder com validação de mapa
 * @param {Object} mapData - Dados do mapa
 * @param {Function} isWalkableFn - (x, y, z, metadata) => boolean
 * @returns {PathFinder}
 */
export function createPathFinder(mapData, isWalkableFn) {
  return new PathFinder({
    isWalkable: (x, y, z) => {
      const tileKey = `${x},${y},${z}`;
      const tile = mapData[tileKey];

      if (!tile) return false;

      // Usa função customizada se fornecida
      if (isWalkableFn) {
        return isWalkableFn(x, y, z, tile);
      }

      // Verificação padrão: tile existe e não tem bloqueio
      return !tile.blocked;
    },
  });
}
