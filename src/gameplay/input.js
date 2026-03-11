// input.js
import { calculateStepDuration } from "./gameCore.js";
import { isTileWalkable } from "../core/collision.js";

const ENABLE_LOGS = false;
let lastProcessedStep = 0;

export function setupMovement(
  entity,
  worldTiles,
  getEntities,
  onMove,
  isAdmin,
  nexoData,
) {
  window.addEventListener("keydown", (e) => {
    const now = Date.now();

    const keys = {
      arrowup: { dx: 0, dy: -1, d: "costas" },
      arrowdown: { dx: 0, dy: 1, d: "frente" },
      arrowleft: { dx: -1, dy: 0, d: "lado-esquerdo" },
      arrowright: { dx: 1, dy: 0, d: "lado" },
      w: { dx: 0, dy: -1, d: "costas" },
      s: { dx: 0, dy: 1, d: "frente" },
      a: { dx: -1, dy: 0, d: "lado-esquerdo" },
      d: { dx: 1, dy: 0, d: "lado" },
    };

    const move = keys[e.key.toLowerCase()];
    if (!move) return;

    const speed = entity.speed ?? entity.appearance?.speed ?? 100;
    const stepDuration = calculateStepDuration(speed);

    if (now - lastProcessedStep < stepDuration - 10) return;

    const nx = entity.x + move.dx;
    const ny = entity.y + move.dy;
    const z = entity.z ?? 7; // usa GROUND_Z como padrão

    if (isNaN(nx) || isNaN(ny)) return;

    if (!isAdmin) {
      const blocked = checkCollision(
        nx,
        ny,
        z,
        worldTiles,
        getEntities(),
        nexoData,
      );
      if (blocked) {
        entity.lastMoveTime = now;
        lastProcessedStep = now;
        onMove(entity.x, entity.y, z, move.d);
        return;
      }
    }

    if (ENABLE_LOGS) console.log(`[Input] Movendo para ${nx}, ${ny}, z=${z}`);

    entity.lastMoveTime = now;
    lastProcessedStep = now;
    onMove(nx, ny, z, move.d);
  });
}

// ─── Colisão baseada em worldTiles + nexoData ─────────────────────────────

function checkCollision(x, y, z, worldTiles, entities, nexoData) {
  // Regra 1: tile inexistente ou com waypoints=0 = bloqueado
  if (!isTileWalkable(x, y, z, worldTiles, nexoData)) return true;

  // Colisão com outras entidades no mesmo tile
  for (const id in entities) {
    const ent = entities[id];
    if (!ent || ent.dead || (ent.stats?.hp ?? 1) <= 0) continue;
    if (
      ent.id !== "GM_ADMIN" &&
      ent.x === x &&
      ent.y === y &&
      (ent.z ?? 7) === z
    ) {
      return true;
    }
  }

  return false;
}
